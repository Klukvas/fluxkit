import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, type OrderStatus } from "../orders/status.js";
import { PAYMENT_STATUSES, REFUND_STATUSES } from "../payments/status.js";
import { SHIPMENT_STATUSES } from "../shipping/shipment-status.js";
import { decideErasure, type ErasureOrderFacts } from "./erasure.js";

const order = (overrides: Partial<ErasureOrderFacts> = {}): ErasureOrderFacts => ({
  orderId: "11111111-1111-4111-8111-111111111111",
  orderNumber: "7K3M-9QX2",
  status: "fulfilled",
  contactErased: false,
  paymentStatuses: [],
  refundStatuses: [],
  shipmentStatuses: [],
  ...overrides,
});

describe("decideErasure (ADR 0033 decision 6)", () => {
  it("allows an erasure with no orders at all, with nothing to anonymise", () => {
    expect(decideErasure([])).toEqual({ allowed: true, orders: [] });
  });

  it("anonymises every closed order whose payments, refunds and shipments are final", () => {
    const closed: OrderStatus[] = ["fulfilled", "cancelled", "expired"];
    for (const status of closed) {
      const decision = decideErasure([
        order({
          status,
          paymentStatuses: ["succeeded", "failed", "expired", "invalidated"],
          refundStatuses: ["succeeded", "failed"],
          shipmentStatuses: ["delivered", "returned", "cancelled", "failed"],
        }),
      ]);
      expect(decision, status).toEqual({
        allowed: true,
        orders: [{ orderId: order().orderId, orderNumber: "7K3M-9QX2", action: "anonymise" }],
      });
    }
  });

  it("marks an order whose contact is already erased, so a repeat changes nothing", () => {
    expect(decideErasure([order({ contactErased: true })])).toEqual({
      allowed: true,
      orders: [
        { orderId: order().orderId, orderNumber: "7K3M-9QX2", action: "already_anonymised" },
      ],
    });
  });

  it("blocks on an order that awaits payment", () => {
    expect(decideErasure([order({ status: "awaiting_payment" })])).toEqual({
      allowed: false,
      blockers: [{ orderId: order().orderId, orderNumber: "7K3M-9QX2", reason: "open_order" }],
    });
  });

  it("blocks on a paid order that is not yet fulfilled", () => {
    expect(decideErasure([order({ status: "paid" })])).toEqual({
      allowed: false,
      blockers: [{ orderId: order().orderId, orderNumber: "7K3M-9QX2", reason: "open_order" }],
    });
  });

  it("blocks on each live payment attempt, closed order or not", () => {
    for (const status of [
      "creating",
      "awaiting_customer",
      "processing",
      "create_unknown",
    ] as const) {
      const decision = decideErasure([order({ status: "expired", paymentStatuses: [status] })]);
      expect(decision, status).toEqual({
        allowed: false,
        blockers: [
          { orderId: order().orderId, orderNumber: "7K3M-9QX2", reason: "payment_in_progress" },
        ],
      });
    }
  });

  it("blocks on each refund that is not final", () => {
    for (const status of ["requested", "processing", "unknown"] as const) {
      const decision = decideErasure([order({ refundStatuses: [status] })]);
      expect(decision, status).toEqual({
        allowed: false,
        blockers: [
          { orderId: order().orderId, orderNumber: "7K3M-9QX2", reason: "refund_in_progress" },
        ],
      });
    }
  });

  it("blocks on each shipment that is still moving", () => {
    for (const status of [
      "pending",
      "unknown",
      "created",
      "in_transit",
      "arrived",
      "returning",
    ] as const) {
      const decision = decideErasure([order({ shipmentStatuses: [status] })]);
      expect(decision, status).toEqual({
        allowed: false,
        blockers: [
          { orderId: order().orderId, orderNumber: "7K3M-9QX2", reason: "active_shipment" },
        ],
      });
    }
  });

  it("covers every status of the three machines (a new status must be decided here)", () => {
    const nonBlocking = {
      payments: ["succeeded", "failed", "expired", "invalidated"],
      refunds: ["succeeded", "failed"],
      shipments: ["delivered", "returned", "cancelled", "failed"],
    };
    for (const status of PAYMENT_STATUSES) {
      const blocked = !nonBlocking.payments.includes(status);
      expect(decideErasure([order({ paymentStatuses: [status] })]).allowed, status).toBe(!blocked);
    }
    for (const status of REFUND_STATUSES) {
      const blocked = !nonBlocking.refunds.includes(status);
      expect(decideErasure([order({ refundStatuses: [status] })]).allowed, status).toBe(!blocked);
    }
    for (const status of SHIPMENT_STATUSES) {
      const blocked = !nonBlocking.shipments.includes(status);
      expect(decideErasure([order({ shipmentStatuses: [status] })]).allowed, status).toBe(!blocked);
    }
    for (const status of ORDER_STATUSES) {
      const blocked = status === "awaiting_payment" || status === "paid";
      expect(decideErasure([order({ status })]).allowed, status).toBe(!blocked);
    }
  });

  it("lists every reason of every blocked order, ordered by order number and then reason, once each", () => {
    const decision = decideErasure([
      order({
        orderId: "22222222-2222-4222-8222-222222222222",
        orderNumber: "B-2",
        status: "paid",
        paymentStatuses: ["processing", "creating"],
        shipmentStatuses: ["created", "in_transit"],
      }),
      order({ orderId: "33333333-3333-4333-8333-333333333333", orderNumber: "A-1" }),
      order({
        orderId: "44444444-4444-4444-8444-444444444444",
        orderNumber: "A-0",
        refundStatuses: ["unknown"],
      }),
    ]);
    expect(decision).toEqual({
      allowed: false,
      blockers: [
        {
          orderId: "44444444-4444-4444-8444-444444444444",
          orderNumber: "A-0",
          reason: "refund_in_progress",
        },
        {
          orderId: "22222222-2222-4222-8222-222222222222",
          orderNumber: "B-2",
          reason: "open_order",
        },
        {
          orderId: "22222222-2222-4222-8222-222222222222",
          orderNumber: "B-2",
          reason: "payment_in_progress",
        },
        {
          orderId: "22222222-2222-4222-8222-222222222222",
          orderNumber: "B-2",
          reason: "active_shipment",
        },
      ],
    });
  });

  it("changes nothing when one order of several is blocked (no partial plan)", () => {
    const decision = decideErasure([
      order({ orderNumber: "A-1" }),
      order({
        orderNumber: "A-2",
        orderId: "55555555-5555-4555-8555-555555555555",
        status: "paid",
      }),
    ]);
    expect(decision.allowed).toBe(false);
    expect("orders" in decision).toBe(false);
  });

  it("does not mutate its input", () => {
    const facts = [order({ status: "paid", paymentStatuses: ["processing"] })];
    const copy = JSON.parse(JSON.stringify(facts)) as unknown;
    decideErasure(facts);
    expect(JSON.parse(JSON.stringify(facts))).toEqual(copy);
  });

  it("refuses an unknown status instead of guessing (corrupt data or a bug)", () => {
    expect(() => decideErasure([order({ status: "refunded" as OrderStatus })])).toThrow(RangeError);
    expect(() => decideErasure([order({ paymentStatuses: ["bogus" as never] })])).toThrow(
      RangeError,
    );
    expect(() => decideErasure([order({ refundStatuses: ["bogus" as never] })])).toThrow(
      RangeError,
    );
    expect(() => decideErasure([order({ shipmentStatuses: ["bogus" as never] })])).toThrow(
      RangeError,
    );
  });
});
