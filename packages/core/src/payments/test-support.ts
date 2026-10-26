import type { ProviderPaymentFact } from "./provider-port.js";

/** Test helpers of the payment specs (excluded from the build). */

export const PAYMENT_ID = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
export const OTHER_PAYMENT_ID = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
export const ORDER_ID = "11111111-2222-4333-8444-555555555555";
export const REFUND_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
export const INVOICE_ID = "p2_9ZgpZVsl3";

/** A UAH amount in minor units. */
export function uah(amount: number): { readonly amount: number; readonly currency: "UAH" } {
  return { amount, currency: "UAH" };
}

/** A well-formed fact about `PAYMENT_ID` / `INVOICE_ID` for 1 250.00 UAH; `overrides` replace fields. */
export function fact(overrides: Partial<ProviderPaymentFact> = {}): ProviderPaymentFact {
  return {
    providerPaymentId: INVOICE_ID,
    reference: PAYMENT_ID,
    status: "succeeded",
    providerStatus: "success",
    amount: uah(125_000),
    finalAmount: uah(125_000),
    modifiedAt: new Date("2026-10-26T10:00:00.000Z"),
    failureCode: null,
    refunds: [],
    card: { system: "visa", last4: "4242" },
    ...overrides,
  };
}

export function at(iso: string): Date {
  return new Date(iso);
}

export function plusMs(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

export const MINUTE = 60_000;
