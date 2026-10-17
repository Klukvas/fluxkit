import { summarizeError } from "../common/error-summary.js";
import type { DbExecutor } from "../common/transaction.js";
import type { OrdersService } from "../orders/orders.service.js";
import type { JobsRepository, TimeCursor } from "./jobs.repository.js";

export interface ExpireOrdersOptions {
  /** Orders read per page (default 100). */
  batchSize?: number;
  /** Pages per run (default 50): at most `batchSize * maxBatches` orders per tick; the rest wait for the next one. */
  maxBatches?: number;
}

export interface ExpireOrdersResult {
  /** Due orders looked at. */
  scanned: number;
  expired: number;
  /** A payment or a cancellation got there first (the order lock decides), or the order is not due any more. */
  notDue: number;
  /** One order failed; the others were still processed. Order number and error class only, never personal data. */
  failures: { orderNumber: string; error: string }[];
  /** Stopped at `maxBatches` with a full last page: more due orders may be left. */
  truncated: boolean;
}

export interface ExpireOrdersDeps {
  database: DbExecutor;
  repository: Pick<JobsRepository, "listDueOrders">;
  orders: Pick<OrdersService, "expireOne">;
}

export const DEFAULT_EXPIRE_ORDERS_BATCH = 100;
export const DEFAULT_EXPIRE_ORDERS_MAX_BATCHES = 50;

/**
 * Expires every `awaiting_payment` order with `expires_at <= now`, each through `OrdersService.expireOne` in its own
 * transaction (it locks the order row first, so a payment and the expiry that race have exactly one winner). Pages
 * through the due list with a keyset cursor, so an order that keeps failing is tried once per run and never stalls the
 * loop. Idempotent: an expired order is no longer due. Takes `now`; reads no clock and starts no timer.
 */
export async function expireDueOrders(
  deps: ExpireOrdersDeps,
  now: Date,
  options: ExpireOrdersOptions = {},
): Promise<ExpireOrdersResult> {
  const batchSize = options.batchSize ?? DEFAULT_EXPIRE_ORDERS_BATCH;
  const maxBatches = options.maxBatches ?? DEFAULT_EXPIRE_ORDERS_MAX_BATCHES;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new RangeError("batchSize must be a whole number from 1 to 1000");
  }
  if (!Number.isInteger(maxBatches) || maxBatches < 1) {
    throw new RangeError("maxBatches must be a whole number of at least 1");
  }
  const result: ExpireOrdersResult = {
    scanned: 0,
    expired: 0,
    notDue: 0,
    failures: [],
    truncated: false,
  };
  let after: TimeCursor | undefined;
  for (let page = 1; page <= maxBatches; page += 1) {
    const due = await deps.repository.listDueOrders(deps.database, now, batchSize, after);
    for (const order of due) {
      result.scanned += 1;
      try {
        const outcome = await deps.orders.expireOne(order.id, now);
        if (outcome === "expired") {
          result.expired += 1;
        } else {
          result.notDue += 1;
        }
      } catch (error) {
        result.failures.push({ orderNumber: order.number, error: summarizeError(error) });
      }
    }
    const last = due.at(-1);
    if (due.length < batchSize || last === undefined) {
      return result;
    }
    after = last.cursor;
  }
  result.truncated = true;
  return result;
}
