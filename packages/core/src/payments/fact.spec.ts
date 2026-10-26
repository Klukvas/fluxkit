import { describe, expect, it } from "vitest";
import { isProviderPaymentFact, providerPaymentFactProblems } from "./fact.js";
import { fact, REFUND_ID, uah } from "./test-support.js";

describe("providerPaymentFactProblems", () => {
  it("accepts a well-formed fact (also with refunds, no card, no final amount, an unknown status)", () => {
    expect(providerPaymentFactProblems(fact())).toEqual([]);
    expect(isProviderPaymentFact(fact())).toBe(true);
    expect(
      providerPaymentFactProblems(
        fact({
          status: null,
          providerStatus: "hold_pending",
          finalAmount: null,
          card: null,
          failureCode: "1077",
          refunds: [
            {
              refundId: REFUND_ID,
              status: "succeeded",
              amount: uah(100),
              modifiedAt: new Date("2026-10-26T11:00:00.000Z"),
            },
            {
              refundId: null,
              status: "processing",
              amount: uah(1),
              modifiedAt: new Date("2026-10-26T11:00:00.000Z"),
            },
          ],
        }),
      ),
    ).toEqual([]);
    expect(providerPaymentFactProblems(fact({ finalAmount: uah(0) }))).toEqual([]);
  });

  it("names every broken field", () => {
    const broken = {
      providerPaymentId: "a:b",
      reference: 7,
      status: "paid",
      providerStatus: "two words",
      amount: { amount: 1.5, currency: "UAH" },
      finalAmount: { amount: 10, currency: "USD" },
      modifiedAt: new Date("nope"),
      failureCode: "Card declined by the issuer",
      refunds: "none",
      card: { system: "visa", last4: "444111******1111" },
    };
    expect(providerPaymentFactProblems(broken)).toEqual([
      "providerPaymentId breaks PROVIDER_PAYMENT_ID_PATTERN",
      "reference is not a string of 1 to 255 characters",
      "status is neither null nor a provider payment status",
      "providerStatus breaks PAYMENT_PROVIDER_STATUS_PATTERN",
      "amount is not a positive amount in minor units",
      "finalAmount is neither null nor money in the amount's currency",
      "modifiedAt is not a valid Date",
      "failureCode is neither null nor a code",
      "refunds is not a list of at most 100 refunds",
      "card is neither null nor {system, last4}",
    ]);
    expect(isProviderPaymentFact(broken)).toBe(false);
  });

  it("refuses zero, negative and overflowing amounts and unsupported currencies", () => {
    for (const amount of [
      uah(0),
      uah(-1),
      uah(1_000_000_000_001),
      { amount: 1, currency: "XXX" },
      null,
    ]) {
      expect(
        providerPaymentFactProblems(fact({ amount: amount as never, finalAmount: null })),
        JSON.stringify(amount),
      ).toEqual(["amount is not a positive amount in minor units"]);
    }
    expect(providerPaymentFactProblems(fact({ amount: uah(1_000_000_000_000) }))).toEqual([]);
  });

  it("checks each refund entry", () => {
    const refund = {
      refundId: "x y",
      status: "done",
      amount: uah(0),
      modifiedAt: "2026-10-26",
    };
    expect(providerPaymentFactProblems(fact({ refunds: [refund as never] }))).toEqual([
      "refunds[0].refundId is neither null nor a code",
      "refunds[0].status is not a provider refund status",
      "refunds[0].amount is not a positive amount in the payment's currency",
      "refunds[0].modifiedAt is not a valid Date",
    ]);
    expect(
      providerPaymentFactProblems(
        fact({
          refunds: [
            {
              refundId: null,
              status: "succeeded",
              amount: { amount: 5, currency: "USD" },
              modifiedAt: new Date(),
            },
          ],
        }),
      ),
    ).toEqual(["refunds[0].amount is not a positive amount in the payment's currency"]);
    const many = Array.from({ length: 101 }, () => ({
      refundId: null,
      status: "succeeded" as const,
      amount: uah(1),
      modifiedAt: new Date(),
    }));
    expect(providerPaymentFactProblems(fact({ refunds: many }))).toEqual([
      "refunds is not a list of at most 100 refunds",
    ]);
  });

  it("is not an object", () => {
    expect(providerPaymentFactProblems(null)).toEqual(["the fact is not an object"]);
    expect(providerPaymentFactProblems("{}")).toEqual(["the fact is not an object"]);
  });
});
