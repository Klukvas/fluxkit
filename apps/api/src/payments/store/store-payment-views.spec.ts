import { describe, expect, it } from "vitest";
import { serviceUnavailable } from "../../common/problem.js";
import type { Transaction } from "../../common/transaction.js";
import { PaymentsRepository } from "../attempts/payments.repository.js";
import { PaymentProviders } from "../registry/payment-providers.js";
import { StorePaymentViews } from "./store-payment-views.js";

const order = {
  id: "order",
  status: "awaiting_payment",
  totalAmount: 1000,
  currency: "UAH",
  expiresAt: new Date("2030-01-01"),
};

describe("advisory payment availability", () => {
  it("leaves the caller transaction usable after the unavailable fallback", async () => {
    // Model PostgreSQL's aborted state: only rolling back the failed savepoint clears it.
    let aborted = false;
    const tx = {
      transaction: async <T>(work: (nested: Transaction) => Promise<T>): Promise<T> => {
        const previous = aborted;
        try {
          return await work(tx as unknown as Transaction);
        } catch (error) {
          aborted = previous;
          throw error;
        }
      },
    };
    const registry = {
      active: () => {
        aborted = true;
        return Promise.reject(serviceUnavailable());
      },
    } as unknown as PaymentProviders;
    const views = new StorePaymentViews(
      {} as PaymentsRepository,
      registry,
      { storefrontPublicUrl: "https://shop.example.test", providerTimeoutMs: 1000 },
      { now: () => new Date("2026-11-27") },
    );
    expect(await views.canPay(order, [], tx as unknown as Transaction)).toBe(false);
    expect(aborted, "the fallback must not return with an aborted caller transaction").toBe(false);
  });

  it("propagates failures other than readiness failures", async () => {
    const failure = new TypeError("unexpected availability failure");
    const views = new StorePaymentViews(
      {} as PaymentsRepository,
      { active: () => Promise.reject(failure) } as unknown as PaymentProviders,
      { storefrontPublicUrl: "https://shop.example.test", providerTimeoutMs: 1000 },
      { now: () => new Date("2026-11-27") },
    );
    await expect(views.canPay(order, [])).rejects.toBe(failure);
  });
});
