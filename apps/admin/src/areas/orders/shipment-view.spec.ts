import { ADMIN_OPERATIONS, type AdminOrder, type AdminShipment } from "@fluxkit/api-client";
import {
  INACTIVE_SHIPMENT_STATUSES,
  ROLE_PERMISSIONS,
  SHIPMENT_STATUSES,
  decideShipmentTransition,
} from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { canRun } from "../../permissions";
import {
  SHIPMENT_ACTIONS,
  SHIPMENT_ACTION_OPERATIONS,
  SHIPMENT_STATUS_LIST,
  SHIPMENT_STATUS_TONES,
  STALE_PENDING_MS,
  activeShipment,
  createGate,
  offeredShipmentActions,
  shipmentActor,
  showsCreateForm,
} from "./shipment-view";

const OWNER = [...ROLE_PERMISSIONS.owner];
const MANAGER = [...ROLE_PERMISSIONS.manager];
const VIEWER = [...ROLE_PERMISSIONS.viewer];
const READER = ["orders.read"];
const NOW = new Date("2026-10-25T12:00:00.000Z");

function shipment(overrides: Partial<AdminShipment> = {}): AdminShipment {
  return {
    id: "s1",
    status: "created",
    providerCode: "fake",
    providerService: null,
    trackingNumber: "FAKE000001",
    carrierStatusCode: null,
    carrierStatusAt: null,
    clientReference: "7K3M-9QX2",
    declaredValue: { amount: 18900, currency: "UAH" },
    carrierCost: null,
    payer: "sender",
    weightGrams: 1500,
    lengthMm: 300,
    widthMm: 200,
    heightMm: 100,
    seats: 1,
    createdBy: null,
    createdAt: "2026-10-25T11:00:00.000Z",
    updatedAt: "2026-10-25T11:00:00.000Z",
    cancelledAt: null,
    deliveredAt: null,
    nextTrackAt: null,
    history: [],
    ...overrides,
  };
}

const carrier = {
  methodId: null,
  methodCode: "courier",
  kind: "address",
  providerCode: "fake",
  amount: { amount: 0, currency: "UAH" },
  payer: "shop_charge",
  estimatedCarrierAmount: null,
  destination: null,
  providerService: null,
  title: { uk: "Кур'єр" },
} as const;

function orderOf(overrides: Partial<Pick<AdminOrder, "status" | "shipping" | "shipments">> = {}) {
  return { status: "paid" as const, shipping: carrier, shipments: [], ...overrides };
}

describe("shipment statuses", () => {
  it("lists exactly core's statuses, each with a tone", () => {
    expect([...SHIPMENT_STATUS_LIST].sort()).toEqual([...SHIPMENT_STATUSES].sort());
    for (const status of SHIPMENT_STATUS_LIST)
      expect(SHIPMENT_STATUS_TONES[status], status).toBeDefined();
  });

  it("counts every status but cancelled and failed as active (core's inactive statuses)", () => {
    for (const status of SHIPMENT_STATUS_LIST) {
      const expected = !(INACTIVE_SHIPMENT_STATUSES as readonly string[]).includes(status);
      expect(activeShipment([shipment({ status })]) !== null, status).toBe(expected);
    }
    expect(
      activeShipment([
        shipment({ id: "a", status: "failed" }),
        shipment({ id: "b", status: "unknown" }),
      ])?.id,
    ).toBe("b");
    expect(activeShipment([])).toBeNull();
  });
});

describe("the actions offered for a shipment (hints: the server decides)", () => {
  const offered = (
    status: AdminShipment["status"],
    permissions: readonly string[] | null = MANAGER,
  ) => offeredShipmentActions(shipment({ status }), permissions, NOW);

  it("names the API operation of each action and the permission it needs", () => {
    expect(SHIPMENT_ACTION_OPERATIONS).toEqual({
      refresh: "refreshShipment",
      cancel: "cancelShipment",
      label: "getShipmentLabel",
      reconcile: "reconcileShipment",
    });
    expect(ADMIN_OPERATIONS.getShipmentLabel.permission).toBe("orders.read");
    for (const action of ["refresh", "cancel", "reconcile"] as const) {
      expect(ADMIN_OPERATIONS[SHIPMENT_ACTION_OPERATIONS[action]].permission, action).toBe(
        "orders.write",
      );
    }
  });

  it("offers cancel exactly where core lets an admin go to cancelled", () => {
    for (const status of SHIPMENT_STATUSES) {
      const allowed = decideShipmentTransition(status, "cancelled", "admin").ok;
      expect(offered(status).includes("cancel"), status).toBe(allowed);
    }
  });

  it("offers a refresh only for a waybill that is not over (core: it still has a way out, and it exists at the carrier)", () => {
    for (const status of SHIPMENT_STATUSES) {
      const hasWaybill = !["pending", "unknown", "failed", "cancelled"].includes(status);
      const hasWayOut = SHIPMENT_STATUSES.some(
        (to) => to !== status && decideShipmentTransition(status, to, "system").ok,
      );
      expect(offered(status).includes("refresh"), status).toBe(hasWaybill && hasWayOut);
    }
  });

  it("offers the label for a waybill that exists at the carrier, never for pending, unknown, failed or cancelled", () => {
    for (const status of SHIPMENT_STATUSES) {
      expect(offered(status).includes("label"), status).toBe(
        !["pending", "unknown", "failed", "cancelled"].includes(status),
      );
    }
  });

  it("offers 'Check with the carrier' for an unknown shipment, and for a pending one only after two minutes", () => {
    expect(offered("unknown")).toContain("reconcile");
    const at = (ageMs: number) =>
      offeredShipmentActions(
        shipment({ status: "pending", createdAt: new Date(NOW.getTime() - ageMs).toISOString() }),
        MANAGER,
        NOW,
      );
    expect(at(STALE_PENDING_MS - 1)).not.toContain("reconcile");
    expect(at(STALE_PENDING_MS)).toContain("reconcile");
    for (const status of SHIPMENT_STATUSES.filter((s) => s !== "unknown" && s !== "pending")) {
      expect(offered(status), status).not.toContain("reconcile");
    }
  });

  it("offers a reader only the label, and nothing to a viewer or a session without permissions", () => {
    expect(offered("created", READER)).toEqual(["label"]);
    expect(offered("unknown", READER)).toEqual([]);
    expect(offered("created", VIEWER)).toEqual([]);
    expect(offered("created", [])).toEqual([]);
    expect(offered("created", null)).toEqual([]);
    expect(SHIPMENT_ACTIONS).toHaveLength(4);
  });
});

