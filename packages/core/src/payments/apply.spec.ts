import { describe, expect, it } from "vitest";
import { normalizeProviderFact, type FactTarget } from "./apply.js";
import type { ProviderPaymentStatus } from "./provider-port.js";
import type { PaymentStatus, RefundStatus } from "./status.js";
import { fact, plusMs, uah } from "./test-support.js";

const T = new Date("2026-10-26T10:00:00.000Z");

function target(
  status: PaymentStatus,
  providerModifiedAt: Date | null = null,
  refunds: { amount: number; status: RefundStatus }[] = [],
): FactTarget {
  return {
    status,
    providerModifiedAt,
    amount: uah(125_000),
    refunds: refunds.map((refund) => ({ amount: uah(refund.amount), status: refund.status })),
  };
}

const at = (status: ProviderPaymentStatus | null, modifiedAt = T) =>
  fact({ status, modifiedAt, finalAmount: status === "succeeded" ? uah(125_000) : null });

describe("normalizeProviderFact: ordering by modifiedAt (M10)", () => {
  it("ignores a fact older than the last applied one, whatever it says", () => {
    const later = plusMs(T, 1);
    for (const status of ["succeeded", "failed", "processing", "reversed", null] as const) {
      expect(
        normalizeProviderFact(at(status), target("processing", later)),
        String(status),
      ).toEqual({ kind: "stale" });
    }
  });

  it("applies the first fact and a newer one", () => {
    expect(normalizeProviderFact(at("processing"), target("awaiting_customer"))).toEqual({
      kind: "apply",
      toStatus: "processing",
      markPaid: false,
      attentionCode: null,
    });
    expect(normalizeProviderFact(at("succeeded", plusMs(T, 1)), target("processing", T))).toEqual({
      kind: "apply",
      toStatus: "succeeded",
      markPaid: true,
      attentionCode: null,
    });
  });

  it("out of order: success then an older processing changes nothing", () => {
    const success = normalizeProviderFact(at("succeeded", plusMs(T, 5)), target("processing", T));
    expect(success).toMatchObject({ kind: "apply", toStatus: "succeeded" });
    expect(
      normalizeProviderFact(at("processing", plusMs(T, 2)), target("succeeded", plusMs(T, 5))),
    ).toEqual({ kind: "stale" });
  });

  it("a tie (equal modifiedAt) is decided by the transition table: forward is applied, backward refused", () => {
    expect(normalizeProviderFact(at("succeeded"), target("processing", T))).toMatchObject({
      kind: "apply",
      toStatus: "succeeded",
    });
    expect(normalizeProviderFact(at("processing"), target("succeeded", T))).toEqual({
      kind: "refused",
      attentionCode: "unexpected_provider_status",
    });
  });

  it("a duplicate (the same status again) is applied without a status change and never marks paid twice", () => {
    expect(normalizeProviderFact(at("succeeded"), target("succeeded", T))).toEqual({
      kind: "apply",
      toStatus: null,
      markPaid: false,
      attentionCode: null,
    });
    expect(normalizeProviderFact(at("processing", plusMs(T, 1)), target("processing", T))).toEqual({
      kind: "apply",
      toStatus: null,
      markPaid: false,
      attentionCode: null,
    });
  });
});

