import { describe, expect, it } from "vitest";
import { MAX_AMOUNT } from "../pricing/limits.js";
import type { Money } from "../pricing/money.js";
import type { ProviderRefundFact } from "./provider-port.js";
import {
  decideExternalRefund,
  decideRefund,
  externalRefundAmount,
  refundableAmount,
  type IdentifiedRefundRecord,
  type RefundCapabilities,
} from "./refund.js";
import type { RefundStatus } from "./status.js";
import { fact, REFUND_ID } from "./test-support.js";

/*
 * Refunds made outside the shop (review F1 of 2026-10-29): the provider's final amount caps what the shop may still
 * refund, and money returned that our own refunds do not explain raises `external_reversal`. Currencies with minor unit
 * exponents 0 (JPY), 2 (UAH) and 3 (KWD): every amount is an integer of minor units, the exponent never changes a rule.
 */

const both: RefundCapabilities = { partialRefunds: true, multipleRefunds: true };
const OTHER_REFUND_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

const CASES = [
  { currency: "JPY", exponent: 0, paid: 2_000 },
  { currency: "UAH", exponent: 2, paid: 200_000 },
  { currency: "KWD", exponent: 3, paid: 2_000_000 },
] as const;

const money = (amount: number, currency: Money["currency"]): Money => ({ amount, currency });

/** `count` tenths of `paid` in integer arithmetic (every `paid` above is a multiple of 10). */
const tenths = (paid: number, count: number): number => (paid / 10) * count;

function ours(
  amount: number,
  status: RefundStatus,
  currency: Money["currency"],
  id = REFUND_ID,
): IdentifiedRefundRecord {
  return { id, amount: money(amount, currency), status };
}

/** A succeeded refund of ours that an applied fact listed `succeeded` (the stored final amount shows it). */
function reported(amount: number, currency: Money["currency"]): IdentifiedRefundRecord {
  return { ...ours(amount, "succeeded", currency), inFinalAmount: true };
}

function listed(
  amount: number,
  status: ProviderRefundFact["status"],
  currency: Money["currency"],
  refundId: string | null = null,
): ProviderRefundFact {
  return {
    refundId,
    status,
    amount: money(amount, currency),
    modifiedAt: new Date("2026-10-26T11:00:00.000Z"),
  };
}

