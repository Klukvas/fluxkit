import { describe, expect, it } from "vitest";
import {
  factOf,
  majorAmountOf,
  majorAmountText,
  minorAmountOf,
  readRefundStatus,
} from "./payload.js";

describe("amount conversion", () => {
  it("builds major amounts from integer minor units without float arithmetic", () => {
    expect(majorAmountText({ amount: 1999, currency: "UAH" })).toBe("19.99");
    expect(majorAmountText({ amount: 125_000, currency: "UAH" })).toBe("1250.00");
    expect(majorAmountOf({ amount: 1999, currency: "UAH" })).toBe(19.99);
    expect(majorAmountOf({ amount: 125_000, currency: "UAH" })).toBe(1250);
  });

  it("converts major answers (number or decimal string) to minor units", () => {
    expect(minorAmountOf(19.99)).toBe(1999);
    expect(minorAmountOf("19.99")).toBe(1999);
    expect(minorAmountOf(1250)).toBe(125_000);
    expect(minorAmountOf("1250.00")).toBe(125_000);
    expect(minorAmountOf("1250")).toBe(125_000);
    expect(minorAmountOf("19.999")).toBeUndefined();
    expect(minorAmountOf(-1)).toBeUndefined();
  });
});

describe("factOf status mapping", () => {
  it("maps documented statuses", () => {
    const base = {
      order_id: "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
      amount: 1250,
      currency: "UAH",
      create_date: "2026-11-18 10:00:01",
      end_date: "2026-11-18 10:05:00",
    };
    const success = factOf({ ...base, status: "success" });
    expect(success.ok).toBe(true);
    expect(success.ok && success.fact.status).toBe("succeeded");
    const hold = factOf({ ...base, status: "hold_wait" });
    expect(hold.ok && hold.fact.status).toBe("authorized");
    const threeDs = factOf({ ...base, status: "3ds_verify" });
    expect(threeDs.ok && threeDs.fact.status).toBe("processing");
    const retry = factOf({ ...base, status: "try_again" });
    expect(retry.ok && retry.fact.status).toBe("failed");
    const weird = factOf({ ...base, status: "wait_custom_unknown" });
    expect(weird.ok && weird.fact.status).toBeNull();
    expect(weird.ok && weird.fact.providerStatus).toBe("wait_custom_unknown");
  });

  it("uses order_id as providerPaymentId and reference", () => {
    const read = factOf({
      order_id: "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
      status: "processing",
      amount: 10,
      currency: "UAH",
      create_date: "2026-11-18 10:00:01",
      end_date: "2026-11-18 10:00:02",
    });
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.fact.providerPaymentId).toBe(read.fact.reference);
    }
  });

  it("accepts decimal-string amounts and millisecond epoch dates from docs", () => {
    const read = factOf({
      order_id: "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
      status: "success",
      amount: "19.99",
      currency: "UAH",
      create_date: "1731916801000",
      end_date: "1731917100000",
      sender_card_type: "visa",
      sender_card_mask2: "424242******4242",
      paytype: "card",
    });
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.fact.amount.amount).toBe(1999);
      expect(read.fact.modifiedAt.toISOString()).toBe(new Date(1731917100000).toISOString());
      expect(read.fact.card).toEqual({ system: "visa", last4: "4242" });
    }
  });

  it("prefers sender_card_type over paytype for card.system", () => {
    const withType = factOf({
      order_id: "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
      status: "success",
      amount: 10,
      currency: "UAH",
      create_date: "2026-11-18 10:00:01",
      end_date: "2026-11-18 10:05:00",
      paytype: "card",
      sender_card_type: "mc",
      sender_card_mask2: "555555******4444",
    });
    expect(withType.ok && withType.fact.card).toEqual({ system: "mc", last4: "4444" });
    const paytypeOnly = factOf({
      order_id: "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
      status: "success",
      amount: 10,
      currency: "UAH",
      create_date: "2026-11-18 10:00:01",
      end_date: "2026-11-18 10:05:00",
      paytype: "privat24",
      sender_card_mask2: "555555******4444",
    });
    expect(paytypeOnly.ok && paytypeOnly.fact.card).toEqual({ system: "privat24", last4: "4444" });
  });
});

describe("readRefundStatus", () => {
  it("maps the documented refund answer status reversed to succeeded", () => {
    expect(
      readRefundStatus({
        result: "ok",
        wait_amount: false,
        payment_id: 2417662437,
        status: "reversed",
      }),
    ).toBe("succeeded");
  });
});
