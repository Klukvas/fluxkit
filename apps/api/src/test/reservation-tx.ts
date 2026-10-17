import type pg from "pg";
import { expect } from "vitest";
import { withTransaction, type Transaction } from "../common/transaction.js";
import type { Database } from "../database/database.module.js";

/** Runs `work` in its own committed transaction: what a checkout does around the transaction-scoped operations. */
export function inTransaction<T>(
  database: Database,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withTransaction(database, work);
}

/** Thrown on purpose to roll a transaction back after the work under test succeeded. */
export class RollbackOnPurpose extends Error {}

/**
 * Runs `work` in a transaction and rolls it back afterwards, returning what `work` returned. Proves the operation used
 * the CALLER's transaction: if it had opened its own, its writes would survive the rollback.
 */
export async function rolledBack<T>(
  database: Database,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  let captured: { value: T } | undefined;
  try {
    await withTransaction(database, async (tx) => {
      captured = { value: await work(tx) };
      throw new RollbackOnPurpose("rollback");
    });
  } catch (error) {
    if (!(error instanceof RollbackOnPurpose)) {
      throw error;
    }
  }
  if (captured === undefined) {
    throw new Error("The work did not finish.");
  }
  return captured.value;
}

/**
 * Proves that `request` waits for locks held by another transaction: `hold` runs on a client inside a transaction that
 * stays open (take the locks, or even write, there), the request must not settle for 400 ms, and after the commit it
 * must settle (the caller checks the result). The lock statement is chosen by the caller, so it can name a product, a
 * variant or a level row in any lock mode.
 */
export async function expectWaitsForLock<T>(
  pool: pg.Pool,
  hold: (client: pg.PoolClient) => Promise<void>,
  request: () => Promise<T>,
  what: string,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await hold(client);
    let settled = false;
    const pending = request().then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(settled, `${what} must wait for the lock`).toBe(false);
    await client.query("commit");
    return await pending;
  } finally {
    // A no-op after the commit; unblocks the request when an expectation failed above.
    await client.query("rollback");
    client.release();
  }
}

/** `select ... for no key update` of one row by id; fails the test when the row does not exist. */
export async function lockRow(
  client: pg.PoolClient,
  table: "product" | "variant",
  id: string,
): Promise<void> {
  const result = await client.query(`select 1 from ${table} where id = $1 for no key update`, [id]);
  expect(result.rowCount, `the ${table} row to lock exists`).toBe(1);
}

/**
 * Starts `work` in a transaction that is kept OPEN until `release()` is called, after `work` finished. Lets a test
 * hold the locks a transaction-scoped operation took, and start a competing request meanwhile.
 */
export async function holdOpen<T>(
  database: Database,
  work: (tx: Transaction) => Promise<T>,
): Promise<{ result: T; release: () => Promise<void> }> {
  let openGate: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  let ready: (value: T) => void = () => undefined;
  let failed: (error: unknown) => void = () => undefined;
  const started = new Promise<T>((resolve, reject) => {
    ready = resolve;
    failed = reject;
  });
  const finished = withTransaction(database, async (tx) => {
    try {
      ready(await work(tx));
    } catch (error) {
      failed(error);
      throw error;
    }
    await gate;
  });
  // A failure of `work` reaches the caller through `started`; this keeps `finished` from being an unhandled rejection.
  finished.catch(() => undefined);
  const result = await started;
  return {
    result,
    release: async () => {
      openGate();
      await finished;
    },
  };
}
