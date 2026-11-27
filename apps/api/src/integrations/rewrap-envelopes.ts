import type pg from "pg";
import type { SecretsKey } from "@fluxkit/config";
import type { IntegrationKind } from "@fluxkit/core";
import { DISABLED_INTEGRATIONS_CONFIG } from "./integrations.config.js";
import { MerchantBaselineCipher } from "./merchant-baseline-cipher.js";
import { SecretCipher, type SealedSecret } from "./secret-cipher.js";

export const REWRAP_BATCH_SIZE = 100;
type Table = "integration_secret" | "integration_merchant_baseline";
export interface RewrapCounts {
  rewrapped: number;
  alreadyCurrent: number;
  failed: number;
  skipped: number;
  eligible: number;
  remainingPrevious: number;
  unknown: number;
}
export type RewrapTables = Record<Table, RewrapCounts>;
interface EnvelopeRow extends SealedSecret {
  id: string;
  integrationId: string;
  kind: IntegrationKind;
  providerCode: string;
  field: string;
  generation: number;
  environment: string;
}

/** One exact, previously read envelope. A concurrent rewrap/retire is a CAS miss, never an overwrite. */
export async function rewrapEnvelope(
  client: pg.Client,
  table: Table,
  row: EnvelopeRow,
  ring: { current: SecretsKey; previous: SecretsKey },
): Promise<boolean> {
  const secretCipher = new SecretCipher(ring);
  const baselineCipher = new MerchantBaselineCipher({
    ...DISABLED_INTEGRATIONS_CONFIG,
    keyRing: ring,
  });
  const binding = {
    secretId: row.id,
    integrationId: row.integrationId,
    kind: row.kind,
    providerCode: row.providerCode,
    field: row.field,
    generation: row.generation,
  };
  const baselineBinding = {
    baselineId: row.id,
    integrationId: row.integrationId,
    kind: row.kind,
    providerCode: row.providerCode,
    environment: row.environment,
  };
  const plain =
    table === "integration_secret"
      ? secretCipher.open(binding, row)
      : baselineCipher.open(baselineBinding, row);
  const sealed =
    table === "integration_secret"
      ? secretCipher.seal(binding, plain)
      : baselineCipher.seal(baselineBinding, plain);
  await client.query("begin");
  try {
    if (table === "integration_merchant_baseline")
      await client.query("set local fluxkit.baseline_rewrap = 'on'");
    const result = await client.query<SealedSecret>(
      `update ${table} set key_id=$1, nonce=$2, ciphertext=$3, tag=$4 where id=$5 and key_id=$6 returning key_id as "keyId", nonce, ciphertext, tag`,
      [sealed.keyId, sealed.nonce, sealed.ciphertext, sealed.tag, row.id, ring.previous.id],
    );
    const updated = result.rows[0];
    if (
      table === "integration_merchant_baseline" &&
      updated !== undefined &&
      !Buffer.from(baselineCipher.open(baselineBinding, updated), "utf8").equals(
        Buffer.from(plain, "utf8"),
      )
    )
      throw new Error("integration_rewrap_identity_mismatch");
    await client.query("commit");
    return result.rowCount === 1;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function counts(
  client: pg.Client,
  table: Table,
  ring: { current: SecretsKey; previous: SecretsKey },
) {
  const result = await client.query<{ current: number; previous: number; unknown: number }>(
    `select count(*) filter (where key_id=$1)::int as current, count(*) filter (where key_id=$2)::int as previous, count(*) filter (where key_id not in ($1,$2))::int as unknown from ${table}`,
    [ring.current.id, ring.previous.id],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("integration_rewrap_count_failed");
  return row;
}

/** Bounded keyset pages. Failed rows are reported once per run, retained for a subsequent retry. */
export async function rewrapEnvelopes(
  client: pg.Client,
  ring: { current: SecretsKey; previous: SecretsKey },
  options: { dryRun?: boolean; signal?: AbortSignal } = {},
): Promise<RewrapTables> {
  const tables = {} as RewrapTables;
  for (const table of ["integration_secret", "integration_merchant_baseline"] as const) {
    const initial = await counts(client, table, ring);
    const result: RewrapCounts = {
      rewrapped: 0,
      alreadyCurrent: initial.current,
      eligible: initial.previous,
      failed: 0,
      skipped: 0,
      remainingPrevious: initial.previous,
      unknown: initial.unknown,
    };
    let cursor: string | null = null;
    while (!options.dryRun) {
      if (options.signal?.aborted) throw new Error("integration_rewrap_interrupted");
      const page: pg.QueryResult<EnvelopeRow> = await client.query<EnvelopeRow>(
        table === "integration_secret"
          ? `select s.id, s.key_id as "keyId", s.nonce, s.ciphertext, s.tag, v.integration_id as "integrationId", i.kind, i.provider_code as "providerCode", s.field, v.generation, v.environment from integration_secret s join integration_credential_version v on v.id=s.version_id join integration i on i.id=v.integration_id where s.key_id=$1 and ($2::uuid is null or s.id>$2::uuid) order by s.id limit $3`
          : `select id, key_id as "keyId", nonce, ciphertext, tag, integration_id as "integrationId", kind, provider_code as "providerCode", environment from integration_merchant_baseline where key_id=$1 and ($2::uuid is null or id>$2::uuid) order by id limit $3`,
        [ring.previous.id, cursor, REWRAP_BATCH_SIZE],
      );
      if (page.rows.length === 0) break;
      for (const row of page.rows) {
        if (options.signal?.aborted) throw new Error("integration_rewrap_interrupted");
        try {
          if (await rewrapEnvelope(client, table, row, ring)) result.rewrapped++;
          else result.skipped++;
        } catch {
          // Only counts cross this boundary: pg/crypto errors can contain envelope bytes or key material.
          result.failed++;
        }
        cursor = row.id;
      }
    }
    const final = await counts(client, table, ring);
    tables[table] = { ...result, remainingPrevious: final.previous, unknown: final.unknown };
  }
  return tables;
}
