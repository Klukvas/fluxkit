import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
  IntegrationCredentialState,
  IntegrationKind,
  IntegrationSecretPurpose,
} from "@fluxkit/core";
import type { DbExecutor } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import {
  emailMessage,
  integration,
  integrationCredentialVersion,
  integrationRevision,
  integrationSecret,
} from "../database/schema/index.js";
import type { IntegrationVersionResponse } from "./integrations.schemas.js";
import type { SealedSecret } from "./secret-cipher.js";

export type IntegrationRow = typeof integration.$inferSelect;
export type CredentialVersionRow = typeof integrationCredentialVersion.$inferSelect;

/** A stored secret as the views need it: where it is and which key sealed it. Never the envelope itself. */
export interface StoredSecretSummary {
  readonly integrationId: string;
  readonly versionId: string;
  readonly generation: number;
  readonly purpose: string;
  readonly field: string;
  readonly keyId: string;
  readonly state: string;
  readonly savedAt: Date;
}

const REVISION_ROW_ID = 1;
/** The store cannot supply a coherent credential snapshot without its singleton revision. */
export class IntegrationRevisionUnavailableError extends Error {
  constructor() {
    super("The integration_revision row is missing");
    this.name = "IntegrationRevisionUnavailableError";
  }
}
/** Envelopes that still exist. A candidate is listed before an active one so retire keeps working. */
const VISIBLE_STATES: readonly IntegrationCredentialState[] = [
  "candidate",
  "active",
  "draining",
  "revoked",
];

