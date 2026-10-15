import type { Database } from "../database/database.module.js";

/** The handle passed to a transaction callback; has the same query builder as the database. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** What repositories accept: the pool-backed database or an open transaction. */
export type DbExecutor = Database | Transaction;

/**
 * Runs `work` in one database transaction: commit when it resolves, rollback when it throws (the error is
 * rethrown unchanged). Use it for every write that touches more than one row, and run read-modify-write rules
 * from core INSIDE it. A failed statement aborts the transaction, so unique-violation retries wrap the whole call.
 */
export async function withTransaction<T>(
  database: Database,
  work: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  return database.transaction(work);
}
