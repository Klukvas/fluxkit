import { Logger } from "@nestjs/common";
import pg from "pg";
import { DB_CONNECTION_TIMEOUT_MS } from "../database/database.module.js";

/**
 * Key of the session-level advisory lock that makes ONE process at a time run the jobs. Fixed and documented on
 * purpose: every instance must use the same number. The others in use: 7_426_001 (test schema helpers) and 7_426_002
 * (`pnpm db:migrate`).
 */
export const SCHEDULER_LOCK_KEY = 7_426_003;

/** Shown in `pg_stat_activity`, so an operator (and a test) can tell the lock connection from the pool's. */
export const SCHEDULER_LOCK_APPLICATION_NAME = "fluxkit-scheduler-lock";

export type LockedRun<T> = { acquired: false } | { acquired: true; value: T };

export class SchedulerLockLostError extends Error {
  constructor() {
    super("The scheduler lock connection was lost; no further jobs were started.");
    this.name = "SchedulerLockLostError";
  }
}

/**
 * Runs `work` while holding the scheduler advisory lock on a DEDICATED connection (never one from the application
 * pool, so the pool can not be starved or left holding a lock). `pg_try_advisory_lock` does not wait: when another
 * process holds the lock, nothing runs and `{acquired: false}` comes back. The lock belongs to the connection, so it is
 * released by the explicit unlock below and, if that fails or the process dies, by the end of the session. A failure of
 * `work` propagates after the lock is released; a lost connection aborts its signal and fails the pass.
 */
export async function withSchedulerLock<T>(
  databaseUrl: string,
  work: (lock: { signal: AbortSignal }) => Promise<T>,
): Promise<LockedRun<T>> {
  const controller = new AbortController();
  let closing = false;
  let lockLost: SchedulerLockLostError | undefined;
  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
    application_name: SCHEDULER_LOCK_APPLICATION_NAME,
  });
  // Recorded from the moment the connection opens, not only once `work` runs: a fatal error can arrive in the same read
  // as the reply that grants the lock, and must still keep `work` from starting.
  const loseLock = (code: string): void => {
    if (closing || lockLost !== undefined) {
      return;
    }
    lockLost = new SchedulerLockLostError();
    controller.abort(lockLost);
    new Logger("Scheduler").error(
      `SchedulerLockLostError: scheduler lock connection lost code=${code}`,
    );
  };
  // Without a listener a dropped connection would end the process. Never log error text: it can embed connection details.
  client.on("error", (error: Error & { code?: string }) => {
    if (closing) {
      new Logger("Scheduler").error(
        `Scheduler lock connection error: ${error.name} code=${error.code ?? "none"}`,
      );
    } else {
      loseLock(error.code ?? "none");
    }
  });
  client.on("end", () => loseLock("end"));
  await client.connect();
  try {
    const attempt = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [SCHEDULER_LOCK_KEY],
    );
    if (attempt.rows[0]?.locked !== true) {
      return { acquired: false };
    }
    let result: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      if (controller.signal.aborted) {
        throw controller.signal.reason;
      }
      result = { ok: true, value: await work({ signal: controller.signal }) };
    } catch (error) {
      result = { ok: false, error };
    }
    // Only a loss before `work` settled fails the pass: one during the unlock below started nothing after it, so it is
    // logged (by `loseLock`) and the pass keeps its result.
    const lostDuringWork = lockLost;
    if (lostDuringWork === undefined) {
      try {
        await client.query("select pg_advisory_unlock($1)", [SCHEDULER_LOCK_KEY]);
      } catch (error) {
        // Ending the session below releases the lock anyway; say so, and keep the error of `work`, if any.
        if (!controller.signal.aborted) {
          new Logger("Scheduler").error(
            `Could not unlock the scheduler lock (the session end releases it): ${error instanceof Error ? error.name : "unknown"}`,
          );
        }
      }
    }
    if (lostDuringWork !== undefined) {
      if (!result.ok && result.error !== lostDuringWork) {
        lostDuringWork.cause = result.error;
      }
      throw lostDuringWork;
    }
    if (!result.ok) {
      throw result.error;
    }
    return { acquired: true, value: result.value };
  } finally {
    closing = true;
    await client.end().catch((error: unknown) => {
      // A close that fails because the connection is already lost must not replace the result or the lock-loss error.
      if (lockLost === undefined) {
        throw error;
      }
    });
  }
}
