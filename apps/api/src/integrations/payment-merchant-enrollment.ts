import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type {
  AccountIdentity,
  ManagedProviderContext,
  IntegrationSecretDeclaration,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../auth/clock.js";
import { AdminStepUpService, type VerifiedStepUp } from "../auth/step-up/admin-step-up.service.js";
import { ProblemException, ruleViolation, tooManyRequests } from "../common/problem.js";
import { withTransaction, type DbExecutor } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { STRICT_WINDOWS, type StrictWindows } from "../rate-limit/strict-windows.js";
import type { InstalledIntegration } from "./installed-integrations.js";
import { IntegrationsRepository, type IntegrationRow } from "./integrations.repository.js";
import type { PutIntegrationSecretBody } from "./integrations.schemas.js";
import type { IntegrationActor } from "./integration-actor.js";
import { MerchantBaselineCipher } from "./merchant-baseline-cipher.js";
import { SecretCipher } from "./secret-cipher.js";

export interface MerchantEnrollment {
  readonly identity: string;
  readonly environment: string;
}

/** A request-only identity probe; no remote promise is awaited in an authority transaction. */
@Injectable()
export class PaymentMerchantEnrollment {
  private readonly logger = new Logger(PaymentMerchantEnrollment.name);
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IntegrationsRepository) private readonly repository: IntegrationsRepository,
    @Inject(SecretCipher) private readonly secrets: SecretCipher,
    @Inject(MerchantBaselineCipher) private readonly baselineCipher: MerchantBaselineCipher,
    @Inject(AdminStepUpService) private readonly stepUp: AdminStepUpService,
    @Inject(STRICT_WINDOWS) private readonly windows: StrictWindows,
  ) {}

  async prepare(
    actor: IntegrationActor,
    row: IntegrationRow,
    installed: InstalledIntegration,
    declaration: IntegrationSecretDeclaration,
    body: PutIntegrationSecretBody,
    verified: VerifiedStepUp,
  ): Promise<MerchantEnrollment | undefined> {
    if (row.kind !== "payment" || declaration.purpose !== "outbound") return undefined;
    let hook: unknown;
    try {
      hook = (
        (await import(pathToFileURL(installed.entryPath).href)) as { accountIdentity?: unknown }
      ).accountIdentity;
    } catch {
      throw enrollmentUnavailable();
    }
    if (hook === undefined) return undefined;
    if (typeof hook !== "function") throw enrollmentUnavailable();
    const prepared = await withTransaction(this.db, async (tx) => {
      await this.assertRequest(tx, row, body.expectedRevision, verified);
      const candidate = await this.repository.findCandidateForUpdate(
        tx,
        row.id,
        declaration.purpose,
      );
      const active =
        row.activeOutboundVersionId === null
          ? undefined
          : await this.repository.findVersionForUpdate(tx, row.activeOutboundVersionId);
      const base =
        candidate ??
        (active?.state === "active" || active?.state === "draining" ? active : undefined);
      const environment =
        body.environment ?? candidate?.environment ?? installed.environments?.default ?? "default";
      const retained =
        base?.environment === environment ? await this.repository.secretEnvelopes(base.id, tx) : [];
      const values: Record<string, string> = {};
      for (const envelope of retained) {
        if (
          envelope.field === declaration.field ||
          !installed.secrets.some(
            (entry) => entry.purpose === "outbound" && entry.field === envelope.field,
          )
        )
          continue;
        values[envelope.field] = this.secrets.open(
          {
            secretId: envelope.id,
            integrationId: row.id,
            kind: installed.kind,
            providerCode: row.providerCode,
            field: envelope.field,
            generation: base?.generation ?? 1,
          },
          envelope,
        );
      }
      const merged = { ...values, [declaration.field]: body.value };
      const complete = installed.secrets
        .filter((entry) => entry.purpose === "outbound")
        .every((entry) => Object.hasOwn(merged, entry.field));
      if (complete) await this.assertNoLegacyWork(tx, row.providerCode);
      return { environment, values: merged, complete };
    });
    // Partial bundles cannot establish or inherit merchant proof; the final field triggers enrollment.
    if (!prepared.complete) return undefined;
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
      {
        name: "integrationCheckProvider",
        key: `${row.kind}:${row.providerCode}`,
        limit: { maxAttempts: 30, windowMinutes: 1 },
      },
    ]);
    if (decision.outcome === "unavailable") throw enrollmentUnavailable();
    if (decision.outcome === "denied")
      throw tooManyRequests(
        "Too many credential checks. Try again later.",
        decision.retryAfterSeconds,
      );

    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const context: ManagedProviderContext = Object.freeze({
      kind: installed.kind,
      providerCode: row.providerCode,
      versionId: randomUUID(),
      environment: prepared.environment,
      now: () => this.clock.now(),
      transport: {
        start: async <T>(
          signal: Parameters<ManagedProviderContext["transport"]["start"]>[0],
          begin: () => { completion: Promise<T> },
        ): Promise<T> => {
          if (!active || signal.aborted || controller.signal.aborted) throw enrollmentUnavailable();
          const started = await withTransaction(this.db, async (tx) => {
            await this.assertRequest(tx, row, body.expectedRevision, verified);
            if (!active || signal.aborted || controller.signal.aborted)
              throw enrollmentUnavailable();
            const started = begin();
            const settled = started.completion.then(
              (value) => ({ ok: true as const, value }),
              () => ({ ok: false as const }),
            );
            return { ...started, settled };
          });
          await started.settled;
          return started.completion;
        },
      },
    });
    try {
      const expired = new Promise<never>((_resolve, reject) =>
        controller.signal.addEventListener("abort", () => reject(enrollmentUnavailable()), {
          once: true,
        }),
      );
      const result: unknown = await Promise.race([
        (hook as AccountIdentity)(prepared.values, context, controller.signal),
        expired,
      ]);
      if (typeof result !== "object" || result === null || !("ok" in result))
        throw enrollmentUnavailable();
      if (result.ok !== true) {
        if ("code" in result && result.code === "invalid_credentials")
          throw ruleViolation("The credential was refused.", "invalid_credentials");
        throw enrollmentUnavailable();
      }
      if (
        !("identity" in result) ||
        typeof result.identity !== "string" ||
        Buffer.byteLength(result.identity, "utf8") < 1 ||
        Buffer.byteLength(result.identity, "utf8") > 256
      )
        throw enrollmentUnavailable();
      return { identity: result.identity, environment: prepared.environment };
    } catch (error) {
      if (error instanceof ProblemException) throw error;
      this.logger.error("integration_credential_check_failed");
      throw enrollmentUnavailable();
    } finally {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    }
  }

  async enroll(
    tx: DbExecutor,
    row: IntegrationRow,
    prepared: MerchantEnrollment,
    actorId: string,
    now: Date,
  ): Promise<void> {
    await this.assertNoLegacyWork(tx, row.providerCode);
    const result = await tx.execute<{
      id: string;
      key_id: string;
      nonce: Buffer;
      ciphertext: Buffer;
      tag: Buffer;
    }>(sql`
      select id,key_id,nonce,ciphertext,tag from integration_merchant_baseline
      where integration_id=${row.id}::uuid and environment=${prepared.environment} for update`);
    const existing = result.rows[0];
    const binding = {
      baselineId: existing?.id ?? randomUUID(),
      integrationId: row.id,
      kind: "payment" as const,
      providerCode: row.providerCode,
      environment: prepared.environment,
    };
    if (existing !== undefined) {
      let identity: string;
      try {
        identity = this.baselineCipher.open(binding, {
          keyId: existing.key_id,
          nonce: existing.nonce,
          ciphertext: existing.ciphertext,
          tag: existing.tag,
        });
      } catch {
        throw enrollmentUnavailable();
      }
      if (identity !== prepared.identity)
        throw ruleViolation(
          "This credential belongs to another merchant.",
          "integration_merchant_mismatch",
        );
      return;
    }
    const sealed = this.baselineCipher.seal(binding, prepared.identity);
    await tx.execute(sql`insert into integration_merchant_baseline
      (id,integration_id,kind,provider_code,environment,enrollment_source,created_at,created_by,key_id,nonce,ciphertext,tag)
      values (${binding.baselineId}::uuid,${row.id}::uuid,'payment',${row.providerCode},${prepared.environment},'first_save',${now},
      (select id from admin_user where id=${actorId}::uuid),${sealed.keyId},${sealed.nonce},${sealed.ciphertext},${sealed.tag})`);
  }

  async assertActivation(
    tx: DbExecutor,
    row: IntegrationRow,
    installed: InstalledIntegration,
    versionId: string,
    environment: string,
  ): Promise<void> {
    await this.assertNoLegacyWork(tx, row.providerCode);
    let hook: unknown;
    try {
      hook = (
        (await import(pathToFileURL(installed.entryPath).href)) as { accountIdentity?: unknown }
      ).accountIdentity;
    } catch {
      throw enrollmentUnavailable();
    }
    if (hook === undefined) return;
    if (typeof hook !== "function") throw enrollmentUnavailable();
    const result = await tx.execute<{
      id: string;
      key_id: string;
      nonce: Buffer;
      ciphertext: Buffer;
      tag: Buffer;
      matched: boolean;
    }>(sql`select b.id,b.key_id,b.nonce,b.ciphertext,b.tag,exists (
      select 1 from admin_audit_event a where a.target_id=b.integration_id and a.action='integration.secret_changed'
      and a.detail->>'version'=${versionId} and a.detail->>'enrollmentMatched'='true') as matched
      from integration_merchant_baseline b where b.integration_id=${row.id}::uuid and b.environment=${environment}`);
    const baseline = result.rows[0];
    if (baseline?.matched !== true)
      throw ruleViolation(
        "Save this credential again before activation.",
        "integration_merchant_not_enrolled",
      );
    try {
      this.baselineCipher.open(
        {
          baselineId: baseline.id,
          integrationId: row.id,
          kind: "payment",
          providerCode: row.providerCode,
          environment,
        },
        {
          keyId: baseline.key_id,
          nonce: baseline.nonce,
          ciphertext: baseline.ciphertext,
          tag: baseline.tag,
        },
      );
    } catch {
      throw enrollmentUnavailable();
    }
  }

  private async assertRequest(
    tx: DbExecutor,
    row: IntegrationRow,
    revision: number,
    verified: VerifiedStepUp,
  ): Promise<void> {
    await this.stepUp.assertStillValid(tx, verified, "integrations.manage");
    if ((await this.repository.findByIdForUpdate(row.id, tx)) === undefined)
      throw enrollmentUnavailable();
    // Waiting for the integration lock can outlive a lifecycle commit and its revision change.
    if ((await this.repository.currentRevision(tx)) !== revision)
      throw ruleViolation("Integration settings changed.", "integration_revision_stale");
  }

  private async assertNoLegacyWork(tx: DbExecutor, provider: string): Promise<void> {
    const result = await tx.execute<{
      exists: boolean;
    }>(sql`select exists(select 1 from payment p where p.provider_code=${provider} and p.integration_credential_version_id is null and
      (p.status in ('creating','create_unknown','awaiting_customer','processing') or p.next_check_at is not null or exists
        (select 1 from payment_refund r where r.payment_id=p.id and r.status in ('requested','processing','unknown')))) as exists`);
    if (result.rows[0]?.exists === true)
      throw ruleViolation(
        "Legacy payments must be reconciled before activation.",
        "integration_legacy_work_open",
      );
  }
}

function enrollmentUnavailable(): ProblemException {
  return new ProblemException({
    code: "service_unavailable",
    detail: "The credential cannot be checked safely right now.",
    extensions: { rule: "integration_credential_check_unavailable" },
    headers: { "Retry-After": "5" },
  });
}
