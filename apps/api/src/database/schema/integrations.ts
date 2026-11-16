import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { adminUser } from "./admin-auth.js";

/**
 * Managed integration credentials (ADR 0058, migration 0019). Same naming conventions as the other schema files.
 *
 * `integration` is one installed provider of one kind; `integration_credential_version` is one immutable generation of
 * one credential of it (a retired version stays as a tombstone); `integration_secret` holds the AES-256-GCM envelope of
 * one field of a version and is deleted when the version is retired. `integration_revision` is a single row whose
 * number rises in the transaction of every change, so two editors cannot overwrite each other and every API instance
 * can tell that something changed.
 *
 * No column holds a plaintext credential, a digest of one or a suffix of one. The envelope is bound to its row, field,
 * provider, generation and key id through the additional authenticated data (core `integrationSecretAad`).
 *
 * The lists and limits mirror packages/core: INTEGRATION_KINDS, INTEGRATION_SECRET_PURPOSES,
 * INTEGRATION_CREDENTIAL_STATES, INTEGRATION_SECRET_FIELD_PATTERN, SECRETS_KEY_ID_PATTERN and
 * INTEGRATION_SECRET_MAX_BYTES. integrations-schema.spec.ts compares them.
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const KIND_LIST = "'email', 'payment', 'shipping'";
const PURPOSE_LIST = "'outbound', 'webhook'";
const STATE_LIST = "'candidate', 'active', 'draining', 'revoked', 'retired'";
const PROVIDER_CODE_PATTERN = "^[a-z][a-z0-9_]{0,63}$";
const FIELD_PATTERN = "^[a-z][a-z0-9_]{0,31}$";
const KEY_ID_PATTERN = "^[A-Za-z0-9_-]{1,32}$";
/** Exported for the spec: AES-256-GCM adds no padding, so the ciphertext is as long as the plaintext. */
export const INTEGRATION_SECRET_CIPHERTEXT_MAX_BYTES = 4096;
export const INTEGRATION_SECRET_NONCE_BYTES = 12;
export const INTEGRATION_SECRET_TAG_BYTES = 16;

export const integrationRevision = pgTable(
  "integration_revision",
  {
    id: smallint("id").primaryKey(),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("integration_revision_singleton_check", sql`${t.id} = 1`),
    check("integration_revision_revision_check", sql`${t.revision} >= 0`),
  ],
);

export const integration = pgTable(
  "integration",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    providerCode: text("provider_code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    foreignKey({
      name: "integration_updated_by_fkey",
      columns: [t.updatedBy],
      foreignColumns: [adminUser.id],
    }).onDelete("set null"),
    uniqueIndex("integration_kind_provider_code_key").on(t.kind, t.providerCode),
    check("integration_kind_check", sql`${t.kind} IN (${sql.raw(KIND_LIST)})`),
    check(
      "integration_provider_code_check",
      sql`${t.providerCode} ~ ${sql.raw(`'${PROVIDER_CODE_PATTERN}'`)}`,
    ),
  ],
);

export const integrationCredentialVersion = pgTable(
  "integration_credential_version",
  {
    id: uuid("id").primaryKey(),
    integrationId: uuid("integration_id").notNull(),
    // Rises by one per integration with every saved credential; never reused, also after a retirement.
    generation: integer("generation").notNull(),
    purpose: text("purpose").notNull(),
    state: text("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "integration_credential_version_integration_id_fkey",
      columns: [t.integrationId],
      foreignColumns: [integration.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "integration_credential_version_created_by_fkey",
      columns: [t.createdBy],
      foreignColumns: [adminUser.id],
    }).onDelete("set null"),
    uniqueIndex("integration_credential_version_generation_key").on(t.integrationId, t.generation),
    // One version waiting for activation and one in use per credential; older ones are draining, revoked or retired.
    uniqueIndex("integration_credential_version_candidate_key")
      .on(t.integrationId, t.purpose)
      .where(sql`${t.state} = 'candidate'`),
    uniqueIndex("integration_credential_version_active_key")
      .on(t.integrationId, t.purpose)
      .where(sql`${t.state} = 'active'`),
    check("integration_credential_version_generation_check", sql`${t.generation} >= 1`),
    check(
      "integration_credential_version_purpose_check",
      sql`${t.purpose} IN (${sql.raw(PURPOSE_LIST)})`,
    ),
    check(
      "integration_credential_version_state_check",
      sql`${t.state} IN (${sql.raw(STATE_LIST)})`,
    ),
    check(
      "integration_credential_version_retired_at_check",
      sql`(${t.state} = 'retired') = (${t.retiredAt} IS NOT NULL)`,
    ),
    check(
      "integration_credential_version_revoked_at_check",
      sql`(${t.state} = 'revoked') = (${t.revokedAt} IS NOT NULL)`,
    ),
  ],
);

export const integrationSecret = pgTable(
  "integration_secret",
  {
    id: uuid("id").primaryKey(),
    versionId: uuid("version_id").notNull(),
    field: text("field").notNull(),
    keyId: text("key_id").notNull(),
    nonce: bytea("nonce").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    tag: bytea("tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "integration_secret_version_id_fkey",
      columns: [t.versionId],
      foreignColumns: [integrationCredentialVersion.id],
    }).onDelete("restrict"),
    uniqueIndex("integration_secret_version_id_field_key").on(t.versionId, t.field),
    // The rewrap of a key rotation pages through the envelopes of one key id.
    index("integration_secret_key_id_idx").on(t.keyId, t.id),
    check("integration_secret_field_check", sql`${t.field} ~ ${sql.raw(`'${FIELD_PATTERN}'`)}`),
    check("integration_secret_key_id_check", sql`${t.keyId} ~ ${sql.raw(`'${KEY_ID_PATTERN}'`)}`),
    check(
      "integration_secret_nonce_check",
      sql`octet_length(${t.nonce}) = ${sql.raw(String(INTEGRATION_SECRET_NONCE_BYTES))}`,
    ),
    check(
      "integration_secret_tag_check",
      sql`octet_length(${t.tag}) = ${sql.raw(String(INTEGRATION_SECRET_TAG_BYTES))}`,
    ),
    check(
      "integration_secret_ciphertext_check",
      sql`octet_length(${t.ciphertext}) BETWEEN 1 AND ${sql.raw(String(INTEGRATION_SECRET_CIPHERTEXT_MAX_BYTES))}`,
    ),
  ],
);