describe("refundableAmount (the provider's final amount caps the shop's view)", () => {
  for (const { currency, exponent, paid } of CASES) {
    const m = (amount: number) => money(amount, currency);

    it(`${currency} (exponent ${exponent}): without a final amount, or with the full one, it is the amount less our active refunds`, () => {
      expect(refundableAmount({ amount: m(paid), finalAmount: null, refunds: [] })).toEqual(
        m(paid),
      );
      expect(refundableAmount({ amount: m(paid), finalAmount: m(paid), refunds: [] })).toEqual(
        m(paid),
      );
      // The provider has not reported our refund yet (the stored final amount predates it): our records decide.
      expect(
        refundableAmount({
          amount: m(paid),
          finalAmount: m(paid),
          refunds: [ours(tenths(paid, 4), "succeeded", currency)],
        }),
      ).toEqual(m(tenths(paid, 6)));
      // The provider has reported it: the same answer.
      expect(
        refundableAmount({
          amount: m(paid),
          finalAmount: m(tenths(paid, 6)),
          refunds: [reported(tenths(paid, 4), currency)],
        }),
      ).toEqual(m(tenths(paid, 6)));
      for (const status of ["requested", "processing", "unknown"] as const) {
        expect(
          refundableAmount({
            amount: m(paid),
            finalAmount: m(paid),
            refunds: [ours(tenths(paid, 4), status, currency)],
          }),
          status,
        ).toEqual(m(tenths(paid, 6)));
      }
    });

    it(`${currency} (exponent ${exponent}): an external refund lowers it to what the provider still holds`, () => {
      // 40 % refunded in the provider's cabinet.
      expect(
        refundableAmount({ amount: m(paid), finalAmount: m(tenths(paid, 6)), refunds: [] }),
      ).toEqual(m(tenths(paid, 6)));
      // ... and then 40 % by the shop, already reported by the provider: 20 % left, not 60 %.
      expect(
        refundableAmount({
          amount: m(paid),
          finalAmount: m(tenths(paid, 2)),
          refunds: [reported(tenths(paid, 4), currency)],
        }),
      ).toEqual(m(tenths(paid, 2)));
      // ... or not reported yet (the stored final amount still says 60 %): 20 % left as well, never 60 %.
      expect(
        refundableAmount({
          amount: m(paid),
          finalAmount: m(tenths(paid, 6)),
          refunds: [ours(tenths(paid, 4), "succeeded", currency)],
        }),
      ).toEqual(m(tenths(paid, 2)));
      // ... and a shop refund of the rest still in flight: nothing left.
      expect(
        refundableAmount({
          amount: m(paid),
          finalAmount: m(tenths(paid, 6)),
          refunds: [ours(tenths(paid, 6), "processing", currency)],
        }),
      ).toEqual(m(0));
      // Everything returned outside the shop.
      expect(refundableAmount({ amount: m(paid), finalAmount: m(0), refunds: [] })).toEqual(m(0));
      // One minor unit still held, or one minor unit returned.
      expect(refundableAmount({ amount: m(paid), finalAmount: m(1), refunds: [] })).toEqual(m(1));
      expect(refundableAmount({ amount: m(paid), finalAmount: m(paid - 1), refunds: [] })).toEqual(
        m(paid - 1),
      );
    });
  }

  it("never goes below zero, and a failed refund of ours frees only what the provider still holds", () => {
    expect(
      refundableAmount({
        amount: money(200_000, "UAH"),
        finalAmount: money(120_000, "UAH"),
        refunds: [ours(150_000, "unknown", "UAH")],
      }),
    ).toEqual(money(0, "UAH"));
    expect(
      refundableAmount({
        amount: money(200_000, "UAH"),
        finalAmount: money(120_000, "UAH"),
        refunds: [ours(150_000, "failed", "UAH")],
      }),
    ).toEqual(money(120_000, "UAH"));
    // The flag on a refund that is not succeeded means nothing (only a success lowers the final amount).
    expect(
      refundableAmount({
        amount: money(200_000, "UAH"),
        finalAmount: money(200_000, "UAH"),
        refunds: [{ ...ours(50_000, "processing", "UAH"), inFinalAmount: true }],
      }),
    ).toEqual(money(150_000, "UAH"));
  });

  it("throws on a corrupt final amount: above the amount, negative, fractional, unsafe or in another currency", () => {
    const amount = money(200_000, "UAH");
    for (const finalAmount of [
      money(200_001, "UAH"),
      money(-1, "UAH"),
      money(1.5, "UAH"),
      money(Number.NaN, "UAH"),
      money(MAX_AMOUNT + 1, "UAH"),
      money(100, "USD"),
    ]) {
      expect(
        () => refundableAmount({ amount, finalAmount, refunds: [] }),
        JSON.stringify(finalAmount),
      ).toThrow(RangeError);
    }
  });

  it("handles the largest amount exactly", () => {
    expect(
      refundableAmount({
        amount: money(MAX_AMOUNT, "UAH"),
        finalAmount: money(MAX_AMOUNT - 1, "UAH"),
        refunds: [reported(1, "UAH")],
      }),
    ).toEqual(money(MAX_AMOUNT - 1, "UAH"));
  });
});

describe("decideRefund with the provider's final amount", () => {
  for (const { currency, exponent, paid } of CASES) {
    const m = (amount: number) => money(amount, currency);
    const ask = (
      amount: number,
      finalAmount: Money | null,
      refunds: IdentifiedRefundRecord[] = [],
    ) =>
      decideRefund({
        payment: { status: "succeeded", amount: m(paid), finalAmount },
        refunds,
        amount: m(amount),
        capabilities: both,
      });

    it(`${currency} (exponent ${exponent}): exactly what the provider still holds is allowed, one minor unit more is not`, () => {
      const held = tenths(paid, 6);
      expect(ask(held, m(held))).toEqual({ ok: true, full: false, remainingAfter: m(0) });
      expect(ask(held + 1, m(held))).toEqual({ ok: false, reason: "refund_exceeds_remaining" });
      // The review's scenario: 40 % returned in the cabinet, then 40 % through the shop (not reported yet): asking for
      // the same 40 % again is refused, the 20 % the provider still holds is allowed.
      const unreported = [ours(tenths(paid, 4), "succeeded", currency)];
      expect(ask(tenths(paid, 4), m(held), unreported)).toEqual({
        ok: false,
        reason: "refund_exceeds_remaining",
      });
      expect(ask(tenths(paid, 2), m(held), unreported)).toEqual({
        ok: true,
        full: false,
        remainingAfter: m(0),
      });
      // The same once the provider reported our refund (final amount 20 %).
      const reportedRefunds = [reported(tenths(paid, 4), currency)];
      expect(ask(tenths(paid, 2), m(tenths(paid, 2)), reportedRefunds)).toEqual({
        ok: true,
        full: false,
        remainingAfter: m(0),
      });
      expect(ask(tenths(paid, 2) + 1, m(tenths(paid, 2)), reportedRefunds)).toEqual({
        ok: false,
        reason: "refund_exceeds_remaining",
      });
      expect(ask(1, m(0))).toEqual({ ok: false, reason: "refund_exceeds_remaining" });
    });

    it(`${currency} (exponent ${exponent}): without an external refund nothing changes (a full refund stays full)`, () => {
      for (const finalAmount of [null, m(paid)]) {
        expect(ask(paid, finalAmount)).toEqual({ ok: true, full: true, remainingAfter: m(0) });
        expect(ask(paid + 1, finalAmount)).toEqual({
          ok: false,
          reason: "refund_exceeds_remaining",
        });
      }
    });
  }

  it("a full refund is refused once anything was returned outside the shop, also by a provider without partial refunds", () => {
    expect(
      decideRefund({
        payment: {
          status: "succeeded",
          amount: money(200_000, "UAH"),
          finalAmount: money(120_000, "UAH"),
        },
        refunds: [],
        amount: money(200_000, "UAH"),
        capabilities: { partialRefunds: false, multipleRefunds: false },
      }),
    ).toEqual({ ok: false, reason: "refund_exceeds_remaining" });
  });
});

