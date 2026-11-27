import { pathToFileURL } from "node:url";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  hasPermission,
  isLocked,
  type CheckCredentials,
  type CredentialCheckOutcome,
  type ManagedProviderContext,
} from "@fluxkit/core";
import { AdminUserRepository } from "../auth/admin-user.repository.js";
import { SessionRepository } from "../auth/session.repository.js";
import { CLOCK, type Clock } from "../auth/clock.js";
import {
  notFound,
  ProblemException,
  ruleViolation,
  tooManyRequests,
  unauthorized,
} from "../common/problem.js";
import { withTransaction } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { AdminAuditWriter } from "../privacy/audit/admin-audit.writer.js";
import { STRICT_WINDOWS, type StrictWindows } from "../rate-limit/strict-windows.js";
import { InstalledIntegrations } from "./installed-integrations.js";
import { IntegrationRuntime } from "./integration-runtime.js";
import { IntegrationsRepository } from "./integrations.repository.js";
import { SecretCipher } from "./secret-cipher.js";
import {
  integrationCheckResponseSchema,
  type CheckIntegrationBody,
  type IntegrationCheckResponse,
} from "./integrations.schemas.js";
import type { IntegrationActor } from "./integrations.service.js";

const STATES = ["candidate", "active", "draining"] as const;
const TIMEOUT_MS = 10_000;

