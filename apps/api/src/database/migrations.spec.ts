import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../test/env.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

describe("health_check migration", () => {
  // Destructive: drops the drizzle schema. requireTestDatabaseUrl refuses non-"_test" databases.
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });

  async function tableExists(): Promise<boolean> {
    const result = await pool.query("select to_regclass('public.health_check') as name");
    return result.rows[0].name !== null;
  }

  async function rollback(): Promise<void> {
    await pool.query(await readFile(`${migrationsFolder}/0000_health_check.down.sql`, "utf8"));
  }

  beforeAll(async () => {
    await pool.query('drop schema if exists "drizzle" cascade');
    await pool.query('drop table if exists "health_check"');
  });

  afterAll(async () => {
    await pool.query('drop schema if exists "drizzle" cascade');
    await pool.query('drop table if exists "health_check"');
    await pool.end();
  });

  it("applies up, rolls back with the down migration, and can be applied again", async () => {
    expect(await tableExists()).toBe(false);

    await migrate(drizzle(pool), { migrationsFolder });
    expect(await tableExists()).toBe(true);

    await rollback();
    expect(await tableExists()).toBe(false);

    // The down script must also clear the migrator's bookkeeping, otherwise this second "up" would be a silent no-op.
    await migrate(drizzle(pool), { migrationsFolder });
    expect(await tableExists()).toBe(true);

    await rollback();
    expect(await tableExists()).toBe(false);
  });
});
