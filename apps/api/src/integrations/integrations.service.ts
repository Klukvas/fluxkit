import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { checkIntegrationSecretValue, type IntegrationSecretDeclaration } from "@fluxkit/core";
import type { IntegrationActor } from "./integration-actor.js";
export type { IntegrationActor } from "./integration-actor.js";
import { CLOCK, type Clock } from "../auth/clock.js";
import { AdminStepUpService, type VerifiedStepUp } from "../auth/step-up/admin-step-up.service.js";
import {
  invalidTransition,
  notFound,
  ProblemException,
  ruleViolation,
  validationFailed,
} from "../common/problem.js";
import { withTransaction, type DbExecutor } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { AdminAuditWriter } from "../privacy/audit/admin-audit.writer.js";
import {
  InstalledIntegrations,
  IntegrationUnavailableError,
  type InstalledIntegration,
} from "./installed-integrations.js";
import { INTEGRATIONS_CONFIG, type IntegrationsConfig } from "./integrations.config.js";
import { IntegrationRuntime } from "./integration-runtime.js";
import { readEmailRouteMode } from "../email/outbox/email-route-policy.js";
import { storedEmailActivationAllowed } from "./stored-email-route.js";
import { IntegrationsRepository, type IntegrationRow } from "./integrations.repository.js";
import type {
  IntegrationDetailResponse,
  IntegrationListResponse,
  IntegrationMutationBody,
  PutIntegrationSecretBody,
  RetireIntegrationSecretBody,
  SetEmailRouteBody,
} from "./integrations.schemas.js";
import { IntegrationAlerts, type IntegrationAlertEvent } from "./integration-alerts.service.js";
import { CandidateBundleWriter } from "./candidate-bundle-writer.js";
import { SecretCipher } from "./secret-cipher.js";
import { integrationResponseView } from "./integration-response-view.js";
import { PaymentActivationService } from "./payment-activation.service.js";
import {
  PaymentMerchantEnrollment,
  type MerchantEnrollment,
} from "./payment-merchant-enrollment.js";

const PERMISSION = "integrations.manage";

/** Audit target for the singleton route setting. The table has no uuid of its own. */
const EMAIL_ROUTE_AUDIT_TARGET = "00000000-0000-4000-8000-000000000001";

/** The `rule` values of this module's 409 answers (`docs/api/integrations.md`). */
export const INTEGRATION_RULES = Object.freeze({
  storageDisabled: "integration_storage_disabled",
  envOverride: "integration_env_override",
  revisionStale: "integration_revision_stale",
  unavailable: "integration_unavailable",
  notRetirable: "integration_version_not_retirable",
  notRevocable: "integration_version_not_revocable",
  runtimeNotReady: "integration_runtime_not_ready",
  senderRequired: "integration_sender_required",
  routeUnset: "integration_route_unset",
  notActivatable: "integration_not_activatable",
  notEnabled: "integration_not_enabled",
});

interface ResolvedIntegration {
  readonly row: IntegrationRow;
  readonly installed: InstalledIntegration;
}

