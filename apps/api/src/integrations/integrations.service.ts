import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  checkIntegrationSecretValue,
  type IntegrationSecretDeclaration,
  type IntegrationSecretPurpose,
} from "@fluxkit/core";
import type { AdminPrincipal } from "../auth/admin-authenticator.js";
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
import {
  IntegrationsRepository,
  type IntegrationRow,
  type StoredSecretSummary,
} from "./integrations.repository.js";
import type {
  IntegrationDetailResponse,
  IntegrationListResponse,
  IntegrationResponse,
  PutIntegrationSecretBody,
  RetireIntegrationSecretBody,
} from "./integrations.schemas.js";
import { SecretCipher } from "./secret-cipher.js";

const PERMISSION = "integrations.manage";

/** The `rule` values of this module's 409 answers (`docs/api/integrations.md`). */
export const INTEGRATION_RULES = Object.freeze({
  storageDisabled: "integration_storage_disabled",
  envOverride: "integration_env_override",
  revisionStale: "integration_revision_stale",
  unavailable: "integration_unavailable",
  notRetirable: "integration_version_not_retirable",
});

interface ResolvedIntegration {
  readonly row: IntegrationRow;
  readonly installed: InstalledIntegration;
}

/** Who asks and from where; the address is only counted by the step-up limits. */
export interface IntegrationActor {
  readonly principal: AdminPrincipal;
  readonly clientAddress: string;
}

/**
 * The integration store of the admin (ADR 0058, slice 1 of plan 2026-11-16-admin-integrations): which installed
 * providers can hold credentials, whether each secret is set, and saving or retiring a stored one. A saved credential
 * is a candidate only: nothing here hands a stored value to a provider, and no response or log line carries one.
 *
 * Every change: stateless checks first (so a typo costs no password attempt), then the password re-entry with its
 * strict limits, then one transaction that re-checks the owner, moves the revision (compare and set), writes and audits.
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
  ) {}

  async list(): Promise<IntegrationListResponse> {
    const installed = await this.installed.list();
    await this.repository.ensure(installed);
    const [revision, rows] = await Promise.all([
      this.repository.currentRevision(),
      this.repository.list(),
    ]);
    const resolved = rows.flatMap((row) => {
      const match = installed.find(
        (entry) => entry.kind === row.kind && entry.providerCode === row.providerCode,
      );
      // A row of a package that is no longer installed is kept in the database and not offered.
      return match === undefined ? [] : [{ row, installed: match }];
    });
    const stored = await this.repository.storedSecrets(resolved.map((entry) => entry.row.id));
    return {
      revision,
      storage: this.storage(),
      items: resolved.map((entry) => this.view(entry, stored)),
    };
  }

  async get(id: string): Promise<IntegrationDetailResponse> {
    const resolved = await this.resolve(id);
    const [revision, stored] = await Promise.all([
      this.repository.currentRevision(),
      this.repository.storedSecrets([resolved.row.id]),
    ]);
    return { revision, storage: this.storage(), integration: this.view(resolved, stored) };
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
    await this.assertValueAccepted(resolved.installed, field, body.value);
    await this.assertRevisionFresh(body.expectedRevision);
    const verified = await this.stepUp.verify({
      principal: actor.principal,
      currentPassword: body.currentPassword,
      clientAddress: actor.clientAddress,
      operation: "integration.secret_changed",
    });
    await withTransaction(this.db, (transaction) =>
      this.writeCandidate(transaction, resolved, declaration, body, verified),
    );
    return this.get(id);
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
    return this.get(id);
  }

  private async writeCandidate(
    transaction: DbExecutor,
    resolved: ResolvedIntegration,
    declaration: IntegrationSecretDeclaration,
    body: PutIntegrationSecretBody,
    verified: VerifiedStepUp,
  ): Promise<void> {
    const now = this.clock.now();
    const { row } = resolved;
    await this.stepUp.assertStillValid(transaction, verified, PERMISSION);
    await this.advanceRevision(transaction, body.expectedRevision, now);
    if ((await this.repository.findByIdForUpdate(row.id, transaction)) === undefined) {
      throw notFound("Integration");
    }
    const purpose: IntegrationSecretPurpose = declaration.purpose;
    const replaced = await this.repository.findCandidateForUpdate(transaction, row.id, purpose);
    if (replaced !== undefined) {
      await this.repository.retire(transaction, replaced.id, now);
    }
    const generation = await this.repository.nextGeneration(transaction, row.id);
    const versionId = randomUUID();
    const secretId = randomUUID();
    // The ids exist before the insert, so the envelope is bound to the very row it is stored in.
    const sealed = this.cipher.seal(
      {
        secretId,
        integrationId: row.id,
        kind: resolved.installed.kind,
        providerCode: row.providerCode,
        field: declaration.field,
        generation,
      },
      body.value,
    );
    await this.repository.insertCandidate(
      transaction,
      {
        id: versionId,
        integrationId: row.id,
        generation,
        purpose,
        createdBy: verified.userId,
        createdAt: now,
      },
      { id: secretId, field: declaration.field, sealed },
    );
    await this.repository.touch(transaction, row.id, verified.userId, now);
    await this.audit.record(transaction, verified.userId, {
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
        replaced: replaced !== undefined,
      },
    });
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
      throw validationFailed([{ path: "value", code: "invalid_format", message: problem }]);
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

  private view(
    resolved: ResolvedIntegration,
    stored: readonly StoredSecretSummary[],
  ): IntegrationResponse {
    const { row, installed } = resolved;
    return {
      id: row.id,
      kind: installed.kind,
      providerCode: row.providerCode,
      updatedAt: row.updatedAt.toISOString(),
      secrets: installed.secrets.map((declaration) => {
        const saved = stored.find(
          (entry) => entry.integrationId === row.id && entry.field === declaration.field,
        );
        const isInEnvironment = this.installed.isSetInEnvironment(declaration);
        return {
          field: declaration.field,
          purpose: declaration.purpose,
          envVariable: declaration.envVariable,
          state: isInEnvironment ? "env" : saved === undefined ? "not_set" : "set",
          last4: null,
          versionId: saved?.versionId ?? null,
          generation: saved?.generation ?? null,
          savedAt: saved?.savedAt.toISOString() ?? null,
          keyAvailable: saved === undefined ? null : this.cipher.hasKey(saved.keyId),
        };
      }),
    };
  }
}

function revisionStale(): ProblemException {
  return ruleViolation(
    "The integration settings changed since you opened them. Reload and try again.",
    INTEGRATION_RULES.revisionStale,
  );
}

function notRetirable(): ProblemException {
  return invalidTransition(
    "Only a stored credential that is not in use can be removed.",
    INTEGRATION_RULES.notRetirable,
  );
}