describe("externalRefundAmount (money returned that our refunds do not explain)", () => {
  for (const { currency, exponent, paid } of CASES) {
    const m = (amount: number) => money(amount, currency);

    it(`${currency} (exponent ${exponent}): from the final amount, less our active refunds, never below zero`, () => {
      const base = { amount: m(paid), listed: [] as ProviderRefundFact[] };
      expect(externalRefundAmount({ ...base, finalAmount: null, refunds: [] })).toEqual(m(0));
      expect(externalRefundAmount({ ...base, finalAmount: m(paid), refunds: [] })).toEqual(m(0));
      expect(
        externalRefundAmount({ ...base, finalAmount: m(tenths(paid, 6)), refunds: [] }),
      ).toEqual(m(tenths(paid, 4)));
      // Our own refund explains the lowered final amount.
      expect(
        externalRefundAmount({
          ...base,
          finalAmount: m(tenths(paid, 6)),
          refunds: [ours(tenths(paid, 4), "processing", currency)],
        }),
      ).toEqual(m(0));
      // Our refund is not reported yet: nothing external either.
      expect(
        externalRefundAmount({
          ...base,
          finalAmount: m(paid),
          refunds: [ours(tenths(paid, 4), "succeeded", currency)],
        }),
      ).toEqual(m(0));
      // A failed refund of ours explains nothing.
      expect(
        externalRefundAmount({
          ...base,
          finalAmount: m(tenths(paid, 6)),
          refunds: [ours(tenths(paid, 4), "failed", currency)],
        }),
      ).toEqual(m(tenths(paid, 4)));
      expect(externalRefundAmount({ ...base, finalAmount: m(0), refunds: [] })).toEqual(m(paid));
      expect(externalRefundAmount({ ...base, finalAmount: m(paid - 1), refunds: [] })).toEqual(
        m(1),
      );
    });

    it(`${currency} (exponent ${exponent}): from the provider's list, entries without our id or with an id we do not know`, () => {
      const final = m(paid);
      expect(
        externalRefundAmount({
          amount: m(paid),
          finalAmount: final,
          refunds: [ours(tenths(paid, 1), "processing", currency)],
          listed: [
            listed(tenths(paid, 1), "processing", currency, REFUND_ID),
            listed(tenths(paid, 2), "processing", currency),
            listed(tenths(paid, 3), "succeeded", currency, OTHER_REFUND_ID),
            listed(tenths(paid, 4), "failed", currency),
          ],
        }),
      ).toEqual(m(tenths(paid, 5)));
    });
  }

  it("takes the larger of the two views, never their sum (the same money seen twice)", () => {
    expect(
      externalRefundAmount({
        amount: money(200_000, "UAH"),
        finalAmount: money(120_000, "UAH"),
        refunds: [],
        listed: [listed(80_000, "succeeded", "UAH")],
      }),
    ).toEqual(money(80_000, "UAH"));
  });
});

