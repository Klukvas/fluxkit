import { Logger } from "@nestjs/common";
import pg from "pg";
import { DB_CONNECTION_TIMEOUT_MS } from "../database/database.module.js";

/**
 * Key of the session-level advisory lock that makes ONE process at a time run the jobs. Fixed and documented on
 * purpose: every instance must use the same number. The others in use: 7_426_001 (test schema helpers) and 7_426_002
 * (`pnpm db:migrate`).
 */
export const SCHEDULER_LOCK_KEY = 7_426_003;

export type LockedRun<T> = { acquired: false } | { acquired: true; value: T };

/**
 * Runs `work` while holding the scheduler advisory lock on a DEDICATED connection (never one from the application
 * pool, so the pool can not be starved or left holding a lock). `pg_try_advisory_lock` does not wait: when another
 * process holds the lock, nothing runs and `{acquired: false}` comes back. The lock belongs to the connection, so it is
 * released by the explicit unlock below and, if that fails or the process dies, by the end of the session. A failure of
 * `work` propagates after the lock is released.
 */
export async function withSchedulerLock<T>(
  databaseUrl: string,
  work: () => Promise<T>,
): Promise<LockedRun<T>> {
  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
  });
  // Without a listener a dropped connection would end the process. Only the SQLSTATE or system code is logged
  // (an error text can embed connection details); the lock is gone with the session, and every job is safe to run twice.
  client.on("error", (error: Error & { code?: string }) => {
    new Logger("Scheduler").error(
      `Scheduler lock connection error: ${error.name} code=${error.code ?? "none"}`,
    );
  });
  await client.connect();
  try {
    const attempt = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [SCHEDULER_LOCK_KEY],
    );
    if (attempt.rows[0]?.locked !== true) {
      return { acquired: false };
    }
    try {
      return { acquired: true, value: await work() };
    } finally {
      try {
        await client.query("select pg_advisory_unlock($1)", [SCHEDULER_LOCK_KEY]);
      } catch (error) {
        // Ending the session below releases the lock anyway; say so, and keep the error of `work`, if any.
        new Logger("Scheduler").error(
          `Could not unlock the scheduler lock (the session end releases it): ${error instanceof Error ? error.name : "unknown"}`,
        );
      }
    }
  } finally {
    await client.end();
  }
}
