import { describe, expect, it } from "vitest";
import {
  CARRIER_REPORTED_SHIPMENT_STATUSES,
  SHIPMENT_ACTORS,
  SHIPMENT_STATUSES,
  SHIPMENT_TRANSITIONS,
  decideShipmentTransition,
  isActiveShipmentStatus,
  isTerminalShipmentStatus,
  isTrackedShipmentStatus,
} from "./shipment-status.js";
import type { ShipmentActor, ShipmentStatus } from "./shipment-status.js";

/** A literal copy of the table in `shipment-status.ts` (from -> to: actors), kept by hand on purpose. */
const EXPECTED: Readonly<Record<string, readonly ShipmentActor[]>> = {
  "null->pending": ["admin"],
  "pending->created": ["admin", "system"],
  "pending->unknown": ["admin", "system"],
  "pending->failed": ["admin", "system"],
  "unknown->created": ["admin", "system"],
  "unknown->failed": ["admin", "system"],
  "created->in_transit": ["admin", "system"],
  "created->arrived": ["admin", "system"],
  "created->delivered": ["admin", "system"],
  "created->returning": ["admin", "system"],
  "created->cancelled": ["admin", "system"],
  "in_transit->arrived": ["admin", "system"],
  "in_transit->delivered": ["admin", "system"],
  "in_transit->returning": ["admin", "system"],
  "arrived->in_transit": ["admin", "system"],
  "arrived->delivered": ["admin", "system"],
  "arrived->returning": ["admin", "system"],
  "returning->returned": ["admin", "system"],
};

describe("the shipment status machine", () => {
  it("lists the ten statuses of ADR 0029", () => {
    expect(SHIPMENT_STATUSES).toEqual([
      "pending",
      "unknown",
      "created",
      "in_transit",
      "arrived",
      "delivered",
      "returning",
      "returned",
      "cancelled",
      "failed",
    ]);
  });

  it("decides the whole start x target x actor matrix exactly as the table", () => {
    const starts: (ShipmentStatus | null)[] = [null, ...SHIPMENT_STATUSES];
    for (const from of starts) {
      for (const to of SHIPMENT_STATUSES) {
        for (const actor of SHIPMENT_ACTORS) {
          const allowed = EXPECTED[`${String(from)}->${to}`];
          const decision = decideShipmentTransition(from, to, actor);
          const label = `${String(from)} -> ${to} by ${actor}`;
          if (allowed === undefined) {
            expect(decision, label).toEqual({ ok: false, reason: "invalid_transition" });
          } else if (allowed.includes(actor)) {
            expect(decision, label).toEqual({ ok: true, from, to });
          } else {
            expect(decision, label).toEqual({ ok: false, reason: "not_allowed_for_actor" });
          }
        }
      }
    }
    expect(SHIPMENT_TRANSITIONS).toHaveLength(Object.keys(EXPECTED).length);
  });

  it("is deeply frozen data", () => {
    expect(Object.isFrozen(SHIPMENT_TRANSITIONS)).toBe(true);
    for (const entry of SHIPMENT_TRANSITIONS) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.actors)).toBe(true);
    }
  });

  it("has the terminal statuses delivered, returned, cancelled and failed", () => {
    expect(SHIPMENT_STATUSES.filter((status) => isTerminalShipmentStatus(status))).toEqual([
      "delivered",
      "returned",
      "cancelled",
      "failed",
    ]);
  });

  it("counts every status but cancelled and failed as the order's active shipment", () => {
    expect(SHIPMENT_STATUSES.filter((status) => !isActiveShipmentStatus(status))).toEqual([
      "cancelled",
      "failed",
    ]);
  });

  it("tracks only shipments with a waybill and no terminal status", () => {
    expect(SHIPMENT_STATUSES.filter((status) => isTrackedShipmentStatus(status))).toEqual([
      "created",
      "in_transit",
      "arrived",
      "returning",
    ]);
  });

  it("lets a carrier report only statuses after creation", () => {
    for (const status of CARRIER_REPORTED_SHIPMENT_STATUSES) {
      expect(SHIPMENT_STATUSES).toContain(status);
    }
    expect(CARRIER_REPORTED_SHIPMENT_STATUSES).not.toContain("pending");
    expect(CARRIER_REPORTED_SHIPMENT_STATUSES).not.toContain("unknown");
    expect(CARRIER_REPORTED_SHIPMENT_STATUSES).not.toContain("failed");
  });

  it("throws for an unknown status or actor", () => {
    expect(() => decideShipmentTransition("lost" as ShipmentStatus, "created", "admin")).toThrow(
      RangeError,
    );
    expect(() => decideShipmentTransition("pending", "lost" as ShipmentStatus, "admin")).toThrow(
      RangeError,
    );
    expect(() => decideShipmentTransition("pending", "created", "guest" as ShipmentActor)).toThrow(
      RangeError,
    );
    expect(() => isTerminalShipmentStatus("lost" as ShipmentStatus)).toThrow(RangeError);
    expect(() => isActiveShipmentStatus("lost" as ShipmentStatus)).toThrow(RangeError);
    expect(() => isTrackedShipmentStatus("lost" as ShipmentStatus)).toThrow(RangeError);
  });
});