describe("normalizeProviderFact: provider status to attempt status", () => {
  it("maps processing, succeeded, failed and expired; marks paid only on entering succeeded", () => {
    const cases: [ProviderPaymentStatus, PaymentStatus][] = [
      ["processing", "processing"],
      ["succeeded", "succeeded"],
      ["failed", "failed"],
      ["expired", "expired"],
    ];
    for (const [provider, ours] of cases) {
      expect(normalizeProviderFact(at(provider), target("awaiting_customer")), provider).toEqual({
        kind: "apply",
        toStatus: ours,
        markPaid: ours === "succeeded",
        attentionCode: null,
      });
    }
  });

  it("created changes nothing on an attempt that is still being created or waiting", () => {
    for (const status of ["creating", "awaiting_customer", "create_unknown"] as const) {
      expect(normalizeProviderFact(at("created"), target(status)), status).toEqual({
        kind: "apply",
        toStatus: null,
        markPaid: false,
        attentionCode: null,
      });
    }
    expect(normalizeProviderFact(at("created", plusMs(T, 1)), target("processing", T))).toEqual({
      kind: "refused",
      attentionCode: null,
    });
    expect(normalizeProviderFact(at("created", plusMs(T, 1)), target("succeeded", T))).toEqual({
      kind: "refused",
      attentionCode: "unexpected_provider_status",
    });
  });

  it("an unknown provider status changes nothing and raises attention", () => {
    expect(normalizeProviderFact(at(null), target("awaiting_customer"))).toEqual({
      kind: "apply",
      toStatus: null,
      markPaid: false,
      attentionCode: "unknown_provider_status",
    });
    expect(normalizeProviderFact(at("authorized"), target("processing"))).toEqual({
      kind: "apply",
      toStatus: null,
      markPaid: false,
      attentionCode: "unexpected_provider_status",
    });
  });

  it("a late success on a closed attempt is recorded (to be refunded or applied) and asks for markPaid", () => {
    for (const status of ["failed", "expired", "invalidated"] as const) {
      expect(
        normalizeProviderFact(at("succeeded", plusMs(T, 1)), target(status, T)),
        status,
      ).toEqual({
        kind: "apply",
        toStatus: "succeeded",
        markPaid: true,
        attentionCode: null,
      });
    }
  });

  it("a closed attempt never becomes live again", () => {
    for (const status of ["failed", "expired", "invalidated"] as const) {
      expect(
        normalizeProviderFact(at("processing", plusMs(T, 1)), target(status, T)),
        status,
      ).toEqual({ kind: "refused", attentionCode: null });
    }
  });

  it("a newer failure after success is refused with attention", () => {
    expect(normalizeProviderFact(at("failed", plusMs(T, 1)), target("succeeded", T))).toEqual({
      kind: "refused",
      attentionCode: "unexpected_provider_status",
    });
  });
});

describe("normalizeProviderFact: reversed (ADR 0032 decision 7, open question 6)", () => {
  it("after our own full refund (active refunds equal the amount) records no attention", () => {
    expect(
      normalizeProviderFact(
        at("reversed", plusMs(T, 1)),
        target("succeeded", T, [
          { amount: 100_000, status: "succeeded" },
          { amount: 25_000, status: "processing" },
          { amount: 5, status: "failed" },
        ]),
      ),
    ).toEqual({ kind: "apply", toStatus: null, markPaid: false, attentionCode: null });
  });

  it("after succeeded without our full refund is a refund made outside the shop: attention", () => {
    for (const refunds of [[], [{ amount: 124_999, status: "succeeded" as const }]]) {
      expect(
        normalizeProviderFact(at("reversed", plusMs(T, 1)), target("succeeded", T, refunds)),
      ).toEqual({
        kind: "apply",
        toStatus: null,
        markPaid: false,
        attentionCode: "external_reversal",
      });
    }
  });

  it("on a live attempt closes it failed with attention (never paid)", () => {
    for (const status of [
      "creating",
      "awaiting_customer",
      "processing",
      "create_unknown",
    ] as const) {
      expect(normalizeProviderFact(at("reversed"), target(status)), status).toEqual({
        kind: "apply",
        toStatus: "failed",
        markPaid: false,
        attentionCode: "external_reversal",
      });
    }
  });

  it("on a closed attempt changes nothing, with attention", () => {
    for (const status of ["failed", "expired", "invalidated"] as const) {
      expect(
        normalizeProviderFact(at("reversed", plusMs(T, 1)), target(status, T)),
        status,
      ).toEqual({
        kind: "apply",
        toStatus: null,
        markPaid: false,
        attentionCode: "external_reversal",
      });
    }
  });
});

describe("normalizeProviderFact: input checks", () => {
  it("throws on a malformed fact, status or date", () => {
    expect(() =>
      normalizeProviderFact(
        { ...at("succeeded"), modifiedAt: new Date("x") },
        target("processing"),
      ),
    ).toThrow(RangeError);
    expect(() => normalizeProviderFact(at("succeeded"), target("paid" as PaymentStatus))).toThrow(
      RangeError,
    );
    expect(() =>
      normalizeProviderFact(at("succeeded"), {
        ...target("processing"),
        providerModifiedAt: new Date("x"),
      }),
    ).toThrow(RangeError);
  });
});
