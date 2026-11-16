import { describe, expect, it } from "vitest";
import {
  EMAIL_SUPPRESSION_REASONS,
  EMAIL_WEBHOOK_EVENT_MAX_AGE_MS,
  EMAIL_WEBHOOK_FUTURE_TOLERANCE_MS,
  EMAIL_WEBHOOK_RECEIPT_TTL_MS,
  validateEmailSuppressionFact,
} from "./webhook.js";

const now = new Date("2026-11-16T12:00:00Z");
const fact = {
  eventKey: "v1:0123",
  recipient: "person@example.test",
  reason: "blocked",
  eventAt: now,
};

describe("provider-independent suppression rules", () => {
  it("allows exactly the suppression reasons, with normalized addresses and bounded opaque event keys", () => {
    for (const reason of EMAIL_SUPPRESSION_REASONS) {
      expect(validateEmailSuppressionFact({ ...fact, reason }, now).ok).toBe(true);
    }
    for (const value of [
      null,
      { ...fact, reason: "soft_bounce" },
      { ...fact, reason: "vendor prose" },
      { ...fact, recipient: "Person@example.test" },
      { ...fact, recipient: " person@example.test " },
      { ...fact, recipient: "invalid" },
      { ...fact, eventKey: "" },
      { ...fact, eventKey: "a".repeat(256) },
      { ...fact, eventKey: "person@example.test" },
      { ...fact, eventAt: new Date("invalid") },
      { ...fact, eventAt: now.toISOString() },
    ])
      expect(validateEmailSuppressionFact(value, now)).toEqual({ ok: false, reason: "malformed" });
    expect(validateEmailSuppressionFact({ ...fact, eventKey: "a".repeat(255) }, now).ok).toBe(true);
  });

  it("accepts inclusive 7-day old / 5-minute future boundaries; refuses one millisecond beyond", () => {
    for (const offset of [-EMAIL_WEBHOOK_EVENT_MAX_AGE_MS, EMAIL_WEBHOOK_FUTURE_TOLERANCE_MS]) {
      const eventAt = new Date(now.getTime() + offset);
      expect(validateEmailSuppressionFact({ ...fact, eventAt }, now).ok).toBe(true);
    }
    for (const offset of [
      -EMAIL_WEBHOOK_EVENT_MAX_AGE_MS - 1,
      EMAIL_WEBHOOK_FUTURE_TOLERANCE_MS + 1,
    ]) {
      const eventAt = new Date(now.getTime() + offset);
      expect(validateEmailSuppressionFact({ ...fact, eventAt }, now)).toEqual({
        ok: false,
        reason: "stale",
      });
    }
    expect(EMAIL_WEBHOOK_RECEIPT_TTL_MS).toBe(8 * 24 * 60 * 60 * 1000);
  });

  it("rejects an invalid reference clock rather than silently accepting replayable facts", () => {
    expect(validateEmailSuppressionFact(fact, new Date("invalid"))).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
