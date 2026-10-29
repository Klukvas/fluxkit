import { describe, expect, it } from "vitest";
import {
  AUDIT_EVENT_RETENTION_DAYS,
  PRIVACY_REQUEST_RETENTION_DAYS,
  isOrderRetentionDue,
  orderFinalDate,
  retentionCutoff,
  type RetentionOrderFacts,
} from "./retention.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-01T12:00:00.000Z");

const facts = (overrides: Partial<RetentionOrderFacts> = {}): RetentionOrderFacts => ({
  status: "fulfilled",
  fulfilledAt: new Date("2026-01-01T00:00:00.000Z"),
  cancelledAt: null,
  expiredAt: null,
  lastRefundAt: null,
  ...overrides,
});

describe("retentionCutoff", () => {
  it("is exactly N whole days (24 hours each, UTC) before now", () => {
    expect(retentionCutoff(NOW, 1).toISOString()).toBe("2026-10-31T12:00:00.000Z");
    expect(retentionCutoff(NOW, 30).getTime()).toBe(NOW.getTime() - 30 * DAY);
    expect(retentionCutoff(NOW, 1095).getTime()).toBe(NOW.getTime() - 1095 * DAY);
  });

  it("does not depend on the process time zone or a daylight-saving change", () => {
    const across = new Date("2026-03-30T12:00:00.000Z");
    expect(retentionCutoff(across, 7).toISOString()).toBe("2026-03-23T12:00:00.000Z");
  });

  it("does not change its input", () => {
    const now = new Date(NOW);
    retentionCutoff(now, 10);
    expect(now.getTime()).toBe(NOW.getTime());
  });

  it("refuses a period that is not a whole number of days from 1 to 36500", () => {
    for (const bad of [0, -1, 0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 36_501]) {
      expect(() => retentionCutoff(NOW, bad), String(bad)).toThrow(RangeError);
    }
    expect(() => retentionCutoff(new Date(Number.NaN), 5)).toThrow(RangeError);
  });
});

describe("orderFinalDate", () => {
  it("is the fulfilment, cancellation or expiry time of a closed order", () => {
    expect(orderFinalDate(facts())).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(
      orderFinalDate(
        facts({
          status: "cancelled",
          fulfilledAt: null,
          cancelledAt: new Date("2026-02-02T00:00:00.000Z"),
        }),
      ),
    ).toEqual(new Date("2026-02-02T00:00:00.000Z"));
    expect(
      orderFinalDate(
        facts({
          status: "expired",
          fulfilledAt: null,
          expiredAt: new Date("2026-03-03T00:00:00.000Z"),
        }),
      ),
    ).toEqual(new Date("2026-03-03T00:00:00.000Z"));
  });

  it("is the last refund when that is later than the closing time", () => {
    expect(orderFinalDate(facts({ lastRefundAt: new Date("2026-05-05T00:00:00.000Z") }))).toEqual(
      new Date("2026-05-05T00:00:00.000Z"),
    );
    expect(orderFinalDate(facts({ lastRefundAt: new Date("2025-05-05T00:00:00.000Z") }))).toEqual(
      new Date("2026-01-01T00:00:00.000Z"),
    );
  });

  it("is null for an order that is still open", () => {
    expect(orderFinalDate(facts({ status: "awaiting_payment", fulfilledAt: null }))).toBeNull();
    expect(orderFinalDate(facts({ status: "paid", fulfilledAt: null }))).toBeNull();
  });

  it("refuses a closed order without its closing time (corrupt data)", () => {
    expect(() => orderFinalDate(facts({ fulfilledAt: null }))).toThrow(RangeError);
    expect(() => orderFinalDate(facts({ status: "cancelled", fulfilledAt: null }))).toThrow(
      RangeError,
    );
    expect(() => orderFinalDate(facts({ status: "expired", fulfilledAt: null }))).toThrow(
      RangeError,
    );
    expect(() => orderFinalDate(facts({ status: "bogus" as never }))).toThrow(RangeError);
  });
});

describe("isOrderRetentionDue", () => {
  const cutoff = retentionCutoff(NOW, 100);

  it("is due only when the final date is strictly older than the cutoff", () => {
    expect(
      isOrderRetentionDue(facts({ fulfilledAt: new Date(cutoff.getTime() - 1) }), cutoff),
    ).toBe(true);
    expect(isOrderRetentionDue(facts({ fulfilledAt: new Date(cutoff.getTime()) }), cutoff)).toBe(
      false,
    );
    expect(
      isOrderRetentionDue(facts({ fulfilledAt: new Date(cutoff.getTime() + 1) }), cutoff),
    ).toBe(false);
  });

  it("is never due for an open order, however old", () => {
    expect(
      isOrderRetentionDue(
        facts({ status: "awaiting_payment", fulfilledAt: null }),
        new Date(NOW.getTime() + 1000 * DAY),
      ),
    ).toBe(false);
  });

  it("waits for a refund made after the order closed", () => {
    const old = new Date(cutoff.getTime() - 10 * DAY);
    const recentRefund = new Date(cutoff.getTime() + 1 * DAY);
    expect(isOrderRetentionDue(facts({ fulfilledAt: old }), cutoff)).toBe(true);
    expect(
      isOrderRetentionDue(facts({ fulfilledAt: old, lastRefundAt: recentRefund }), cutoff),
    ).toBe(false);
  });
});

describe("retention of the privacy records (ADR 0033 decision 8; TODO(fluxkit): legal review of both periods)", () => {
  it("keeps a request 3 years and an audit event 1 year", () => {
    expect(PRIVACY_REQUEST_RETENTION_DAYS).toBe(1095);
    expect(AUDIT_EVENT_RETENTION_DAYS).toBe(365);
  });
});
