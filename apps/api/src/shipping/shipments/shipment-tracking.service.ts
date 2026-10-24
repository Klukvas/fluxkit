import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  CARRIER_CODE_PATTERN,
  CARRIER_REPORTED_SHIPMENT_STATUSES,
  isTrackedShipmentStatus,
  SHIPPING_LIMITS,
  type CarrierReportedShipmentStatus,
  type ShippingProviderPort,
  type TrackingUpdate,
} from "@fluxkit/core";
import { withJobTransaction, type JobLimits } from "../../common/job-limits.js";
import { withTransaction, type Transaction } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import type { ShipmentRow } from "../../orders/orders.repository.js";
import { ShippingProviderRegistry } from "../registry/shipping-provider-registry.js";
import {
  SHIPMENT_CALL_TIMEOUTS,
  type ShipmentCallTimeouts,
} from "../registry/provider-timeouts.js";
import { callProvider, type ProviderCallOutcome } from "./provider-call.js";
import { ShipmentChanges, type ShipmentActorRef } from "./shipment-changes.js";
import { shipmentStatusOf } from "./shipment-view.js";
import {
  ShipmentsRepository,
  type DueShipment,
  type TrackingCursor,
} from "./shipments.repository.js";
import {
  nextPollAfterAnswer,
  nextPollAfterFailure,
  nextTrackAtOf,
  type NextPoll,
} from "./tracking-schedule.js";

/** What one answered (or failed) poll did to one shipment. */
export type TrackingApplied =
  /** A new status, journalled with an event. */
  | "changed"
  /** The same status (maybe a new carrier code), or the carrier had nothing for this number. */
  | "unchanged"
  /** The carrier reported a status the machine does not allow from here: logged, not applied. */
  | "ignored"
  /** The poll failed: the try count went up and the next poll moved out. */
  | "retry"
  /** No longer polled when the row was locked (cancelled meanwhile, or deleted). Nothing written. */
  | "gone";

export interface TrackingApplyResult {
  readonly applied: TrackingApplied;
  /** The shipment as it is now (`undefined` for `gone` without a row). */
  readonly row: ShipmentRow | undefined;
  /** Still not terminal after 30 days: no next poll is set (the job logs it). */
  readonly gaveUp: boolean;
}

function isUpdate(value: unknown, requested: ReadonlySet<string>): value is TrackingUpdate {
  const update = value as Partial<TrackingUpdate> | null;
  return (
    typeof update === "object" &&
    update !== null &&
    typeof update.trackingNumber === "string" &&
    requested.has(update.trackingNumber) &&
    (update.status === null ||
      CARRIER_REPORTED_SHIPMENT_STATUSES.includes(
        update.status as CarrierReportedShipmentStatus,
      )) &&
    typeof update.carrierStatusCode === "string" &&
    CARRIER_CODE_PATTERN.test(update.carrierStatusCode) &&
    (update.carrierStatusAt === null ||
      (update.carrierStatusAt instanceof Date && !Number.isNaN(update.carrierStatusAt.getTime())))
  );
}

/**
 * Polling a carrier for shipment statuses (ADR 0029 decision 10), shared by the tracking job (actor `system`) and the
 * admin refresh (actor `admin`). The carrier is asked OUTSIDE any transaction (`poll`); each answer is then applied to one
 * shipment in its own short transaction (`applyAnswer`, `applyFailure`) that locks only that shipment row. Tracking never
 * touches the order: fulfilment stays an admin action (the owner's decision; no fulfilment port exists).
 */