describe("the create gate", () => {
  it("is ready only for a paid order with a carrier delivery and no active waybill", () => {
    expect(createGate(orderOf(), MANAGER)).toEqual({ kind: "ready" });
    expect(createGate(orderOf(), OWNER)).toEqual({ kind: "ready" });
  });

  it("keeps the form off until the order is paid, and hides it past shipping", () => {
    for (const status of ["awaiting_payment", "fulfilled", "cancelled", "expired"] as const) {
      const gate = createGate(orderOf({ status }), MANAGER);
      expect(gate, status).toEqual({ kind: "not_paid", status });
      expect(showsCreateForm(gate), status).toBe(status === "awaiting_payment");
    }
    expect(showsCreateForm({ kind: "ready" })).toBe(true);
    expect(showsCreateForm({ kind: "hidden" })).toBe(false);
  });

  it("says why there is no waybill to create: no delivery snapshot, or a method without a carrier", () => {
    expect(createGate(orderOf({ shipping: null }), MANAGER)).toEqual({ kind: "no_carrier" });
    expect(
      createGate(
        orderOf({ shipping: { ...carrier, providerCode: null, kind: "store_pickup" } }),
        MANAGER,
      ),
    ).toEqual({ kind: "no_carrier" });
  });

  it("never offers a second waybill while one is active, an unknown or pending one included", () => {
    for (const status of SHIPMENT_STATUSES) {
      const gate = createGate(orderOf({ shipments: [shipment({ status })] }), MANAGER);
      const active = !(INACTIVE_SHIPMENT_STATUSES as readonly string[]).includes(status);
      expect(gate.kind, status).toBe(active ? "exists" : "ready");
    }
  });

  it("is hidden for a session without orders.write", () => {
    for (const permissions of [READER, VIEWER, [], null]) {
      expect(createGate(orderOf(), permissions)).toEqual({ kind: "hidden" });
    }
  });
});

describe("the shipment permission table per role (owner, manager, viewer)", () => {
  const TABLE = {
    owner: { create: true, act: true },
    manager: { create: true, act: true },
    viewer: { create: false, act: false },
  } as const;
  for (const role of ["owner", "manager", "viewer"] as const) {
    it(`${role}: create ${String(TABLE[role].create)}, actions ${String(TABLE[role].act)}`, () => {
      const permissions = [...ROLE_PERMISSIONS[role]];
      expect(createGate(orderOf(), permissions).kind === "ready").toBe(TABLE[role].create);
      expect(offeredShipmentActions(shipment(), permissions, NOW).length > 0).toBe(TABLE[role].act);
      expect(canRun(permissions, "createShipment")).toBe(TABLE[role].create);
      // The label is a read: it follows orders.read, which the viewer does not hold either.
      expect(canRun(permissions, "getShipmentLabel")).toBe(TABLE[role].act);
    });
  }
});

describe("shipmentActor", () => {
  it("labels the system, an admin account that was deleted, you, and another admin", () => {
    expect(shipmentActor({ actorType: "system", actorAdminId: null }, "me", null)).toEqual({
      kind: "system",
    });
    expect(shipmentActor({ actorType: "admin", actorAdminId: null }, "me", null)).toEqual({
      kind: "removedAdmin",
    });
    expect(shipmentActor({ actorType: "admin", actorAdminId: "me" }, "me", null)).toEqual({
      kind: "you",
    });
    expect(
      shipmentActor({ actorType: "admin", actorAdminId: "12345678-aaaa" }, "me", null),
    ).toEqual({
      kind: "other",
      shortId: "12345678",
    });
  });
});
