import { sql } from "drizzle-orm";
import type { Transaction } from "../../common/transaction.js";

export const EMAIL_SUPPRESSION_LOCK_TIMEOUT_MS = 2000;
export const EMAIL_SUPPRESSION_STATEMENT_TIMEOUT_MS = 5000;

/** Ingress owns this transaction; erasure keeps its caller's existing transaction/wait semantics. */
export async function boundEmailSuppressionWaits(tx: Transaction): Promise<void> {
  await tx.execute(
    sql`SET LOCAL lock_timeout = ${sql.raw(String(EMAIL_SUPPRESSION_LOCK_TIMEOUT_MS))}`,
  );
  await tx.execute(
    sql`SET LOCAL statement_timeout = ${sql.raw(String(EMAIL_SUPPRESSION_STATEMENT_TIMEOUT_MS))}`,
  );
}

/**
 * Serialize global safety-state writes for one normalized address, including erasure when no row exists yet.
 * The transaction-scoped lock uses a namespaced database hash; no address is stored in the lock registry.
 */
export async function lockEmailSuppressionAddress(tx: Transaction, address: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('email-suppression:' || ${address}, 0))`,
  );
}
