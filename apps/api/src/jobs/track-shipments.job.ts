import { Logger } from "@nestjs/common";
import { summarizeError } from "../common/error-summary.js";
import { DEFAULT_JOB_LIMITS, type JobLimits } from "../common/job-limits.js";
import { describeOutcome } from "../shipping/shipments/provider-call.js";
import type {
  ShipmentTrackingService,
  TrackingApplyResult,
} from "../shipping/shipments/shipment-tracking.service.js";
import type { DueShipment, TrackingCursor } from "../shipping/shipments/shipments.repository.js";
import { assertBatchLimits, type BatchLimits } from "./batches.js";
import type { JobBudget } from "./job-budget.js";

/** Pages of 100 shipments (one `track` call per provider and page), at most 5 pages per run (ADR 0029 decision 10). */
export const TRACKING_LIMITS: Readonly<BatchLimits> = Object.freeze({
  batchSize: 100,
  maxBatches: 5,
});

export interface TrackShipmentsResult {
  /** Due shipments looked at. */
  scanned: number;
  /** A new status was applied (journal row and event). */
  changed: number;
  /** The carrier answered without a new status (or had nothing for the number). */
  unchanged: number;
  /** The carrier reported a status the machine does not allow from there (logged). */
  ignored: number;
  /** Shipments whose provider call failed (timeout, error, typed failure): their next poll moved out by the backoff. */
  providerFailures: number;
  /** Still not terminal 30 days after creation: no longer polled (logged as a warning). */
  stopped: number;
  /** Shipments that could not be written (a lock timeout, damaged data): left due for the next run. */
  failures: { shipmentId: string; error: string }[];
  truncated: boolean;
}

export interface TrackShipmentsDeps {
  tracking: Pick<
    ShipmentTrackingService,
    "trackingProviders" | "listDue" | "poll" | "applyAnswer" | "applyFailure"
  >;
}

export interface TrackShipmentsOptions {
  limits?: BatchLimits;
  budget?: JobBudget;
  /** Statement and lock timeouts of each shipment's transaction (default `DEFAULT_JOB_LIMITS`). */
  jobLimits?: JobLimits;
}

const logger = new Logger("Jobs");

/**
 * Job 8 `track-shipments` (ADR 0029 decision 10, ADR 0025 bounds). Pages of due shipments (polled statuses, a waybill
 * number, `next_track_at <= now`, an enabled provider that offers tracking), oldest due first, continued by a
 * `(next_track_at, id)` cursor. Per page and provider ONE `track` call, outside any transaction and with the API's time
 * limit; then one short transaction per shipment that locks only that row. An answered poll applies the status (as the
 * `system` actor) and sets the next poll by status; a failed one counts a try and backs off (5 min doubling, at most
 * 6 h), so a broken carrier does not take the pages of a working one. A row that cannot be written is reported in
 * `failures` and stays due; one bad row or carrier never stops the others. The time budget is checked before each page
 * and each provider call. It never changes an order.
 */
export async function trackShipments(
  deps: TrackShipmentsDeps,
  now: Date,
  options: TrackShipmentsOptions = {},
): Promise<TrackShipmentsResult> {
  const limits = options.limits ?? TRACKING_LIMITS;
  assertBatchLimits(limits);
  const jobLimits = options.jobLimits ?? DEFAULT_JOB_LIMITS;
  const providers = new Map(
    deps.tracking.trackingProviders().map((provider) => [provider.code, provider]),
  );
  const result: TrackShipmentsResult = {
    scanned: 0,
    changed: 0,
    unchanged: 0,
    ignored: 0,
    providerFailures: 0,
    stopped: 0,
    failures: [],
    truncated: false,
  };
  if (providers.size === 0) {
    return result;
  }
  let cursor: TrackingCursor | undefined;
  for (let page = 1; page <= limits.maxBatches; page += 1) {
    if (options.budget?.exhausted() === true) {
      result.truncated = true;
      return result;
    }
    const due = await deps.tracking.listDue(now, cursor, limits.batchSize);
    if (due.length === 0) {
      return result;
    }
    const last = due[due.length - 1];
    if (last !== undefined) {
      cursor = { nextTrackAt: last.nextTrackAt, id: last.id };
    }
    const byProvider = new Map<string, DueShipment[]>();
    for (const shipment of due) {
      byProvider.set(shipment.providerCode, [
        ...(byProvider.get(shipment.providerCode) ?? []),
        shipment,
      ]);
    }
    let group = 0;
    for (const [code, shipments] of byProvider) {
      if (group > 0 && options.budget?.exhausted() === true) {
        result.truncated = true;
        return result;
      }
      group += 1;
      result.scanned += shipments.length;
      const provider = providers.get(code);
      if (provider === undefined) {
        throw new Error(`A due shipment names provider ${code}, which does not track`);
      }
      const outcome = await deps.tracking.poll(
        provider,
        shipments.map((shipment) => shipment.trackingNumber),
        shipments.map((shipment) => shipment.phone),
      );
      if (outcome.kind !== "ok") {
        result.providerFailures += shipments.length;
        logger.warn(
          `Job track-shipments: provider ${code} track ${describeOutcome(outcome)} for ${String(shipments.length)} shipments; they back off`,
        );
      }
      for (const shipment of shipments) {
        try {
          const applied =
            outcome.kind === "ok"
              ? await deps.tracking.applyAnswer(
                  shipment.id,
                  outcome.value.get(shipment.trackingNumber),
                  { type: "system" },
                  now,
                  jobLimits,
                )
              : await deps.tracking.applyFailure(shipment.id, now, jobLimits);
          count(result, applied, shipment.id);
        } catch (error) {
          result.failures.push({ shipmentId: shipment.id, error: summarizeError(error) });
        }
      }
    }
    if (due.length < limits.batchSize) {
      return result;
    }
  }
  result.truncated = true;
  return result;
}

function count(
  result: TrackShipmentsResult,
  applied: TrackingApplyResult,
  shipmentId: string,
): void {
  switch (applied.applied) {
    case "changed":
      result.changed += 1;
      break;
    case "unchanged":
      result.unchanged += 1;
      break;
    case "ignored":
      result.ignored += 1;
      break;
    case "retry":
    case "gone":
      break;
  }
  if (applied.gaveUp) {
    result.stopped += 1;
    logger.warn(
      `Job track-shipments: shipment ${shipmentId} is still ${applied.row?.status ?? "unknown"} 30 days after its creation; it is no longer polled (refresh it by hand)`,
    );
  }
}
