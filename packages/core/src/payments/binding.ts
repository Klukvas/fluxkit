import type { Money } from "../pricing/money.js";
import { isProviderPaymentFact } from "./fact.js";
import { assertPositiveMoney, assertUuid } from "./guards.js";
import type { ProviderPaymentFact } from "./provider-port.js";
import type { PaymentAttentionCode } from "./reasons.js";

/*
 * Binding a verified provider fact to our attempt (ADR 0032 decision 7, core `bindFact`): only a fact that binds may
 * change an attempt or pay an order. A fact that does not bind is journaled `applied = false` with its attention code
 * and never pays. The attempt's amount equals the order total (checked when the attempt is created and again by
 * `markPaidIn`). The currency rule is equality with the attempt; "UAH only" (question 6) is the provider's
 * `capabilities.currencies`, checked at startup.
 */

export interface BindableAttempt {
  /** `payment.id`, sent as the provider reference. */
  readonly id: string;
  /** `null` while the create has not answered (`creating`, `create_unknown`). */
  readonly providerPaymentId: string | null;
  readonly amount: Money;
}

export type BindRefusal =
  | "reference_mismatch"
  | "provider_payment_id_mismatch"
  | "currency_mismatch"
  | "amount_mismatch"
  | "final_amount_mismatch"
  | "refunds_exceed_amount";

export type BindDecision =
  /** `bindsProviderPaymentId`: the attempt had no provider id; the fact's becomes the attempt's (decision 12). */
  | { readonly ok: true; readonly bindsProviderPaymentId: boolean }
  | {
      readonly ok: false;
      readonly reason: BindRefusal;
      readonly attentionCode: Extract<PaymentAttentionCode, "fact_not_bound" | "amount_mismatch">;
    };

function refused(
  reason: BindRefusal,
  attentionCode: "fact_not_bound" | "amount_mismatch",
): BindDecision {
  return Object.freeze({ ok: false as const, reason, attentionCode });
}

/**
 * Checks in this order: our reference (exact, case-sensitive), the provider id (when the attempt has one), the currency,
 * the amount (exact minor units), refunds that add up to more than the amount, and for a `succeeded` fact the final
 * amount. ADR 0032 open question 6, decided here: a provider may report a partly refunded payment as still succeeded
 * with a lowered final amount, so the final amount must equal either the amount or the amount less the fact's succeeded
 * refunds; anything else is `final_amount_mismatch`. Whatever the status, a final amount above the amount is
 * `final_amount_mismatch` too (no provider finalizes more than it invoiced, and the payment row could not store it). A
 * malformed fact or attempt is a bug (the API checks facts with `isProviderPaymentFact` first): RangeError.
 */
export function bindFact(fact: ProviderPaymentFact, attempt: BindableAttempt): BindDecision {
  if (!isProviderPaymentFact(fact)) {
    throw new RangeError("bindFact needs a well-formed provider fact");
  }
  assertUuid(attempt.id, "attempt id");
  assertPositiveMoney(attempt.amount, "attempt amount");
  if (fact.reference !== attempt.id) {
    return refused("reference_mismatch", "fact_not_bound");
  }
  if (attempt.providerPaymentId !== null && fact.providerPaymentId !== attempt.providerPaymentId) {
    return refused("provider_payment_id_mismatch", "fact_not_bound");
  }
  if (fact.amount.currency !== attempt.amount.currency) {
    return refused("currency_mismatch", "amount_mismatch");
  }
  if (fact.amount.amount !== attempt.amount.amount) {
    return refused("amount_mismatch", "amount_mismatch");
  }
  let succeededRefunds = 0;
  let activeRefunds = 0;
  for (const refund of fact.refunds) {
    if (refund.status === "succeeded") {
      succeededRefunds += refund.amount.amount;
    }
    if (refund.status !== "failed") {
      activeRefunds += refund.amount.amount;
    }
  }
  if (activeRefunds > attempt.amount.amount) {
    return refused("refunds_exceed_amount", "amount_mismatch");
  }
  if (fact.finalAmount !== null && fact.finalAmount.amount > attempt.amount.amount) {
    return refused("final_amount_mismatch", "amount_mismatch");
  }
  if (fact.status === "succeeded" && fact.finalAmount !== null) {
    const final = fact.finalAmount.amount;
    if (final !== attempt.amount.amount && final !== attempt.amount.amount - succeededRefunds) {
      return refused("final_amount_mismatch", "amount_mismatch");
    }
  }
  return Object.freeze({
    ok: true as const,
    bindsProviderPaymentId: attempt.providerPaymentId === null,
  });
}
