import { Controller, Get, Inject, Module } from "@nestjs/common";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../common/problem.filter.js";
import { startApp, type RunningApp } from "../test/app.js";
import { requireEnv } from "../test/env.js";
import { http } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import { DRIZZLE, type Database } from "./database.module.js";

/** A transaction that sleeps; the test learns its backend process id from here and kills it. */
const slowTransaction = { backendPid: undefined as number | undefined };

async function sleepInTransaction(db: Database): Promise<void> {
  await db.transaction(async (transaction) => {
    const result = await transaction.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    slowTransaction.backendPid = result.rows[0]?.pid;
    await transaction.execute(sql`select pg_sleep(30)`);
  });
}

@Controller("probe-database")
class SlowTransactionController {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Get("slow")
  async slow(): Promise<{ ok: true }> {
    await sleepInTransaction(this.db);
    return { ok: true };
  }

  @Get("fast")
  async fast(): Promise<{ ok: true }> {
    await this.db.execute(sql`select 1`);
    return { ok: true };
  }
}

@Module({ controllers: [SlowTransactionController] })
class ProbeModule {}

async function waitForBackendPid(): Promise<number> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (slowTransaction.backendPid !== undefined) {
      return slowTransaction.backendPid;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The slow transaction never reported its backend process id");
}

describe("database connection loss while a client is checked out", () => {
  let running: RunningApp;
  const killer = new pg.Pool({ connectionString: requireEnv("DATABASE_URL"), max: 1 });

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ extraFeatures: [{ name: "probe", module: ProbeModule }] });
  });

  afterAll(async () => {
    await running.app.close();
    await killer.end();
  });

  async function terminateBackend(): Promise<void> {
    const pid = await waitForBackendPid();
    await killer.query("select pg_terminate_backend($1)", [pid]);
  }

  it("rejects the transaction with an ordinary error and keeps the process alive", async () => {
    slowTransaction.backendPid = undefined;
    const db = running.app.get<Database>(DRIZZLE);
    // The handler is attached at once so the rejection is never unhandled while the backend is being terminated.
    const outcome = sleepInTransaction(db).then(
      () => undefined,
      (error: unknown) => error,
    );
    await terminateBackend();
    expect(await outcome).toBeInstanceOf(Error);
  });

  it("answers 500 problem+json for the request and keeps serving afterwards", async () => {
    slowTransaction.backendPid = undefined;
    const pending = http<ProblemBody>(running.baseUrl, "GET", "/probe-database/slow");
    await terminateBackend();
    const failed = await pending;
    expect(failed.status).toBe(500);
    expect(failed.headers.get("content-type")).toMatch(/application\/problem\+json/);
    expect(failed.body.code).toBe("internal_error");
    const next = await http(running.baseUrl, "GET", "/probe-database/fast");
    expect(next.status).toBe(200);
  });
});
