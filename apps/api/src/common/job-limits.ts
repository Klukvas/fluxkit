import { sql } from "drizzle-orm";
import { withTransaction, type Transaction } from "./transaction.js";
import type { Database } from "../database/database.module.js";

/**
 * Postgres limits on the statements a scheduler job issues (ADR 0025). The jobs run on the application pool (the lock
 * connection of the scheduler only takes and gives back the advisory lock), so the limits are set per transaction with
 * `set_config(..., is_local = true)`: they end with the transaction and never touch a request's connection.
 */
export interface JobLimits {
  /** Longest a single statement may run, lock waits included. */
  statementTimeoutMs: number;
  /** Longest a statement may wait for a row or table lock, so a job fails and is retried instead of queueing behind a stuck writer. */
  lockTimeoutMs: number;
}

export const DEFAULT_JOB_LIMITS: Readonly<JobLimits> = Object.freeze({
  statementTimeoutMs: 30_000,
  lockTimeoutMs: 5_000,
});

export async function applyJobLimits(
  tx: Transaction,
  limits: JobLimits = DEFAULT_JOB_LIMITS,
): Promise<void> {
  // `set_config` takes text; the values are bound parameters, never concatenated.
  await tx.execute(
    sql`select set_config('statement_timeout', ${String(limits.statementTimeoutMs)}, true), set_config('lock_timeout', ${String(limits.lockTimeoutMs)}, true)`,
  );
}

/** A transaction whose first statement sets the job limits. */
export async function withJobTransaction<T>(
  database: Database,
  work: (transaction: Transaction) => Promise<T>,
  limits: JobLimits = DEFAULT_JOB_LIMITS,
): Promise<T> {
  return withTransaction(database, async (tx) => {
    await applyJobLimits(tx, limits);
    return work(tx);
  });
}
