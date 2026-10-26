import { describe, expect, it } from "vitest";
import {
  buildPaymentEventPayload,
  buildRefundEventPayload,
  PAYMENT_EVENT_TYPES,
} from "./events.js";
import { ORDER_ID, PAYMENT_ID, REFUND_ID } from "./test-support.js";

describe("payment events (ADR 0032 decision 18; reserved, not written yet)", () => {
  it("has the two event names", () => {
    expect([...PAYMENT_EVENT_TYPES]).toEqual([
      "payment.status_changed",
      "payment.refund_status_changed",
    ]);
  });

  it("builds payloads of ids, the order number and the status only", () => {
    const extra = { email: "a@b.test", amount: 5 };
    expect(
      buildPaymentEventPayload({
        paymentId: PAYMENT_ID,
        orderId: ORDER_ID,
        orderNumber: "7K3M-9QX2",
        status: "succeeded",
        ...extra,
      } as never),
    ).toEqual({
      paymentId: PAYMENT_ID,
      orderId: ORDER_ID,
      orderNumber: "7K3M-9QX2",
      status: "succeeded",
    });
    const refund = buildRefundEventPayload({
      refundId: REFUND_ID,
      paymentId: PAYMENT_ID,
      orderId: ORDER_ID,
      orderNumber: "7K3M-9QX2",
      status: "unknown",
      ...extra,
    } as never);
    expect(refund).toEqual({
      refundId: REFUND_ID,
      paymentId: PAYMENT_ID,
      orderId: ORDER_ID,
      orderNumber: "7K3M-9QX2",
      status: "unknown",
    });
    expect(Object.isFrozen(refund)).toBe(true);
  });

  it("throws on malformed ids, numbers or statuses", () => {
    const good = {
      paymentId: PAYMENT_ID,
      orderId: ORDER_ID,
      orderNumber: "7K3M-9QX2",
      status: "succeeded" as const,
    };
    expect(() => buildPaymentEventPayload({ ...good, paymentId: "x" })).toThrow(RangeError);
    expect(() => buildPaymentEventPayload({ ...good, orderId: "x" })).toThrow(RangeError);
    expect(() => buildPaymentEventPayload({ ...good, orderNumber: "nope" })).toThrow(RangeError);
    expect(() => buildPaymentEventPayload({ ...good, status: "paid" as never })).toThrow(
      RangeError,
    );
    expect(() => buildRefundEventPayload({ ...good, refundId: "x", status: "succeeded" })).toThrow(
      RangeError,
    );
    expect(() =>
      buildRefundEventPayload({ ...good, refundId: REFUND_ID, status: "creating" as never }),
    ).toThrow(RangeError);
  });
});
