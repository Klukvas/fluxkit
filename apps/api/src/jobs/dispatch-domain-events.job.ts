import type { DomainEventEnvelope } from "@fluxkit/core";
import { withTransaction } from "../common/transaction.js";
import type { Database } from "../database/database.module.js";
import type { DomainEventHandlerSource } from "./domain-event-handlers.js";
import { eventErrorCode, HandlerTimeoutError } from "./event-error-code.js";
import { MAX_DISPATCH_ATTEMPTS, type JobsRepository, type TimeCursor } from "./jobs.repository.js";

export interface DispatchEventsOptions {
  /** Events locked and delivered per transaction (default 20): small, because the row locks last while handlers run. */
  batchSize?: number;
  /** Transactions per run (default 25). */
  maxBatches?: number;
  /** A handler that has not answered after this long counts as failed (default 30 000 ms). */
  handlerTimeoutMs?: number;
}

export interface DispatchEventsResult {
  /** Events picked up (due for an attempt). */
  scanned: number;
  /** Every matching handler succeeded (or there was none): the event is marked dispatched. */
  dispatched: number;
  /** At least one handler failed: attempts and the error code were stored; the event is retried later. */
  failed: number;
  /** Failed deliveries: which handler, which event, which error code. Ids and codes only, never messages. */
  failures: { eventId: string; type: string; handler: string; code: string }[];
  /** Events whose failure just reached `MAX_DISPATCH_ATTEMPTS`: they stay undispatched and are no longer picked. */
  abandoned: { eventId: string; type: string }[];
  /** Stopped at `maxBatches` with a full last batch: more events may be due. */
  truncated: boolean;
}

export interface DispatchEventsDeps {
  database: Database;
  repository: Pick<
    JobsRepository,
    "lockDueEvents" | "markEventDispatched" | "recordEventFailure"
  >;
  handlers: DomainEventHandlerSource;
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
 * Delivers due outbox events (ADR 0018) to the handlers found at startup, at least once.
 *
 * - Oldest first, in small batches; each batch is ONE transaction that holds `FOR UPDATE SKIP LOCKED` on its rows, so
 *   two dispatchers never deliver the same row at the same time. A crash rolls the batch back: those events are delivered again.
 * - An event is DISPATCHED (`dispatched_at = now`) only when every handler registered for its type succeeded, or when no
 *   handler is registered. Every handler is called even if an earlier one failed (one bad handler does not starve the
 *   others), so on a retry the handlers that already succeeded are called again: handlers are idempotent by `event.id`.
 * - A failure stores `attempts + 1` and an error code (class and code, never a message) and the event waits
 *   `created_at + (2^attempts - 1) minutes` before it is picked again; after `MAX_DISPATCH_ATTEMPTS` failures it stays
 *   undispatched, is reported in `abandoned` and is no longer picked.
 * - Each event is attempted at most once per run (keyset cursor). Takes `now`; reads no clock.
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
    failures: [],
    abandoned: [],
    truncated: false,
  };
  let after: TimeCursor | undefined;
  for (let batch = 1; batch <= maxBatches; batch += 1) {
    const cursor = after;
    const step = await withTransaction(deps.database, async (tx) => {
      const events = await deps.repository.lockDueEvents(tx, now, batchSize, cursor);
      const outcome = {
        scanned: events.length,
        dispatched: 0,
        failed: 0,
        failures: [] as DispatchEventsResult["failures"],
        abandoned: [] as DispatchEventsResult["abandoned"],
        last: events.at(-1)?.cursor,
      };
      for (const event of events) {
        const envelope: DomainEventEnvelope = Object.freeze({
          id: event.id,
          type: event.type,
          aggregateId: event.aggregateId,
          payload: event.payload,
          occurredAt: event.createdAt,
          previousFailures: event.attempts,
        });
        let firstCode: string | undefined;
        for (const registered of deps.handlers.handlersFor(event.type)) {
          try {
            await withTimeout(
              Promise.resolve().then(() => registered.handler.handle(envelope)),
              timeoutMs,
            );
          } catch (error) {
            const code = eventErrorCode(error);
            firstCode ??= code;
            outcome.failures.push({
              eventId: event.id,
              type: event.type,
              handler: registered.name,
              code,
            });
          }
        }
        if (firstCode === undefined) {
          await deps.repository.markEventDispatched(tx, event.id, now);
          outcome.dispatched += 1;
          continue;
        }
        const attempts = await deps.repository.recordEventFailure(tx, event.id, firstCode);
        outcome.failed += 1;
        if (attempts >= MAX_DISPATCH_ATTEMPTS) {
          outcome.abandoned.push({ eventId: event.id, type: event.type });
        }
      }
      return outcome;
    });
    // Counted after the commit: a rolled-back batch throws above and is not reported as delivered.
    result.scanned += step.scanned;
    result.dispatched += step.dispatched;
    result.failed += step.failed;
    result.failures.push(...step.failures);
    result.abandoned.push(...step.abandoned);
    if (step.scanned < batchSize || step.last === undefined) {
      return result;
    }
    after = step.last;
  }
  result.truncated = true;
  return result;
}
