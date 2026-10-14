import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireEnv } from "../test/env.js";

const migrationsFolder = new URL("../../drizzle", import.meta.url).pathname;

describe("health_check migration", () => {
  const pool = new pg.Pool({ connectionString: requireEnv("DATABASE_URL") });

  async function tableExists(): Promise<boolean> {
    const result = await pool.query("select to_regclass('public.health_check') as name");
    return result.rows[0].name !== null;
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

  it("applies up, then rolls back with the hand-written down migration", async () => {
    expect(await tableExists()).toBe(false);

    await migrate(drizzle(pool), { migrationsFolder });
    expect(await tableExists()).toBe(true);

    const down = await readFile(`${migrationsFolder}/0000_health_check.down.sql`, "utf8");
    await pool.query(down);
    expect(await tableExists()).toBe(false);
  });
});