describe("decideExternalRefund (attention when the external amount grows)", () => {
  const amount = money(200_000, "UAH");

  it("raises external_reversal for a partial refund made in the provider's cabinet", () => {
    expect(
      decideExternalRefund({
        amount,
        previousFinalAmount: amount,
        refunds: [],
        fact: fact({
          amount,
          finalAmount: money(120_000, "UAH"),
          refunds: [listed(80_000, "succeeded", "UAH")],
        }),
      }),
    ).toEqual({ externalAmount: money(80_000, "UAH"), attentionCode: "external_reversal" });
  });

  it("raises it for an external refund the provider still processes (listed, final amount unchanged)", () => {
    expect(
      decideExternalRefund({
        amount,
        previousFinalAmount: null,
        refunds: [],
        fact: fact({
          amount,
          finalAmount: amount,
          refunds: [listed(80_000, "processing", "UAH")],
        }),
      }).attentionCode,
    ).toBe("external_reversal");
  });

  it("does not raise it again for an external refund the stored final amount already showed", () => {
    // 80 000 returned in the cabinet earlier, then 50 000 by the shop; both already in the stored final amount.
    expect(
      decideExternalRefund({
        amount,
        previousFinalAmount: money(70_000, "UAH"),
        refunds: [ours(50_000, "succeeded", "UAH")],
        fact: fact({
          amount,
          finalAmount: money(70_000, "UAH"),
          refunds: [
            listed(80_000, "succeeded", "UAH"),
            listed(50_000, "succeeded", "UAH", REFUND_ID),
          ],
        }),
      }),
    ).toEqual({ externalAmount: money(80_000, "UAH"), attentionCode: null });
    expect(
      decideExternalRefund({
        amount,
        previousFinalAmount: money(120_000, "UAH"),
        refunds: [],
        fact: fact({
          amount,
          finalAmount: money(120_000, "UAH"),
          refunds: [listed(80_000, "succeeded", "UAH")],
        }),
      }).attentionCode,
    ).toBeNull();
  });

  it("errs towards attention, never away from it: a shop refund made after an external one raises it once more", () => {
    // The stored final amount (120 000) predates our 50 000 refund, so the stored state cannot tell how much of the
    // missing money was ours; the decision raises attention rather than miss an external refund.
    expect(
      decideExternalRefund({
        amount,
        previousFinalAmount: money(120_000, "UAH"),
        refunds: [ours(50_000, "succeeded", "UAH")],
        fact: fact({
          amount,
          finalAmount: money(70_000, "UAH"),
          refunds: [
            listed(80_000, "succeeded", "UAH"),
            listed(50_000, "succeeded", "UAH", REFUND_ID),
          ],
        }),
      }),
    ).toEqual({ externalAmount: money(80_000, "UAH"), attentionCode: "external_reversal" });
    // A new external refund while our own refund is reflected: always raised.
    expect(
      decideExternalRefund({
        amount,
        previousFinalAmount: money(120_000, "UAH"),
        refunds: [ours(80_000, "succeeded", "UAH")],
        fact: fact({
          amount,
          finalAmount: money(90_000, "UAH"),
          refunds: [
            listed(80_000, "succeeded", "UAH", REFUND_ID),
            listed(30_000, "succeeded", "UAH"),
          ],
        }),
      }),
    ).toEqual({ externalAmount: money(30_000, "UAH"), attentionCode: "external_reversal" });
  });

  it("raises nothing when our own refunds explain everything (behaviour without external refunds is unchanged)", () => {
    for (const status of ["requested", "processing", "succeeded", "unknown"] as const) {
      expect(
        decideExternalRefund({
          amount,
          previousFinalAmount: amount,
          refunds: [ours(80_000, status, "UAH")],
          fact: fact({
            amount,
            finalAmount: money(120_000, "UAH"),
            refunds: [listed(80_000, "succeeded", "UAH", REFUND_ID)],
          }),
        }),
        status,
      ).toEqual({ externalAmount: money(0, "UAH"), attentionCode: null });
    }
    expect(
      decideExternalRefund({
        amount,
        previousFinalAmount: null,
        refunds: [],
        fact: fact({ amount, finalAmount: amount }),
      }),
    ).toEqual({ externalAmount: money(0, "UAH"), attentionCode: null });
    expect(
      decideExternalRefund({
        amount,
        previousFinalAmount: null,
        refunds: [],
        fact: fact({ amount, finalAmount: null, status: "processing" }),
      }),
    ).toEqual({ externalAmount: money(0, "UAH"), attentionCode: null });
  });

  it("raises it when a second external refund follows the first", () => {
    expect(
      decideExternalRefund({
        amount,
        previousFinalAmount: money(120_000, "UAH"),
        refunds: [],
        fact: fact({
          amount,
          finalAmount: money(100_000, "UAH"),
          refunds: [listed(80_000, "succeeded", "UAH"), listed(20_000, "succeeded", "UAH")],
        }),
      }),
    ).toEqual({ externalAmount: money(100_000, "UAH"), attentionCode: "external_reversal" });
  });

  it("throws on a fact in another currency than the payment (bindFact refuses those first)", () => {
    expect(() =>
      decideExternalRefund({
        amount,
        previousFinalAmount: null,
        refunds: [],
        fact: fact({ amount: money(200_000, "USD"), finalAmount: money(200_000, "USD") }),
      }),
    ).toThrow(RangeError);
  });
});