/**
 * Owner-only encrypted credentials and lifecycle management. Email and payment providers activate stored generations;
 * shipping remains unavailable. Saves and lifecycle changes recheck step-up, CAS the revision, and audit atomically.
 * Payment identity probes run before the save transaction; its permanent merchant comparison commits with the candidate.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IntegrationsRepository) private readonly repository: IntegrationsRepository,
    @Inject(InstalledIntegrations) private readonly installed: InstalledIntegrations,
    @Inject(SecretCipher) private readonly cipher: SecretCipher,
    @Inject(AdminStepUpService) private readonly stepUp: AdminStepUpService,
    @Inject(AdminAuditWriter) private readonly audit: AdminAuditWriter,
    @Inject(INTEGRATIONS_CONFIG) private readonly config: IntegrationsConfig,
    @Inject(IntegrationRuntime) private readonly runtime: IntegrationRuntime,
    @Inject(IntegrationAlerts) private readonly alerts: IntegrationAlerts,
    @Inject(CandidateBundleWriter) private readonly bundles: CandidateBundleWriter,
    @Inject(PaymentActivationService) private readonly paymentActivation: PaymentActivationService,
    @Inject(PaymentMerchantEnrollment) private readonly merchants: PaymentMerchantEnrollment,
  ) {}

  async list(): Promise<IntegrationListResponse> {
    const installed = await this.installed.list();
    await this.repository.ensure(installed);
    const [revision, rows, emailRouteMode] = await Promise.all([
      this.repository.currentRevision(),
      this.repository.list(),
      this.emailRouteMode(),
    ]);
    const resolved = rows.flatMap((row) => {
      const match = installed.find(
        (entry) => entry.kind === row.kind && entry.providerCode === row.providerCode,
      );
      // A row of a package that is no longer installed is kept in the database and not offered.
      return match === undefined ? [] : [{ row, installed: match }];
    });
    const ids = resolved.map((entry) => entry.row.id);
    const [stored, versions] = await Promise.all([
      this.repository.storedSecrets(ids),
      this.repository.versionHistory(ids),
    ]);
    return {
      revision,
      storage: this.storage(),
      emailRouteMode,
      items: resolved.map((entry) =>
        integrationResponseView(
          entry,
          stored,
          versions.filter((version) => version.integrationId === entry.row.id),
          this.installed,
          this.cipher,
        ),
      ),
    };
  }

  async get(id: string): Promise<IntegrationDetailResponse> {
    const resolved = await this.resolve(id);
    const [revision, stored, versions] = await Promise.all([
      this.repository.currentRevision(),
      this.repository.storedSecrets([resolved.row.id]),
      this.repository.versionHistory([resolved.row.id]),
    ]);
    return {
      revision,
      storage: this.storage(),
      integration: integrationResponseView(resolved, stored, versions, this.installed, this.cipher),
    };
  }

  async putSecret(
    actor: IntegrationActor,
    id: string,
    field: string,
    body: PutIntegrationSecretBody,
  ): Promise<IntegrationDetailResponse> {
    const resolved = await this.resolve(id);
    const declaration = resolved.installed.secrets.find((entry) => entry.field === field);
    if (declaration === undefined) throw notFound("Integration secret field");
    if (!this.cipher.isEnabled) {
      throw ruleViolation(
        "Credentials cannot be stored: SECRETS_ENCRYPTION_KEY is not set on the server.",
        INTEGRATION_RULES.storageDisabled,
      );
    }
    if (this.installed.isSetInEnvironment(declaration)) {
      throw ruleViolation(
        "This credential is set on the server and cannot be changed here.",
        INTEGRATION_RULES.envOverride,
      );
    }
    const candidate = await this.repository.findCandidateForUpdate(
      this.db,
      id,
      declaration.purpose,
    );
    this.installed.assertEnvironmentAllowed(
      resolved.installed,
      body.environment ??
        candidate?.environment ??
        resolved.installed.environments?.default ??
        "default",
    );
    await this.assertValueAccepted(resolved.installed, field, body.value);
    await this.assertRevisionFresh(body.expectedRevision);
    if (
      body.environment !== undefined &&
      !(resolved.installed.environments?.values ?? ["default"]).includes(body.environment)
    ) {
      throw validationFailed([{ path: "environment", code: "invalid_value" }]);
    }
    const verified = await this.stepUp.verify({
      principal: actor.principal,
      currentPassword: body.currentPassword,
      clientAddress: actor.clientAddress,
      operation: "integration.secret_changed",
    });
    const enrollment = await this.merchants.prepare(
      actor,
      resolved.row,
      resolved.installed,
      declaration,
      body,
      verified,
    );
    const event = await withTransaction(this.db, (transaction) =>
      this.writeCandidate(transaction, resolved, declaration, body, verified, enrollment),
    );
    this.runtime.drop();
    await this.alerts.notify(event);
    return this.get(id);
  }

  /**
   * `equal` alternates new mail between Resend and Brevo. `resend` starts every message with Resend and uses Brevo
   * only after a proven refusal. A chain that contains both follows this, including a chain set on the server.
   */
  async setEmailRoute(
    actor: IntegrationActor,
    body: SetEmailRouteBody,
  ): Promise<{ revision: number; emailRouteMode: "equal" | "resend" }> {
    await this.assertRevisionFresh(body.expectedRevision);
    const verified = await this.stepUp.verify({
      principal: actor.principal,
      currentPassword: body.currentPassword,
      clientAddress: actor.clientAddress,
      operation: "integration.route_changed",
    });
    await withTransaction(this.db, async (transaction) => {
      const now = this.clock.now();
      await this.stepUp.assertStillValid(transaction, verified, PERMISSION);
      await this.advanceRevision(transaction, body.expectedRevision, now);
      const updated = await transaction.execute<{ mode: string }>(sql`
        update email_route_setting set mode = ${body.mode} where id = 1 returning mode`);
      if (updated.rows[0]?.mode !== body.mode) throw new Error("email_route_setting_missing");
      await this.audit.record(transaction, verified.userId, {
        action: "integration.route_changed",
        targetKind: "integration",
        targetId: EMAIL_ROUTE_AUDIT_TARGET,
        detail: { mode: body.mode },
      });
    });
    return { revision: await this.repository.currentRevision(), emailRouteMode: body.mode };
  }

  async retireSecret(
    actor: IntegrationActor,
    id: string,
    body: RetireIntegrationSecretBody,
  ): Promise<IntegrationDetailResponse> {
    const resolved = await this.resolve(id);
    const version = await this.repository.findVersion(body.versionId);
    if (version === undefined || version.integrationId !== resolved.row.id) {
      throw notFound("Integration credential version");
    }
    if (version.state !== "candidate") throw notRetirable();
    await this.assertRevisionFresh(body.expectedRevision);
    const verified = await this.stepUp.verify({
      principal: actor.principal,
      currentPassword: body.currentPassword,
      clientAddress: actor.clientAddress,
      operation: "integration.secret_retired",
    });
    await withTransaction(this.db, async (transaction) => {
      const now = this.clock.now();
      await this.stepUp.assertStillValid(transaction, verified, PERMISSION);
      await this.advanceRevision(transaction, body.expectedRevision, now);
      if ((await this.repository.findByIdForUpdate(resolved.row.id, transaction)) === undefined)
        throw notFound("Integration");
      const locked = await this.repository.findVersionForUpdate(transaction, version.id);
      if (locked === undefined || locked.state !== "candidate") throw notRetirable();
      await this.repository.retire(transaction, locked.id, now);
      await this.repository.touch(transaction, resolved.row.id, verified.userId, now);
      await this.audit.record(transaction, verified.userId, {
        action: "integration.secret_retired",
        targetKind: "integration",
        targetId: resolved.row.id,
        detail: {
          kind: resolved.row.kind,
          provider: resolved.row.providerCode,
          purpose: locked.purpose,
          generation: locked.generation,
          version: locked.id,
        },
      });
    });
    this.runtime.drop();
    return this.get(id);
  }

  async activate(
    actor: IntegrationActor,
    id: string,
    body: IntegrationMutationBody,
  ): Promise<IntegrationDetailResponse> {
    const resolved = await this.resolve(id);
    await this.assertActivatable(resolved);
    await this.assertRevisionFresh(body.expectedRevision);
    const verified = await this.stepUp.verify({
      principal: actor.principal,
      currentPassword: body.currentPassword,
      clientAddress: actor.clientAddress,
      operation: "integration.activated",
    });
    const event = await withTransaction(this.db, (transaction) =>
      this.writeActivation(transaction, resolved, body, verified),
    );
    this.runtime.drop();
    await this.alerts.notify(event);
    return this.get(id);
  }

  async disable(
    actor: IntegrationActor,
    id: string,
    body: IntegrationMutationBody,
  ): Promise<IntegrationDetailResponse> {
    const resolved = await this.resolve(id);
    if (!resolved.row.enabled) throw notActive();
    await this.assertRevisionFresh(body.expectedRevision);
    const verified = await this.stepUp.verify({
      principal: actor.principal,
      currentPassword: body.currentPassword,
      clientAddress: actor.clientAddress,
      operation: "integration.disabled",
    });
    const event = await withTransaction(this.db, async (transaction) => {
      const now = this.clock.now();
      await this.stepUp.assertStillValid(transaction, verified, PERMISSION);
      await this.advanceRevision(transaction, body.expectedRevision, now);
      const locked = await this.repository.findByIdForUpdate(resolved.row.id, transaction);
      if (locked === undefined || !locked.enabled || locked.activeOutboundVersionId === null) {
        throw notActive();
      }
      const current = await this.repository.findVersionForUpdate(
        transaction,
        locked.activeOutboundVersionId,
      );
      if (current === undefined) throw notActive();
      if (current.state === "active") {
        await this.repository.setCredentialState(transaction, current.id, "draining", now);
      }
      await this.repository.setOutboundPointer(
        transaction,
        locked.id,
        { enabled: false, versionId: locked.activeOutboundVersionId },
        verified.userId,
        now,
      );
      const auditEventId = await this.audit.record(transaction, verified.userId, {
        action: "integration.disabled",
        targetKind: "integration",
        targetId: locked.id,
        detail: {
          kind: locked.kind,
          provider: locked.providerCode,
          version: locked.activeOutboundVersionId,
        },
      });
      return {
        auditEventId,
        action: "integration.disabled" as const,
        kind: resolved.installed.kind,
        providerCode: locked.providerCode,
        generation: current.generation,
        occurredAt: now,
      };
    });
    this.runtime.drop();
    await this.alerts.notify(event);
    return this.get(id);
  }

  async revokeSecret(
    actor: IntegrationActor,
    id: string,
    body: RetireIntegrationSecretBody,
  ): Promise<IntegrationDetailResponse> {
    const resolved = await this.resolve(id);
    const version = await this.repository.findVersion(body.versionId);
    if (version === undefined || version.integrationId !== resolved.row.id) {
      throw notFound("Integration credential version");
    }
    if (
      version.state !== "candidate" &&
      version.state !== "active" &&
      version.state !== "draining"
    ) {
      throw notRevocable();
    }
    await this.assertRevisionFresh(body.expectedRevision);
    const verified = await this.stepUp.verify({
      principal: actor.principal,
      currentPassword: body.currentPassword,
      clientAddress: actor.clientAddress,
      operation: "integration.revoked",
    });
    const event = await withTransaction(this.db, async (transaction) => {
      const now = this.clock.now();
      await this.stepUp.assertStillValid(transaction, verified, PERMISSION);
      await this.advanceRevision(transaction, body.expectedRevision, now);
      const locked = await this.repository.findByIdForUpdate(resolved.row.id, transaction);
      const current = await this.repository.findVersionForUpdate(transaction, version.id);
      if (
        locked === undefined ||
        current === undefined ||
        (current.state !== "candidate" &&
          current.state !== "active" &&
          current.state !== "draining")
      ) {
        throw notRevocable();
      }
      await this.repository.setCredentialState(transaction, current.id, "revoked", now);
      if (locked.activeOutboundVersionId === current.id) {
        await this.repository.setOutboundPointer(
          transaction,
          locked.id,
          { enabled: false, versionId: null },
          verified.userId,
          now,
        );
      } else {
        await this.repository.touch(transaction, locked.id, verified.userId, now);
      }
      const auditEventId = await this.audit.record(transaction, verified.userId, {
        action: "integration.revoked",
        targetKind: "integration",
        targetId: locked.id,
        detail: {
          kind: locked.kind,
          provider: locked.providerCode,
          purpose: current.purpose,
          generation: current.generation,
          version: current.id,
        },
      });
      return {
        auditEventId,
        action: "integration.revoked" as const,
        kind: resolved.installed.kind,
        providerCode: locked.providerCode,
        generation: current.generation,
        occurredAt: now,
      };
    });
    this.runtime.drop();
    await this.alerts.notify(event);
    return this.get(id);
  }

  private async writeCandidate(
    transaction: DbExecutor,
    resolved: ResolvedIntegration,
    declaration: IntegrationSecretDeclaration,
    body: PutIntegrationSecretBody,
    verified: VerifiedStepUp,
    enrollment: MerchantEnrollment | undefined,
  ): Promise<IntegrationAlertEvent> {
    const now = this.clock.now();
    const { row } = resolved;
    await this.stepUp.assertStillValid(transaction, verified, PERMISSION);
    await this.advanceRevision(transaction, body.expectedRevision, now);
    const { versionId, generation, replaced } = await this.bundles.write(
      transaction,
      row,
      resolved.installed,
      declaration,
      body,
      verified.userId,
      now,
    );
    if (enrollment !== undefined)
      await this.merchants.enroll(transaction, row, enrollment, verified.userId, now);
    const purpose = declaration.purpose;
    await this.repository.touch(transaction, row.id, verified.userId, now);
    const auditEventId = await this.audit.record(transaction, verified.userId, {
      action: "integration.secret_changed",
      targetKind: "integration",
      targetId: row.id,
      detail: {
        kind: row.kind,
        provider: row.providerCode,
        field: declaration.field,
        purpose,
        generation,
        version: versionId,
        replaced,
        ...(enrollment === undefined ? {} : { enrollmentMatched: true }),
      },
    });
    return {
      auditEventId,
      action: "integration.secret_changed",
      kind: resolved.installed.kind,
      providerCode: row.providerCode,
      generation: generation,
      occurredAt: now,
    };
  }

  private async assertActivatable(resolved: ResolvedIntegration): Promise<void> {
    const { row, installed } = resolved;
    if (row.kind !== "email" && row.kind !== "payment") throw runtimeNotReady();
    if (row.kind === "payment") {
      await this.paymentActivation.assertActivatable(this.db, resolved);
      return;
    }
    if (!this.config.emailRouteDelegated) {
      throw ruleViolation(
        "EMAIL_PROVIDER is set on the server, so a stored credential cannot be activated.",
        INTEGRATION_RULES.envOverride,
      );
    }
    if (!this.cipher.isEnabled) {
      throw ruleViolation(
        "Credentials cannot be stored: SECRETS_ENCRYPTION_KEY is not set on the server.",
        INTEGRATION_RULES.storageDisabled,
      );
    }
    const outbound = installed.secrets.filter((entry) => entry.purpose === "outbound");
    if (outbound.some((entry) => this.installed.isSetInEnvironment(entry))) {
      throw ruleViolation(
        "This credential is set on the server and cannot be changed here.",
        INTEGRATION_RULES.envOverride,
      );
    }
    if (this.config.emailFromAddress === null) throw senderRequired();
    const candidate = await this.repository.findCandidateForUpdate(this.db, row.id, "outbound");
    if (candidate === undefined) throw notActivatable();
    this.assertCandidateEnvironment(installed, candidate.environment);
    const fields = await this.repository.secretFields(this.db, candidate.id);
    if (!outbound.every((entry) => fields.includes(entry.field))) throw notActivatable();
    const enabled = await this.repository.lockEnabled(this.db, "email");
    this.assertEmailRoutePair(
      enabled.filter((entry) => entry.id !== row.id).map((entry) => entry.providerCode),
      row.providerCode,
    );
  }

  private async writeActivation(
    transaction: DbExecutor,
    resolved: ResolvedIntegration,
    body: IntegrationMutationBody,
    verified: VerifiedStepUp,
  ): Promise<IntegrationAlertEvent> {
    const now = this.clock.now();
    await this.stepUp.assertStillValid(transaction, verified, PERMISSION);
    await this.advanceRevision(transaction, body.expectedRevision, now);
    const locked = await this.repository.findByIdForUpdate(resolved.row.id, transaction);
    if (locked === undefined) throw runtimeNotReady();
    if (locked.kind === "payment")
      return this.paymentActivation.activate(
        transaction,
        { ...resolved, row: locked },
        verified,
        now,
      );
    if (locked.kind !== "email") throw runtimeNotReady();
    const outbound = resolved.installed.secrets.filter((entry) => entry.purpose === "outbound");
    if (
      !this.config.emailRouteDelegated ||
      outbound.some((entry) => this.installed.isSetInEnvironment(entry))
    ) {
      throw ruleViolation(
        "EMAIL_PROVIDER is set on the server, so a stored credential cannot be activated.",
        INTEGRATION_RULES.envOverride,
      );
    }
    if (this.config.emailFromAddress === null) throw senderRequired();
    const enabled = await this.repository.lockEnabled(transaction, "email");
    this.assertEmailRoutePair(
      enabled.filter((entry) => entry.id !== locked.id).map((entry) => entry.providerCode),
      locked.providerCode,
    );
    const candidate = await this.repository.findCandidateForUpdate(
      transaction,
      locked.id,
      "outbound",
    );
    if (candidate === undefined) throw notActivatable();
    this.assertCandidateEnvironment(resolved.installed, candidate.environment);
    const fields = await this.repository.secretFields(transaction, candidate.id);
    if (!outbound.every((entry) => fields.includes(entry.field))) throw notActivatable();
    try {
      await this.runtime.validateEmailCandidate(
        locked.id,
        resolved.installed,
        candidate,
        transaction,
      );
    } catch {
      new Logger(IntegrationsService.name).error("integration_activation_validation_failed");
      throw ruleViolation("This credential cannot be used.", INTEGRATION_RULES.unavailable);
    }

    if (
      locked.activeOutboundVersionId !== null &&
      locked.activeOutboundVersionId !== candidate.id
    ) {
      const previous = await this.repository.findVersionForUpdate(
        transaction,
        locked.activeOutboundVersionId,
      );
      if (previous?.state === "active") {
        await this.repository.setCredentialState(transaction, previous.id, "draining", now);
      }
    }
    await this.repository.setCredentialState(transaction, candidate.id, "active", now);
    await this.repository.setOutboundPointer(
      transaction,
      locked.id,
      { enabled: true, versionId: candidate.id },
      verified.userId,
      now,
    );
    const auditEventId = await this.audit.record(transaction, verified.userId, {
      action: "integration.activated",
      targetKind: "integration",
      targetId: locked.id,
      detail: {
        kind: locked.kind,
        provider: locked.providerCode,
        purpose: candidate.purpose,
        generation: candidate.generation,
        version: candidate.id,
      },
    });
    return {
      auditEventId,
      action: "integration.activated",
      kind: resolved.installed.kind,
      providerCode: locked.providerCode,
      generation: candidate.generation,
      occurredAt: now,
    };
  }

  private assertCandidateEnvironment(installed: InstalledIntegration, environment: string): void {
    this.installed.assertEnvironmentAllowed(installed, environment);
    if (!(installed.environments?.values ?? ["default"]).includes(environment)) {
      throw ruleViolation(
        "This credential's environment is not available for this provider.",
        INTEGRATION_RULES.envOverride,
      );
    }
  }

  private emailRouteMode(): Promise<"equal" | "resend"> {
    return readEmailRouteMode(this.db);
  }

  private assertEmailRoutePair(enabledCodes: readonly string[], nextCode: string): void {
    if (!storedEmailActivationAllowed(enabledCodes, nextCode)) throw routeUnset();
  }

  private storage(): "ready" | "disabled" {
    return this.cipher.isEnabled ? "ready" : "disabled";
  }

  private async resolve(id: string): Promise<ResolvedIntegration> {
    const row = await this.repository.findById(id);
    if (row === undefined) throw notFound("Integration");
    const installed = await this.installed.find(row.kind, row.providerCode);
    if (installed === undefined) throw notFound("Integration");
    return { row, installed };
  }

  /** The bounds every credential has, then the plugin's own format rule. Problems name the rule, never the value. */
  private async assertValueAccepted(
    installed: InstalledIntegration,
    field: string,
    value: string,
  ): Promise<void> {
    const generic = checkIntegrationSecretValue(value);
    if (generic !== null) {
      throw validationFailed([{ path: "value", code: generic }]);
    }
    let problem: string | undefined;
    try {
      problem = await this.installed.validateSecret(installed, field, value);
    } catch (error) {
      if (error instanceof IntegrationUnavailableError) {
        throw ruleViolation(
          "This provider's package could not be loaded, so nothing was saved.",
          INTEGRATION_RULES.unavailable,
        );
      }
      throw error;
    }
    if (problem !== undefined) {
      throw validationFailed([
        {
          path: "value",
          code: "invalid_format",
          message: "The credential format is invalid; the value is not shown.",
        },
      ]);
    }
  }

  /** A courtesy check before the password is asked for; the transaction repeats it authoritatively. */
  private async assertRevisionFresh(expected: number): Promise<void> {
    if ((await this.repository.currentRevision()) !== expected) throw revisionStale();
  }

  private async advanceRevision(
    transaction: DbExecutor,
    expected: number,
    now: Date,
  ): Promise<void> {
    if ((await this.repository.advanceRevision(transaction, expected, now)) === undefined) {
      throw revisionStale();
    }
  }
}