@Injectable()
export class ShipmentTrackingService {
  private readonly logger = new Logger("ShipmentTracking");

  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(ShipmentsRepository) private readonly shipments: ShipmentsRepository,
    @Inject(ShipmentChanges) private readonly changes: ShipmentChanges,
    @Inject(ShippingProviderRegistry) private readonly registry: ShippingProviderRegistry,
    @Inject(SHIPMENT_CALL_TIMEOUTS) private readonly timeouts: ShipmentCallTimeouts,
  ) {}

  /** The loaded providers that offer tracking: the only ones the job polls. */
  trackingProviders(): readonly ShippingProviderPort[] {
    return this.registry.list().filter((provider) => provider.capabilities.tracking);
  }

  listDue(now: Date, after: TrackingCursor | undefined, limit: number): Promise<DueShipment[]> {
    return this.shipments.listDue(this.database, {
      now,
      providerCodes: this.trackingProviders().map((provider) => provider.code),
      after,
      limit,
    });
  }

  /**
   * One `track` call for at most `SHIPPING_LIMITS.maxTrackingNumbersPerCall` numbers, with the API's time limit. The
   * answer is keyed by tracking number; an entry that breaks the port (a number we did not ask for, a code that is not a
   * code, a status that is not a carrier status) is dropped and counted in a warning, never stored.
   */
  async poll(
    provider: ShippingProviderPort,
    trackingNumbers: readonly string[],
    phones: readonly string[],
  ): Promise<ProviderCallOutcome<ReadonlyMap<string, TrackingUpdate>>> {
    if (
      trackingNumbers.length === 0 ||
      trackingNumbers.length > SHIPPING_LIMITS.maxTrackingNumbersPerCall
    ) {
      throw new RangeError("A track call takes 1 to maxTrackingNumbersPerCall numbers");
    }
    const outcome = await callProvider(this.timeouts.trackingMs, (signal) =>
      provider.track({ trackingNumbers, phones: [...new Set(phones)] }, signal),
    );
    if (outcome.kind !== "ok") {
      return outcome;
    }
    if (!Array.isArray(outcome.value)) {
      return { kind: "threw", errorName: "MalformedProviderResult" };
    }
    const requested = new Set(trackingNumbers);
    const updates = new Map<string, TrackingUpdate>();
    let dropped = 0;
    for (const entry of outcome.value as unknown[]) {
      if (isUpdate(entry, requested)) {
        updates.set(entry.trackingNumber, entry);
      } else {
        dropped += 1;
      }
    }
    if (dropped > 0) {
      this.logger.warn(
        `Provider ${provider.code} track: ${String(dropped)} answer entries break the port and were dropped`,
      );
    }
    return { kind: "ok", value: updates };
  }

  /**
   * Applies what the carrier answered for one shipment (`update` undefined: it had nothing for that number). A new status
   * goes through `ShipmentChanges` (journal row with the carrier code, event); the same status only refreshes the carrier
   * code. Either way the try count goes back to 0 and the next poll is set by the status (`TRACKING_INTERVAL_MS`).
   */
  applyAnswer(
    shipmentId: string,
    update: TrackingUpdate | undefined,
    actor: ShipmentActorRef,
    now: Date,
    limits?: JobLimits,
  ): Promise<TrackingApplyResult> {
    return this.inTransaction(limits, async (tx) => {
      const row = await this.shipments.lock(tx, shipmentId);
      if (row === undefined || !isTrackedShipmentStatus(shipmentStatusOf(row.status))) {
        return { applied: "gone", row, gaveUp: false };
      }
      const carrierColumns =
        update === undefined
          ? {}
          : {
              carrierStatusCode: update.carrierStatusCode,
              carrierStatusAt: update.carrierStatusAt,
            };
      const status = shipmentStatusOf(row.status);
      if (update?.status !== undefined && update.status !== null && update.status !== status) {
        const poll = nextPollAfterAnswer(update.status, row.createdAt, now);
        const changed = await this.changes.transition(tx, row, update.status, actor, {
          now,
          carrierStatusCode: update.carrierStatusCode,
          columns: { ...carrierColumns, trackingAttempts: 0, nextTrackAt: nextTrackAtOf(poll) },
        });
        if (changed.ok) {
          return { applied: "changed", row: changed.row, gaveUp: poll.kind === "given_up" };
        }
        this.logger.warn(
          `Shipment ${row.id}: the carrier reported ${update.status} (code ${update.carrierStatusCode}) from ${status}, which is not allowed (${changed.reason}); ignored`,
        );
        return this.reschedule(
          tx,
          row,
          {},
          nextPollAfterAnswer(status, row.createdAt, now),
          now,
          "ignored",
        );
      }
      return this.reschedule(
        tx,
        row,
        carrierColumns,
        nextPollAfterAnswer(status, row.createdAt, now),
        now,
        "unchanged",
      );
    });
  }

  /** A failed poll of one shipment: one more try counted, the next poll by the growing delay. Never a status change. */
  applyFailure(shipmentId: string, now: Date, limits?: JobLimits): Promise<TrackingApplyResult> {
    return this.inTransaction(limits, async (tx) => {
      const row = await this.shipments.lock(tx, shipmentId);
      if (row === undefined || !isTrackedShipmentStatus(shipmentStatusOf(row.status))) {
        return { applied: "gone", row, gaveUp: false };
      }
      const attempts = row.trackingAttempts + 1;
      const poll = nextPollAfterFailure(attempts, row.createdAt, now);
      const updated = await this.shipments.update(tx, row.id, {
        trackingAttempts: attempts,
        nextTrackAt: nextTrackAtOf(poll),
        updatedAt: now,
      });
      return { applied: "retry", row: updated, gaveUp: poll.kind === "given_up" };
    });
  }

  private async reschedule(
    tx: Transaction,
    row: ShipmentRow,
    carrierColumns: { carrierStatusCode?: string; carrierStatusAt?: Date | null },
    poll: NextPoll,
    now: Date,
    applied: "unchanged" | "ignored",
  ): Promise<TrackingApplyResult> {
    const updated = await this.shipments.update(tx, row.id, {
      ...carrierColumns,
      trackingAttempts: 0,
      nextTrackAt: nextTrackAtOf(poll),
      updatedAt: now,
    });
    return { applied, row: updated, gaveUp: poll.kind === "given_up" };
  }

  private inTransaction<T>(
    limits: JobLimits | undefined,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    return limits === undefined
      ? withTransaction(this.database, work)
      : withJobTransaction(this.database, work, limits);
  }
}