@Injectable()
export class IntegrationCheckService {
  private readonly logger = new Logger(IntegrationCheckService.name);
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IntegrationsRepository) private readonly repository: IntegrationsRepository,
    @Inject(InstalledIntegrations) private readonly installed: InstalledIntegrations,
    @Inject(SecretCipher) private readonly cipher: SecretCipher,
    @Inject(IntegrationRuntime) private readonly runtime: IntegrationRuntime,
    @Inject(STRICT_WINDOWS) private readonly windows: StrictWindows,
    @Inject(AdminAuditWriter) private readonly audit: AdminAuditWriter,
    @Inject(AdminUserRepository) private readonly users: AdminUserRepository,
    @Inject(SessionRepository) private readonly sessions: SessionRepository,
  ) {}

  async check(
    actor: IntegrationActor,
    id: string,
    body: CheckIntegrationBody,
  ): Promise<IntegrationCheckResponse> {
    const row = await this.repository.findById(id);
    const installed =
      row === undefined ? undefined : await this.installed.find(row.kind, row.providerCode);
    if (row === undefined || installed === undefined) throw notFound("Integration");
    const decision = await this.windows.attempt([
      {
        name: "integrationCheckAdmin",
        key: `admin-user:${actor.principal.userId}`,
        limit: { maxAttempts: 10, windowMinutes: 1 },
      },
      {
        name: "integrationCheckAddress",
        key: actor.clientAddress,
        limit: { maxAttempts: 30, windowMinutes: 1 },
      },
      ...(row.kind === "shipping"
        ? [
            {
              name: "integrationCheckShippingAdmin",
              key: `admin-user:${actor.principal.userId}`,
              limit: { maxAttempts: 30, windowMinutes: 10 },
            },
          ]
        : []),
      {
        name: "integrationCheckProvider",
        key: `${row.kind}:${row.providerCode}`,
        limit: { maxAttempts: 30, windowMinutes: 1 },
      },
    ]);
    if (decision.outcome === "unavailable") throw checkUnavailable();
    if (decision.outcome === "denied")
      throw tooManyRequests(
        "Too many credential checks. Try again later.",
        decision.retryAfterSeconds,
      );
    const version = await withTransaction(this.db, async (tx) => {
      const now = this.clock.now();
      const user = await this.users.findByIdForUpdate(actor.principal.userId, tx);
      if (
        user === undefined ||
        !user.isActive ||
        isLocked(user, now) ||
        !hasPermission(user.role, "integrations.manage") ||
        !(await this.sessions.isLiveForUpdate(tx, actor.principal.sessionId, user.id, now))
      )
        throw unauthorized();
      if ((await this.repository.currentRevision(tx)) !== body.expectedRevision)
        throw ruleViolation(
          "Integration settings changed. Reload and try again.",
          "integration_revision_stale",
        );
      await this.repository.findByIdForUpdate(id, tx);
      const current = await this.repository.findVersionForUpdate(tx, body.versionId);
      if (current === undefined || current.integrationId !== id)
        throw notFound("Integration credential version");
      if (!STATES.some((state) => state === current.state))
        throw ruleViolation("This version cannot be checked.", "integration_version_not_checkable");
      this.installed.assertEnvironmentAllowed(installed, current.environment);
      const declarations = installed.secrets.filter((field) => field.purpose === current.purpose);
      if (
        installed.secrets.some(
          (field) => field.purpose === "outbound" && this.installed.isSetInEnvironment(field),
        )
      )
        throw ruleViolation("This credential is set on the server.", "integration_env_override");
      const fields = await this.repository.secretFields(tx, current.id);
      if (declarations.length === 0 || !declarations.every((field) => fields.includes(field.field)))
        throw ruleViolation(
          "Save every field before checking this version.",
          "integration_version_incomplete",
        );
      if (!(installed.environments?.values ?? ["default"]).includes(current.environment))
        throw ruleViolation("This environment is unavailable.", "integration_unavailable");
      await this.audit.record(tx, actor.principal.userId, {
        action: "integration.check_requested",
        targetKind: "integration",
        targetId: id,
        detail: { kind: installed.kind, provider: installed.providerCode, version: current.id },
      });
      return current;
    }).catch((error: unknown) => {
      if (error instanceof ProblemException) throw error;
      this.logger.error("integration_check_audit_failed");
      throw checkUnavailable();
    });
    let outcome: CredentialCheckOutcome;
    try {
      const imported = (await import(pathToFileURL(installed.entryPath).href)) as {
        checkCredentials?: unknown;
      };
      if (imported.checkCredentials === undefined) outcome = { code: "not_supported" };
      else if (typeof imported.checkCredentials !== "function") outcome = { code: "unavailable" };
      else {
        const secrets: Record<string, string> = {};
        for (const envelope of await this.repository.secretEnvelopes(version.id)) {
          if (
            !installed.secrets.some(
              (field) => field.purpose === version.purpose && field.field === envelope.field,
            )
          )
            continue;
          secrets[envelope.field] = this.cipher.open(
            {
              secretId: envelope.id,
              integrationId: id,
              kind: installed.kind,
              providerCode: installed.providerCode,
              field: envelope.field,
              generation: version.generation,
            },
            envelope,
          );
        }
        const context: ManagedProviderContext = Object.freeze({
          kind: installed.kind,
          providerCode: installed.providerCode,
          versionId: version.id,
          environment: version.environment,
          now: () => this.clock.now(),
          transport: this.runtime.gateFor(version.id, STATES),
        });
        outcome = await invokeCheck(
          imported.checkCredentials as CheckCredentials,
          secrets,
          context,
        );
      }
      const [revision, current] = await Promise.all([
        this.repository.currentRevision(),
        this.repository.findVersion(version.id),
      ]);
      if (
        revision !== body.expectedRevision ||
        current === undefined ||
        !STATES.some((state) => state === current.state)
      )
        outcome = { code: "unavailable" };
    } catch (error) {
      this.logger.error(
        `integration_check_failed ${error instanceof Error ? error.constructor.name : "UnknownError"}`,
      );
      outcome = { code: "unavailable" };
    }
    const checkedAt = this.clock.now().toISOString();
    try {
      await withTransaction(this.db, (tx) =>
        this.audit.record(tx, actor.principal.userId, {
          action: "integration.check_completed",
          targetKind: "integration",
          targetId: id,
          detail: {
            kind: installed.kind,
            provider: installed.providerCode,
            version: version.id,
            code: outcome.code,
          },
        }),
      );
    } catch {
      this.logger.error("integration_check_audit_failed");
      throw checkUnavailable();
    }
    return { versionId: version.id, ...outcome, checkedAt };
  }
}

async function invokeCheck(
  hook: CheckCredentials,
  secrets: Readonly<Record<string, string>>,
  context: ManagedProviderContext,
): Promise<CredentialCheckOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("check_timeout"));
      }, TIMEOUT_MS);
    });
    const raw: unknown = await Promise.race([hook(secrets, context, controller.signal), timeout]);
    const parsed = integrationCheckResponseSchema
      .omit({ versionId: true, checkedAt: true })
      .safeParse(raw);
    return parsed.success ? parsed.data : { code: "unavailable" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // The short-lived context cannot start a transport after the hook has returned.
    controller.abort();
  }
}

function checkUnavailable(): ProblemException {
  return new ProblemException({
    code: "service_unavailable",
    detail: "Credential checks are temporarily unavailable.",
    extensions: { rule: "check_unavailable" },
    headers: { "Retry-After": "5" },
  });
}