function revisionStale(): ProblemException {
  return ruleViolation(
    "The integration settings changed since you opened them. Reload and try again.",
    INTEGRATION_RULES.revisionStale,
  );
}

function runtimeNotReady(): ProblemException {
  return ruleViolation(
    "This provider cannot be activated until its safety checks exist.",
    INTEGRATION_RULES.runtimeNotReady,
  );
}

function senderRequired(): ProblemException {
  return ruleViolation(
    "Email cannot be activated until EMAIL_FROM is set on the server.",
    INTEGRATION_RULES.senderRequired,
  );
}

function routeUnset(): ProblemException {
  return ruleViolation(
    "Only Resend and Brevo can be on together. Turn the other email provider off first.",
    INTEGRATION_RULES.routeUnset,
  );
}

function notActivatable(): ProblemException {
  return ruleViolation(
    "Save the outbound credential before activating this provider.",
    INTEGRATION_RULES.notActivatable,
  );
}

function notActive(): ProblemException {
  return invalidTransition("This integration is already off.", INTEGRATION_RULES.notEnabled);
}

function notRevocable(): ProblemException {
  return invalidTransition(
    "This credential version can no longer be revoked.",
    INTEGRATION_RULES.notRevocable,
  );
}

function notRetirable(): ProblemException {
  return invalidTransition(
    "Only a stored credential that is not in use can be removed.",
    INTEGRATION_RULES.notRetirable,
  );
}
