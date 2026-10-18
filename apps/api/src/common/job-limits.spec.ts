import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbExecutor } from "./transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { startApp, type RunningApp } from "../test/app.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import { DEFAULT_JOB_LIMITS, withJobTransaction } from "./job-limits.js";

describe("job statement limits (real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let running: RunningApp;
  let database: Database;

  async function setting(db: DbExecutor, name: string): Promise<string> {
    const result = await db.execute<{ value: string }>(
      sql`select current_setting(${name}) as value`,
    );
    return result.rows[0]?.value ?? "";
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp();
    database = running.app.get<Database>(DRIZZLE);
  });

  afterAll(async () => {
    await running.app.close();
    await pool.end();
  });

  it("sets statement_timeout and lock_timeout for the transaction of a job only", async () => {
    const inside = await withJobTransaction(database, async (tx) => ({
      statement: await setting(tx, "statement_timeout"),
      lock: await setting(tx, "lock_timeout"),
    }));
    expect(DEFAULT_JOB_LIMITS).toEqual({ statementTimeoutMs: 30_000, lockTimeoutMs: 5_000 });
    expect(inside).toEqual({ statement: "30s", lock: "5s" });
    // The pool connection is clean again afterwards: the limits did not leak to the next user of it.
    expect(await setting(database, "statement_timeout")).toBe("0");
    expect(await setting(database, "lock_timeout")).toBe("0");
  });

  it("a statement that waits for a row lock longer than lock_timeout fails fast instead of queueing", async () => {
    const holder = await pool.connect();
    await pool.query("create table if not exists job_limits_probe_shared (id int primary key)");
    await pool.query("insert into job_limits_probe_shared values (1) on conflict do nothing");
    await holder.query("begin");
    await holder.query("select 1 from job_limits_probe_shared where id = 1 for update");
    const startedAt = Date.now();
    try {
      await expect(
        withJobTransaction(
          database,
          (tx) => tx.execute(sql`select 1 from job_limits_probe_shared where id = 1 for update`),
          { statementTimeoutMs: 10_000, lockTimeoutMs: 300 },
        ),
      ).rejects.toThrow();
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    } finally {
      await holder.query("rollback");
      holder.release();
      await pool.query("drop table if exists job_limits_probe_shared");
    }
  });

  it("a statement that runs longer than statement_timeout is cancelled", async () => {
    await expect(
      withJobTransaction(database, (tx) => tx.execute(sql`select pg_sleep(5)`), {
        statementTimeoutMs: 200,
        lockTimeoutMs: 200,
      }),
    ).rejects.toThrow();
  });
});
