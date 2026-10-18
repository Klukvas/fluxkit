import type { DomainEventEnvelope } from "@fluxkit/core";
import type { Database } from "../database/database.module.js";
import type { DomainEventHandlerSource } from "./domain-event-handlers.js";
import { eventErrorCode, HandlerTimeoutError } from "./event-error-code.js";
import type { EventLeaseSource } from "./event-leases.js";
import type { JobBudget } from "./job-budget.js";
import { withJobTransaction } from "../common/job-limits.js";
import {
  MAX_DISPATCH_ATTEMPTS,
  type ClaimedEvent,
  type JobsRepository,
  type PendingEvent,
  type TimeCursor,
} from "./jobs.repository.js";

export interface DispatchEventsOptions {
  /** Events listed per page (default 20). */
  batchSize?: number;
  /** Pages per run (default 25). */
  maxBatches?: number;
  /** A handler that has not answered after this long counts as failed (default 30 000 ms). */
  handlerTimeoutMs?: number;
  /** When the budget is used up the run starts no further event and reports `truncated` (default: none; the scheduler passes one). */
  budget?: JobBudget;
}

export interface DispatchEventsResult {
  /** Events this run started an attempt for. */
  scanned: number;
  /** Every matching handler succeeded (or there was none): the event is marked dispatched. */
  dispatched: number;
  /** At least one handler failed: the error code was stored; the event is retried later. */
  failed: number;
  /** Listed events another dispatcher was delivering (or had just finished) at that moment: left to it. */
  skipped: number;
  /** Failed deliveries: which handler, which event, which error code. Ids and codes only, never messages. */
  failures: { eventId: string; type: string; handler: string; code: string }[];
  /** Events whose failed attempt was the last allowed one: they stay undispatched and are no longer picked. */
  abandoned: { eventId: string; type: string }[];
  /** Stopped at `maxBatches` with a full last page, or because the time budget ran out: more events may be due. */
  truncated: boolean;
}

export interface DispatchEventsDeps {
  database: Database;
  repository: Pick<
    JobsRepository,
    "listDueEvents" | "claimEvent" | "markEventDispatched" | "recordEventFailure"
  >;
  handlers: DomainEventHandlerSource;
  /** Opens the dedicated connection that holds the lease of every event being delivered (one per run). */
  leases: EventLeaseSource;
}

export const DEFAULT_DISPATCH_BATCH = 20;
export const DEFAULT_DISPATCH_MAX_BATCHES = 25;
export const DEFAULT_HANDLER_TIMEOUT_MS = 30_000;

async function withTimeout(work: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new HandlerTimeoutError());
    }, ms);
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Delivers due outbox events (ADR 0018, 0025) to the handlers found at startup, at least once.
 *
 * Per event, in this order, and NEVER with a transaction open while a handler runs:
 * 1. the LEASE: a session advisory lock on a dedicated connection (`event-leases.ts`). Held by someone else: skip the
 *    event (`skipped`). It is released when this dispatcher releases it, dies, or loses the connection, so a crashed
 *    dispatcher's event is free again within the server's keepalive window and never stuck;
 * 2. the CLAIM: a short transaction that re-checks the event is still due and COMMITS `attempts + 1`. The attempt is on
 *    record before any handler runs, so a dispatcher that dies (or whose connection is killed, e.g. by
 *    `idle_in_transaction_session_timeout`) in the middle of the handlers cannot make the event run for ever without being
 *    counted: backoff and the limit of `MAX_DISPATCH_ATTEMPTS` apply to it like to a failure;
 * 3. every handler registered for the type (each with `handlerTimeoutMs`), also when an earlier one failed;
 * 4. the RESULT, in a second short transaction: `dispatched_at = now` when every handler succeeded (or none is
 *    registered), else the error code of the first failure.
 *
 * An event is retried at `created_at + (2^attempts - 1) minutes` (anchored to creation: the table stores no time of the
 * last attempt, ADR 0021), at most `MAX_DISPATCH_ATTEMPTS` times; then it stays undispatched and is reported in
 * `abandoned`. A retry calls ALL handlers again, so handlers are idempotent by `event.id`. Each event is attempted at most
 * once per run (keyset cursor). Takes `now`; reads no wall clock (the time budget reads the monotonic clock only to stop).
 */
