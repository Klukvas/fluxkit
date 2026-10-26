import { describe, expect, it } from "vitest";
import {
  buildPollDedupeKey,
  buildProviderReference,
  buildWebhookDedupeKey,
  refundListCanonicalText,
} from "./keys.js";
import { fact, REFUND_ID, uah } from "./test-support.js";

const HEX = "a".repeat(64);
/** A stand-in for SHA-256 that keeps its input visible (core never hashes; the API passes `node:crypto`). */
const fakeSha = (text: string) => `${String(text.length).padStart(64, "0")}`;

describe("buildProviderReference", () => {
  it("is `<provider>:<providerPaymentId>`, the markPaid reference", () => {
    expect(buildProviderReference("monobank", "p2_9ZgpZVsl3")).toBe("monobank:p2_9ZgpZVsl3");
  });

  it("throws on a malformed code or id", () => {
    expect(() => buildProviderReference("Mono", "p2")).toThrow(RangeError);
    expect(() => buildProviderReference("monobank", "a:b")).toThrow(RangeError);
    expect(() => buildProviderReference("monobank", "")).toThrow(RangeError);
  });
});

describe("buildWebhookDedupeKey", () => {
  it("is `webhook:<sha256 hex of the raw body>`", () => {
    expect(buildWebhookDedupeKey(HEX)).toBe(`webhook:${HEX}`);
  });

  it("throws unless given 64 lower-case hex characters", () => {
    for (const value of ["A".repeat(64), "a".repeat(63), "g".repeat(64), ""]) {
      expect(() => buildWebhookDedupeKey(value), value).toThrow(RangeError);
    }
  });
});

describe("refundListCanonicalText / buildPollDedupeKey", () => {
  const refundA = {
    refundId: REFUND_ID,
    status: "succeeded" as const,
    amount: uah(100),
    modifiedAt: new Date("2026-10-26T11:00:00.000Z"),
  };
  const refundB = { ...refundA, refundId: null, amount: uah(5) };

  it("does not depend on the order of the provider's list", () => {
    expect(refundListCanonicalText([refundA, refundB])).toBe(
      refundListCanonicalText([refundB, refundA]),
    );
    expect(refundListCanonicalText([])).toBe("");
    expect(refundListCanonicalText([refundA])).toBe(
      `${REFUND_ID}|succeeded|100|2026-10-26T11:00:00.000Z`,
    );
  });

  it("is `poll:<status>:<modifiedAt>:<finalAmount>:<refund list hash>`", () => {
    const hashes: string[] = [];
    const sha = (text: string) => {
      hashes.push(text);
      return HEX;
    };
    expect(buildPollDedupeKey(fact({ refunds: [refundA] }), sha)).toBe(
      `poll:success:2026-10-26T10:00:00.000Z:125000:${HEX}`,
    );
    expect(hashes).toEqual([refundListCanonicalText([refundA])]);
    expect(buildPollDedupeKey(fact({ finalAmount: null }), sha)).toBe(
      `poll:success:2026-10-26T10:00:00.000Z:null:${HEX}`,
    );
  });

  it("differs when the status, the time, the final amount or the refund list differ", () => {
    const base = buildPollDedupeKey(fact(), fakeSha);
    expect(buildPollDedupeKey(fact({ providerStatus: "processing" }), fakeSha)).not.toBe(base);
    expect(
      buildPollDedupeKey(fact({ modifiedAt: new Date("2026-10-26T10:00:00.001Z") }), fakeSha),
    ).not.toBe(base);
    expect(buildPollDedupeKey(fact({ finalAmount: uah(124_999) }), fakeSha)).not.toBe(base);
    expect(buildPollDedupeKey(fact({ refunds: [refundA] }), fakeSha)).not.toBe(base);
  });

  it("throws when the hash port answers something that is not a SHA-256 hex digest", () => {
    expect(() => buildPollDedupeKey(fact(), () => "short")).toThrow(RangeError);
  });
});
