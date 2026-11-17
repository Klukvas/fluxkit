import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";

const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const when = 1794912832085;

describe("integration runtime migration 0020 (real disposable Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let down: string;

  async function integration(code = `runtime_${randomUUID().replaceAll("-", "").slice(0, 12)}`) {
    const id = randomUUID();
    await pool.query("insert into integration(id, kind, provider_code) values($1, 'email', $2)", [
      id,
      code,
    ]);
    return id;
  }
  let generation = 0;
  async function version(integrationId: string, purpose = "outbound") {
    generation += 1;
    const id = randomUUID();
    await pool.query(
      `insert into integration_credential_version(id, integration_id, generation, purpose, state)
       values($1, $2, $3, $4, 'candidate')`,
      [id, integrationId, generation, purpose],
    );
    return id;
  }
  async function wipe(): Promise<void> {
    await pool.query("update integration set enabled = false, active_outbound_version_id = null");
    await pool.query("update email_message set integration_credential_version_id = null");
    await pool.query("delete from integration_secret");
    await pool.query("delete from integration_credential_version");
    await pool.query("delete from integration");
  }

  beforeAll(async () => {
    await ensureMigrated([], { reset: true });
    down = await readFile(`${folder}/0020_integration_runtime.down.sql`, "utf8");
  });
  afterAll(async () => {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    await pool.end();
  });

  it("keeps a new integration disabled and refuses an enabled row with no version", async () => {
    const id = await integration();
    const row = await pool.query<{ enabled: boolean }>(
      "select enabled, active_outbound_version_id from integration where id = $1",
      [id],
    );
    expect(row.rows[0]).toEqual({ enabled: false, active_outbound_version_id: null });
    await expect(
      pool.query("update integration set enabled = true where id = $1", [id]),
    ).rejects.toThrow(/integration_enabled_pointer_check/);
  });

  it("accepts only an outbound version of the same integration", async () => {
    const id = await integration();
    const other = await integration();
    const own = await version(id);
    const foreign = await version(other);
    const webhook = await version(id, "webhook");
    await expect(
      pool.query("update integration set active_outbound_version_id = $2 where id = $1", [
        id,
        foreign,
      ]),
    ).rejects.toThrow(/integration_outbound_version_mismatch/);
    await expect(
      pool.query("update integration set active_outbound_version_id = $2 where id = $1", [
        id,
        webhook,
      ]),
    ).rejects.toThrow(/integration_outbound_version_mismatch/);
    await pool.query(
      "update integration set enabled = true, active_outbound_version_id = $2 where id = $1",
      [id, own],
    );
    await expect(
      pool.query("delete from integration_credential_version where id = $1", [own]),
    ).rejects.toThrow(/restrict|foreign key/i);
  });

  it("runs up, down, up, down and refuses while a credential is enabled", async () => {
    const id = await integration();
    const own = await version(id);
    await pool.query(
      "update integration set enabled = true, active_outbound_version_id = $2 where id = $1",
      [id, own],
    );
    const client = await pool.connect();
    try {
      await expect(client.query(down)).rejects.toThrow("integration_runtime_rollback_incompatible");
    } finally {
      await client.query("rollback");
      client.release();
    }
    await wipe();
    for (let pass = 0; pass < 2; pass += 1) {
      await pool.query(down);
      const columns = await pool.query<{ name: string }>(
        `select column_name as name from information_schema.columns
         where table_name = 'integration' and column_name in ('enabled', 'active_outbound_version_id')`,
      );
      expect(columns.rows).toEqual([]);
      expect(
        (
          await pool.query("select 1 from drizzle.__drizzle_migrations where created_at = $1", [
            when,
          ])
        ).rows,
      ).toEqual([]);
      await migrate(drizzle(pool), { migrationsFolder: folder });
      const restored = await pool.query<{ enabled: boolean }>(
        "select enabled from integration limit 1",
      );
      expect(restored.rows).toEqual([]);
    }
  });
});