export async function dispatchDomainEvents(
  deps: DispatchEventsDeps,
  now: Date,
  options: DispatchEventsOptions = {},
): Promise<DispatchEventsResult> {
  const batchSize = options.batchSize ?? DEFAULT_DISPATCH_BATCH;
  const maxBatches = options.maxBatches ?? DEFAULT_DISPATCH_MAX_BATCHES;
  const timeoutMs = options.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new RangeError("batchSize must be a whole number from 1 to 500");
  }
  if (!Number.isInteger(maxBatches) || maxBatches < 1) {
    throw new RangeError("maxBatches must be a whole number of at least 1");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("handlerTimeoutMs must be a positive whole number");
  }
  const result: DispatchEventsResult = {
    scanned: 0,
    dispatched: 0,
    failed: 0,
    skipped: 0,
    failures: [],
    abandoned: [],
    truncated: false,
  };
  const leases = await deps.leases.open();
  try {
    let after: TimeCursor | undefined;
    for (let page = 1; page <= maxBatches; page += 1) {
      const listed: PendingEvent[] = await deps.repository.listDueEvents(
        deps.database,
        now,
        batchSize,
        after,
      );
      for (const candidate of listed) {
        if (options.budget?.exhausted() === true) {
          result.truncated = true;
          return result;
        }
        if (!(await leases.tryAcquire(candidate.id))) {
          result.skipped += 1;
          continue;
        }
        try {
          await deliver(deps, candidate.id, now, timeoutMs, result);
        } finally {
          await leases.release(candidate.id);
        }
      }
      const last = listed.at(-1);
      if (listed.length < batchSize || last === undefined) {
        return result;
      }
      after = last.cursor;
    }
    result.truncated = true;
    return result;
  } finally {
    await leases.close();
  }
}

/** Claim, handlers, result of one event whose lease this dispatcher holds. */
async function deliver(
  deps: DispatchEventsDeps,
  eventId: string,
  now: Date,
  timeoutMs: number,
  result: DispatchEventsResult,
): Promise<void> {
  const claimed: ClaimedEvent | undefined = await withJobTransaction(deps.database, (tx) =>
    deps.repository.claimEvent(tx, eventId, now),
  );
  if (claimed === undefined) {
    // Delivered, given up or not due any more since it was listed (another dispatcher got there first).
    result.skipped += 1;
    return;
  }
  result.scanned += 1;
  const envelope: DomainEventEnvelope = Object.freeze({
    id: claimed.id,
    type: claimed.type,
    aggregateId: claimed.aggregateId,
    payload: claimed.payload,
    // The time the row was inserted: the START of the transaction that wrote it, not its commit (docs/contracts/events.md).
    occurredAt: claimed.createdAt,
    previousFailures: claimed.attempts - 1,
  });
  let firstCode: string | undefined;
  for (const registered of deps.handlers.handlersFor(claimed.type)) {
    try {
      await withTimeout(
        Promise.resolve().then(() => registered.handler.handle(envelope)),
        timeoutMs,
      );
    } catch (error) {
      const code = eventErrorCode(error);
      firstCode ??= code;
      result.failures.push({
        eventId: claimed.id,
        type: claimed.type,
        handler: registered.name,
        code,
      });
    }
  }
  if (firstCode === undefined) {
    await withJobTransaction(deps.database, (tx) =>
      deps.repository.markEventDispatched(tx, claimed.id, now),
    );
    result.dispatched += 1;
    return;
  }
  const attempts = await withJobTransaction(deps.database, (tx) =>
    deps.repository.recordEventFailure(tx, claimed.id, firstCode),
  );
  result.failed += 1;
  if (attempts >= MAX_DISPATCH_ATTEMPTS) {
    result.abandoned.push({ eventId: claimed.id, type: claimed.type });
  }
}
