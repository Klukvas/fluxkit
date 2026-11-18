import { describe, expect, it } from "vitest";
import { factOf, majorAmountOf, minorAmountOf } from "./payload.js";

describe("amount conversion", () => {
  it("converts minor to major with two decimals", () => {
    expect(majorAmountOf({ amount: 1999, currency: "UAH" })).toBe(19.99);
    expect(majorAmountOf({ amount: 125_000, currency: "UAH" })).toBe(1250);
  });

  it("converts major answers to minor", () => {
    expect(minorAmountOf(19.99)).toBe(1999);
    expect(minorAmountOf(1250)).toBe(125_000);
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
});