/** Persistence of the integration store (ADR 0058). The service owns the order of locks and the transactions. */
@Injectable()
export class IntegrationsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async currentRevision(executor: DbExecutor = this.db): Promise<number> {
    const [row] = await executor
      .select({ revision: integrationRevision.revision })
      .from(integrationRevision)
      .where(eq(integrationRevision.id, REVISION_ROW_ID));
    if (row === undefined) throw new IntegrationRevisionUnavailableError();
    return row.revision;
  }

  /** Compare and set: `undefined` when another change landed since the caller read `expected`. */
  async advanceRevision(
    transaction: DbExecutor,
    expected: number,
    now: Date,
  ): Promise<number | undefined> {
    const [row] = await transaction
      .update(integrationRevision)
      .set({ revision: sql`${integrationRevision.revision} + 1`, updatedAt: now })
      .where(
        and(
          eq(integrationRevision.id, REVISION_ROW_ID),
          eq(integrationRevision.revision, expected),
        ),
      )
      .returning({ revision: integrationRevision.revision });
    return row?.revision;
  }

  /** One identity row per installed provider. Not a configuration change: the revision does not move. */
  async ensure(entries: readonly { kind: IntegrationKind; providerCode: string }[]): Promise<void> {
    if (entries.length === 0) return;
    await this.db
      .insert(integration)
      .values(entries.map((entry) => ({ kind: entry.kind, providerCode: entry.providerCode })))
      .onConflictDoNothing({ target: [integration.kind, integration.providerCode] });
  }

  async list(executor: DbExecutor = this.db): Promise<IntegrationRow[]> {
    return executor
      .select()
      .from(integration)
      .orderBy(asc(integration.kind), asc(integration.providerCode));
  }

  async findById(id: string, executor: DbExecutor = this.db): Promise<IntegrationRow | undefined> {
    const [row] = await executor.select().from(integration).where(eq(integration.id, id));
    return row;
  }

  /** Serializes the changes of one integration (generation numbering, the single candidate). */
  async findByIdForUpdate(
    id: string,
    transaction: DbExecutor,
  ): Promise<IntegrationRow | undefined> {
    const [row] = await transaction
      .select()
      .from(integration)
      .where(eq(integration.id, id))
      .for("update");
    return row;
  }

  async storedSecrets(
    integrationIds: readonly string[],
    executor: DbExecutor = this.db,
  ): Promise<StoredSecretSummary[]> {
    if (integrationIds.length === 0) return [];
    return executor
      .select({
        integrationId: integrationCredentialVersion.integrationId,
        versionId: integrationCredentialVersion.id,
        generation: integrationCredentialVersion.generation,
        purpose: integrationCredentialVersion.purpose,
        field: integrationSecret.field,
        keyId: integrationSecret.keyId,
        state: integrationCredentialVersion.state,
        savedAt: integrationSecret.createdAt,
      })
      .from(integrationSecret)
      .innerJoin(
        integrationCredentialVersion,
        eq(integrationSecret.versionId, integrationCredentialVersion.id),
      )
      .where(
        and(
          inArray(integrationCredentialVersion.integrationId, [...integrationIds]),
          inArray(integrationCredentialVersion.state, [...VISIBLE_STATES]),
        ),
      )
      .orderBy(
        sql`case ${integrationCredentialVersion.state} when 'candidate' then 0 when 'active' then 1 when 'draining' then 2 else 3 end`,
      );
  }

  async versionHistory(
    integrationIds: readonly string[],
    executor: DbExecutor = this.db,
  ): Promise<(IntegrationVersionResponse & { integrationId: string })[]> {
    if (integrationIds.length === 0) return [];
    const result = await executor.execute<{
      id: string;
      integrationId: string;
      purpose: IntegrationSecretPurpose;
      generation: number;
      state: IntegrationVersionResponse["state"];
      environment: string;
      createdAt: Date;
      fields: string[];
    }>(sql`
      select v.id, v.integration_id as "integrationId", v.purpose, v.generation, v.state, v.environment,
        v.created_at as "createdAt", coalesce((select array_agg(s.field order by s.field) from integration_secret s where s.version_id=v.id), '{}') as fields
      from (select *, row_number() over (partition by integration_id order by generation desc) as rank
        from integration_credential_version where ${inArray(integrationCredentialVersion.integrationId, [...integrationIds])}
        and state <> 'retired') v where v.rank <= 20 order by v.generation desc`);
    return result.rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() }));
  }

  async nextGeneration(transaction: DbExecutor, integrationId: string): Promise<number> {
    const [row] = await transaction
      .select({ latest: sql<number>`coalesce(max(${integrationCredentialVersion.generation}), 0)` })
      .from(integrationCredentialVersion)
      .where(eq(integrationCredentialVersion.integrationId, integrationId));
    return Number(row?.latest ?? 0) + 1;
  }

  async findCandidateForUpdate(
    transaction: DbExecutor,
    integrationId: string,
    purpose: IntegrationSecretPurpose,
  ): Promise<CredentialVersionRow | undefined> {
    const [row] = await transaction
      .select()
      .from(integrationCredentialVersion)
      .where(
        and(
          eq(integrationCredentialVersion.integrationId, integrationId),
          eq(integrationCredentialVersion.purpose, purpose),
          eq(integrationCredentialVersion.state, "candidate"),
        ),
      )
      .for("update");
    return row;
  }

  async findVersion(
    versionId: string,
    executor: DbExecutor = this.db,
  ): Promise<CredentialVersionRow | undefined> {
    const [row] = await executor
      .select()
      .from(integrationCredentialVersion)
      .where(eq(integrationCredentialVersion.id, versionId));
    return row;
  }

  async findVersionForUpdate(
    transaction: DbExecutor,
    versionId: string,
  ): Promise<CredentialVersionRow | undefined> {
    const [row] = await transaction
      .select()
      .from(integrationCredentialVersion)
      .where(eq(integrationCredentialVersion.id, versionId))
      .for("update");
    return row;
  }

  /** The envelope goes, the version stays as a tombstone, so its generation is never reused. */
  async retire(transaction: DbExecutor, versionId: string, now: Date): Promise<void> {
    await transaction.delete(integrationSecret).where(eq(integrationSecret.versionId, versionId));
    await transaction
      .update(integrationCredentialVersion)
      .set({ state: "retired", retiredAt: now })
      .where(eq(integrationCredentialVersion.id, versionId));
  }

  async insertCandidate(
    transaction: DbExecutor,
    version: {
      id: string;
      integrationId: string;
      generation: number;
      purpose: IntegrationSecretPurpose;
      environment: string;
      createdBy: string;
      createdAt: Date;
    },
    secrets: readonly { id: string; field: string; sealed: SealedSecret }[],
  ): Promise<void> {
    await transaction.insert(integrationCredentialVersion).values({
      id: version.id,
      integrationId: version.integrationId,
      generation: version.generation,
      purpose: version.purpose,
      environment: version.environment,
      state: "candidate",
      createdAt: version.createdAt,
      // The same NULL the foreign key leaves for a deleted admin (only test principals have no row).
      createdBy: sql`(select "id" from "admin_user" where "id" = ${version.createdBy}::uuid)`,
    });
    await transaction.insert(integrationSecret).values(
      secrets.map((secret) => ({
        id: secret.id,
        versionId: version.id,
        field: secret.field,
        keyId: secret.sealed.keyId,
        nonce: secret.sealed.nonce,
        ciphertext: secret.sealed.ciphertext,
        tag: secret.sealed.tag,
        createdAt: version.createdAt,
      })),
    );
  }

  async lockEnabled(transaction: DbExecutor, kind: IntegrationKind): Promise<IntegrationRow[]> {
    return transaction
      .select()
      .from(integration)
      .where(and(eq(integration.kind, kind), eq(integration.enabled, true)))
      .for("update");
  }

  async secretFields(transaction: DbExecutor, versionId: string): Promise<string[]> {
    const rows = await transaction
      .select({ field: integrationSecret.field })
      .from(integrationSecret)
      .where(eq(integrationSecret.versionId, versionId));
    return rows.map((row) => row.field);
  }

  async secretEnvelopes(
    versionId: string,
    executor: DbExecutor = this.db,
  ): Promise<
    {
      id: string;
      field: string;
      keyId: string;
      nonce: Buffer;
      ciphertext: Buffer;
      tag: Buffer;
    }[]
  > {
    return executor
      .select({
        id: integrationSecret.id,
        field: integrationSecret.field,
        keyId: integrationSecret.keyId,
        nonce: integrationSecret.nonce,
        ciphertext: integrationSecret.ciphertext,
        tag: integrationSecret.tag,
      })
      .from(integrationSecret)
      .where(eq(integrationSecret.versionId, versionId));
  }

  async setCredentialState(
    transaction: DbExecutor,
    versionId: string,
    state: "active" | "draining" | "revoked",
    now: Date,
  ): Promise<void> {
    await transaction
      .update(integrationCredentialVersion)
      .set({
        state,
        retiredAt: null,
        revokedAt: state === "revoked" ? now : null,
      })
      .where(eq(integrationCredentialVersion.id, versionId));
  }

  async setOutboundPointer(
    transaction: DbExecutor,
    integrationId: string,
    pointer: { enabled: boolean; versionId: string | null },
    actor: string,
    now: Date,
  ): Promise<void> {
    await transaction
      .update(integration)
      .set({
        enabled: pointer.enabled,
        activeOutboundVersionId: pointer.versionId,
        updatedAt: now,
        updatedBy: sql`(select "id" from "admin_user" where "id" = ${actor}::uuid)`,
      })
      .where(eq(integration.id, integrationId));
  }

  /** The version this mail is already bound to, or null. */
  async emailBinding(
    transaction: DbExecutor,
    messageId: string,
  ): Promise<string | null | undefined> {
    const [row] = await transaction
      .select({ versionId: emailMessage.integrationCredentialVersionId })
      .from(emailMessage)
      .where(eq(emailMessage.id, messageId));
    return row === undefined ? undefined : row.versionId;
  }

  async bindEmail(transaction: DbExecutor, messageId: string, versionId: string): Promise<void> {
    const updated = await transaction
      .update(emailMessage)
      .set({ integrationCredentialVersionId: versionId })
      .where(
        and(eq(emailMessage.id, messageId), isNull(emailMessage.integrationCredentialVersionId)),
      )
      .returning({ id: emailMessage.id });
    if (updated.length === 0) {
      throw new Error("email_credential_bind_lost");
    }
  }

  /** Drops a binding only when this version still owns it and the send provably did not leave. */
  async releaseEmail(transaction: DbExecutor, messageId: string, versionId: string): Promise<void> {
    await transaction
      .update(emailMessage)
      .set({ integrationCredentialVersionId: null })
      .where(
        and(
          eq(emailMessage.id, messageId),
          eq(emailMessage.integrationCredentialVersionId, versionId),
        ),
      );
  }

  async touch(
    transaction: DbExecutor,
    integrationId: string,
    actor: string,
    now: Date,
  ): Promise<void> {
    await transaction
      .update(integration)
      .set({
        updatedAt: now,
        updatedBy: sql`(select "id" from "admin_user" where "id" = ${actor}::uuid)`,
      })
      .where(eq(integration.id, integrationId));
  }
}
