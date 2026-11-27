import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  INTEGRATION_CREDENTIAL_STATES,
  INTEGRATION_KINDS,
  INTEGRATION_SECRET_FIELD_PATTERN,
  INTEGRATION_SECRET_MAX_BYTES,
  INTEGRATION_SECRET_PURPOSES,
  SECRETS_KEY_ID_PATTERN,
} from "@fluxkit/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import {
  INTEGRATION_SECRET_CIPHERTEXT_MAX_BYTES,
  INTEGRATION_SECRET_NONCE_BYTES,
  INTEGRATION_SECRET_TAG_BYTES,
} from "./schema/integrations.js";

const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const when = 1794859651850;
const previousWhen = 1794837706505;
const TABLES = [
  "integration_revision",
  "integration",
  "integration_credential_version",
  "integration_secret",
] as const;
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

describe("integration credentials migration 0019 (real disposable Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let down: string;

  const constraintOf = async (name: string): Promise<string> =>
    (
      await pool.query<{ definition: string }>(
        "select pg_get_constraintdef(oid) as definition from pg_constraint where conname = $1",
        [name],
      )
    ).rows[0]?.definition ?? "";
  const tablesPresent = async (): Promise<string[]> =>
    (
      await pool.query<{ name: string }>(
        "select tablename as name from pg_tables where schemaname = 'public' and tablename = any($1) order by 1",
        [[...TABLES]],
      )
    ).rows.map((row) => row.name);
  async function expectDownRefused(): Promise<void> {
    const client = await pool.connect();
    try {
      await expect(client.query(down)).rejects.toThrow(
        "integration_credentials_rollback_incompatible",
      );
    } finally {
      // A failed explicit transaction must be rolled back on the same connection.
      await client.query("rollback");
      client.release();
    }
    expect(await tablesPresent()).toHaveLength(4);
  }
  async function newIntegration(code = `spec_${randomUUID().replaceAll("-", "").slice(0, 12)}`) {
    const id = randomUUID();
    await pool.query("insert into integration(id, kind, provider_code) values($1, 'email', $2)", [
      id,
      code,
    ]);
    return id;
  }
  async function newVersion(integrationId: string, generation: number, state = "candidate") {
    const id = randomUUID();
    await pool.query(
      `insert into integration_credential_version(id, integration_id, generation, purpose, state, retired_at, revoked_at)
       values($1, $2, $3, 'outbound', $4, case when $4 = 'retired' then now() end, case when $4 = 'revoked' then now() end)`,
      [id, integrationId, generation, state],
    );
    return id;
  }
  const newSecret = (versionId: string, overrides: Record<string, unknown> = {}) => {
    const row = {
      field: "api_key",
      key_id: "k1",
      nonce: randomBytes(12),
      ciphertext: randomBytes(24),
      tag: randomBytes(16),
      ...overrides,
    };
    return pool.query(
      "insert into integration_secret(id, version_id, field, key_id, nonce, ciphertext, tag) values($1,$2,$3,$4,$5,$6,$7)",
      [randomUUID(), versionId, row.field, row.key_id, row.nonce, row.ciphertext, row.tag],
    );
  };
  async function wipe(): Promise<void> {
    await pool.query("delete from integration_secret");
    await pool.query("delete from integration_credential_version");
    await pool.query("delete from integration");
  }

  beforeAll(async () => {
    await ensureMigrated([], { reset: true });
    down = await readFile(`${folder}/0019_integration_credentials.down.sql`, "utf8");
  });
  afterAll(async () => {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    await pool.end();
  });

  it("creates the single revision row and refuses a second one", async () => {
    expect((await pool.query("select id, revision from integration_revision")).rows).toEqual([
      { id: 1, revision: "0" },
    ]);
    await expect(
      pool.query("insert into integration_revision(id, revision) values(2, 0)"),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    await expect(pool.query("update integration_revision set revision = -1")).rejects.toMatchObject(
      { code: CHECK_VIOLATION },
    );
  });

  it("keeps the database checks equal to the core vocabulary", async () => {
    const kind = await constraintOf("integration_kind_check");
    for (const value of INTEGRATION_KINDS) expect(kind).toContain(`'${value}'`);
    const purpose = await constraintOf("integration_credential_version_purpose_check");
    for (const value of INTEGRATION_SECRET_PURPOSES) expect(purpose).toContain(`'${value}'`);
    const state = await constraintOf("integration_credential_version_state_check");
    for (const value of INTEGRATION_CREDENTIAL_STATES) expect(state).toContain(`'${value}'`);
    expect(await constraintOf("integration_secret_field_check")).toContain(
      INTEGRATION_SECRET_FIELD_PATTERN.source,
    );
    expect(await constraintOf("integration_secret_key_id_check")).toContain(
      SECRETS_KEY_ID_PATTERN.source,
    );
    expect(INTEGRATION_SECRET_CIPHERTEXT_MAX_BYTES).toBe(INTEGRATION_SECRET_MAX_BYTES);
    expect(INTEGRATION_SECRET_NONCE_BYTES).toBe(12);
    expect(INTEGRATION_SECRET_TAG_BYTES).toBe(16);
    expect(await constraintOf("admin_audit_event_target_kind_check")).toContain("'integration'");
  });

  it("refuses identities, versions and envelopes outside the rules", async () => {
    await expect(
      pool.query("insert into integration(kind, provider_code) values('sms', 'x')"),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    await expect(
      pool.query("insert into integration(kind, provider_code) values('email', 'Bad Code')"),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    const integrationId = await newIntegration("dupe_code");
    await expect(
      pool.query("insert into integration(kind, provider_code) values('email', 'dupe_code')"),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    // The same code under another kind is another integration.
    await pool.query("insert into integration(kind, provider_code) values('payment', 'dupe_code')");

    const candidate = await newVersion(integrationId, 1);
    await expect(newVersion(integrationId, 1, "retired")).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
    });
    // One candidate per credential; a retired one does not count.
    await expect(newVersion(integrationId, 2)).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    await newVersion(integrationId, 2, "retired");
    await expect(newVersion(integrationId, 0)).rejects.toMatchObject({ code: CHECK_VIOLATION });
    await expect(newVersion(integrationId, 3, "deleted")).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    });
    await expect(
      pool.query("update integration_credential_version set state = 'retired' where id = $1", [
        candidate,
      ]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    await expect(
      pool.query("update integration_credential_version set revoked_at = now() where id = $1", [
        candidate,
      ]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });

    await newSecret(candidate);
    await expect(newSecret(candidate)).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    for (const bad of [
      { field: "other", nonce: randomBytes(11) },
      { field: "other", nonce: randomBytes(16) },
      { field: "other", tag: randomBytes(12) },
      { field: "other", ciphertext: Buffer.alloc(0) },
      { field: "other", ciphertext: randomBytes(4097) },
      { field: "other", key_id: "has space" },
      { field: "Bad Field" },
    ]) {
      await expect(newSecret(candidate, bad)).rejects.toMatchObject({ code: CHECK_VIOLATION });
    }
    // A version cannot disappear under its envelope, an integration not under its versions.
    await expect(
      pool.query("delete from integration_credential_version where id = $1", [candidate]),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    await expect(
      pool.query("delete from integration where id = $1", [integrationId]),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    await wipe();
  });

  it("refuses to roll back while a credential, a tombstone or its audit evidence exists", async () => {
    const integrationId = await newIntegration();
    const version = await newVersion(integrationId, 1);
    await newSecret(version);
    await expectDownRefused();

    // The envelope is gone, the tombstone stays: still refused.
    await pool.query("delete from integration_secret where version_id = $1", [version]);
    await pool.query(
      "update integration_credential_version set state = 'retired', retired_at = now() where id = $1",
      [version],
    );
    await expectDownRefused();
    await wipe();

    for (const [action, kind] of [
      ["integration.secret_changed", "integration"],
      ["admin_user.step_up_failed", "admin_user"],
    ] as const) {
      const client = await pool.connect();
      try {
        // The audit log is append-only, so the evidence lives only inside this rolled-back transaction.
        await client.query("begin");
        await client.query(
          "insert into admin_audit_event(action, target_kind, target_id, detail) values($1, $2, $3, '{}')",
          [action, kind, randomUUID()],
        );
        await expect(
          client.query(down.replace(/^BEGIN;/m, "").replace(/COMMIT;\s*$/, "")),
        ).rejects.toThrow("integration_credentials_rollback_incompatible");
      } finally {
        await client.query("rollback");
        client.release();
      }
    }
    expect(await tablesPresent()).toHaveLength(4);
  });

  it("runs up, down, up, down with the exact journal row and restores the audit target kinds", async () => {
    // Identity rows alone hold no credential: they do not block the rollback.
    await newIntegration();
    // 0021 is not part of this released down script. Its journal row would block the re-apply below.
    const routeDown = await readFile(`${folder}/0021_email_route_mode.down.sql`, "utf8");
    for (let pass = 0; pass < 2; pass += 1) {
      await pool.query(
        await readFile(`${folder}/0024_managed_shipping_credentials.down.sql`, "utf8"),
      );
      await pool.query(
        await readFile(`${folder}/0023_managed_payment_credentials.down.sql`, "utf8"),
      );
      await pool.query(
        await readFile(`${folder}/0022_integration_credential_environment.down.sql`, "utf8"),
      );
      await pool.query(routeDown);
      await pool.query(down);
      expect(await tablesPresent()).toEqual([]);
      expect(
        (
          await pool.query("select 1 from drizzle.__drizzle_migrations where created_at = $1", [
            when,
          ])
        ).rows,
      ).toEqual([]);
      expect(
        (
          await pool.query("select 1 from drizzle.__drizzle_migrations where created_at = $1", [
            previousWhen,
          ])
        ).rows,
      ).toHaveLength(1);
      const restored = await constraintOf("admin_audit_event_target_kind_check");
      expect(restored).not.toContain("'integration'");
      expect(restored).toContain("'email_suppression'");

      await migrate(drizzle(pool), { migrationsFolder: folder });
      expect(await tablesPresent()).toHaveLength(4);
      expect(
        (
          await pool.query("select 1 from drizzle.__drizzle_migrations where created_at = $1", [
            when,
          ])
        ).rows,
      ).toHaveLength(1);
      expect((await pool.query("select id, revision from integration_revision")).rows).toEqual([
        { id: 1, revision: "0" },
      ]);
      expect((await pool.query("select 1 from integration")).rows).toEqual([]);
    }
  });
});
