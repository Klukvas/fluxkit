import { describe, expect, it } from "vitest";
import {
  CUSTOMER_EVENT_TYPES,
  DOMAIN_EVENT_HANDLER_METADATA,
  DOMAIN_EVENT_TYPE_PATTERN,
  ORDER_EVENT_TYPES,
  ORDER_PAYMENTS_PORT,
  buildOrderEventPayload,
  domainEventHandlerMetadata,
  orderEventTypeFor,
} from "./events.js";
import { ORDER_STATUSES } from "./status.js";

describe("event names", () => {
  it("are the events of ADR 0018, dotted lower case (the database CHECK pattern)", () => {
    expect([...ORDER_EVENT_TYPES]).toEqual([
      "order.placed",
      "order.paid",
      "order.cancelled",
      "order.expired",
      "order.fulfilled",
    ]);
    expect([...CUSTOMER_EVENT_TYPES]).toEqual(["customer.registered"]);
    for (const type of [...ORDER_EVENT_TYPES, ...CUSTOMER_EVENT_TYPES]) {
      expect(type).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
    }
    expect(Object.isFrozen(ORDER_EVENT_TYPES)).toBe(true);
  });

  it("the contract constants are the ones the plugins will import", () => {
    expect(DOMAIN_EVENT_HANDLER_METADATA).toBe("fluxkit:domain-event-handler");
    expect(ORDER_PAYMENTS_PORT).toBe("fluxkit:order-payments-port");
  });
});

describe("orderEventTypeFor", () => {
  it("maps the status an order enters to its event, and nothing else", () => {
    expect(orderEventTypeFor("awaiting_payment")).toBe("order.placed");
    expect(orderEventTypeFor("paid")).toBe("order.paid");
    expect(orderEventTypeFor("fulfilled")).toBe("order.fulfilled");
    expect(orderEventTypeFor("cancelled")).toBe("order.cancelled");
    expect(orderEventTypeFor("expired")).toBe("order.expired");
  });

  it("covers every status, one event each", () => {
    const types = ORDER_STATUSES.map((status) => orderEventTypeFor(status));
    expect(new Set(types).size).toBe(ORDER_STATUSES.length);
    for (const type of types) {
      expect(ORDER_EVENT_TYPES).toContain(type);
    }
  });

  it("refuses an unknown status (RangeError)", () => {
    expect(() => orderEventTypeFor("shipped" as never)).toThrow(RangeError);
  });
});

describe("buildOrderEventPayload", () => {
  const ids = {
    orderId: "5b1f2f0e-6a43-4a89-8f0e-1d2c3b4a5f60",
    orderNumber: "7K3M-9QX2",
    status: "paid" as const,
  };

  it("carries the order id, the number and the status, and nothing else (no personal data)", () => {
    const payload = buildOrderEventPayload(ids);
    expect(payload).toEqual({ orderId: ids.orderId, orderNumber: "7K3M-9QX2", status: "paid" });
    expect(Object.isFrozen(payload)).toBe(true);
  });

  it("drops anything extra a caller smuggles in", () => {
    const payload = buildOrderEventPayload({
      ...ids,
      email: "someone@example.com",
      phone: "380501234567",
    } as never);
    expect(Object.keys(payload).sort()).toEqual(["orderId", "orderNumber", "status"]);
  });

  it("refuses a malformed id, number or status (RangeError)", () => {
    expect(() => buildOrderEventPayload({ ...ids, orderId: "not-a-uuid" })).toThrow(RangeError);
    expect(() => buildOrderEventPayload({ ...ids, orderNumber: "someone@example.com" })).toThrow(
      RangeError,
    );
    expect(() => buildOrderEventPayload({ ...ids, status: "shipped" as never })).toThrow(
      RangeError,
    );
  });
});

describe("domainEventHandlerMetadata", () => {
  it("lists the event types a handler receives, once each, frozen", () => {
    const metadata = domainEventHandlerMetadata(["order.paid", "order.paid", "order.expired"]);
    expect([...metadata.eventTypes]).toEqual(["order.paid", "order.expired"]);
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.eventTypes)).toBe(true);
  });

  it("refuses an empty list and a name the outbox could never hold (RangeError)", () => {
    expect(() => domainEventHandlerMetadata([])).toThrow(RangeError);
    expect(() => domainEventHandlerMetadata(["Order.Paid"])).toThrow(RangeError);
    expect(() => domainEventHandlerMetadata(["paid"])).toThrow(RangeError);
    expect(() => domainEventHandlerMetadata(["order.paid", 7 as never])).toThrow(RangeError);
  });

  it("the type pattern accepts every event of the contract", () => {
    for (const type of [...ORDER_EVENT_TYPES, ...CUSTOMER_EVENT_TYPES]) {
      expect(DOMAIN_EVENT_TYPE_PATTERN.test(type)).toBe(true);
    }
  });
});
