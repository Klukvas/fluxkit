import { describe, expect, it } from "vitest";
import { DOMAIN_EVENT_TYPE_PATTERN, ORDER_EVENT_TYPES } from "../orders/events.js";
import { SHIPMENT_EVENT_TYPES, buildShipmentEventPayload, shipmentEventTypeFor } from "./events.js";
import { SHIPMENT_STATUSES } from "./shipment-status.js";
import type { ShipmentStatus } from "./shipment-status.js";

const valid = {
  shipmentId: "0b6d1e8a-5f39-4c43-9a51-7f4c2b0e9d11",
  orderId: "5a0c6f2e-1d7b-4e8a-b3c9-2f1e0d9c8b7a",
  orderNumber: "7K3M-Q9PX",
  status: "created" as ShipmentStatus,
};

describe("shipment events", () => {
  it("names the three events of ADR 0029 decision 12, valid outbox types distinct from the order events", () => {
    expect(SHIPMENT_EVENT_TYPES).toEqual([
      "shipment.created",
      "shipment.status_changed",
      "shipment.cancelled",
    ]);
    for (const type of SHIPMENT_EVENT_TYPES) {
      expect(DOMAIN_EVENT_TYPE_PATTERN.test(type), type).toBe(true);
      expect(ORDER_EVENT_TYPES).not.toContain(type);
    }
  });

  it("maps the status a shipment entered to its event; pending emits none", () => {
    expect(
      Object.fromEntries(SHIPMENT_STATUSES.map((status) => [status, shipmentEventTypeFor(status)])),
    ).toEqual({
      pending: null,
      unknown: "shipment.status_changed",
      created: "shipment.created",
      in_transit: "shipment.status_changed",
      arrived: "shipment.status_changed",
      delivered: "shipment.status_changed",
      returning: "shipment.status_changed",
      returned: "shipment.status_changed",
      cancelled: "shipment.cancelled",
      failed: "shipment.status_changed",
    });
    expect(() => shipmentEventTypeFor("lost" as ShipmentStatus)).toThrow(RangeError);
  });

  it("builds the payload from ids, the order number and the status only", () => {
    const payload = buildShipmentEventPayload({
      ...valid,
      trackingNumber: "20450000000000",
      phone: "+380501234567",
    } as typeof valid);
    expect(payload).toEqual(valid);
    expect(Object.isFrozen(payload)).toBe(true);
  });

  it.each([
    ["shipmentId", "not-a-uuid"],
    ["orderId", ""],
    ["orderNumber", "x"],
    ["status", "lost"],
  ])("throws for a malformed %s", (field, value) => {
    expect(() => buildShipmentEventPayload({ ...valid, [field]: value })).toThrow(RangeError);
  });
});
