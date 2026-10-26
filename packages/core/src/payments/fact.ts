import { isSupportedCurrency } from "../pricing/currency.js";
import { MAX_AMOUNT } from "../pricing/limits.js";
import {
  PAYMENT_CARD_LAST4_PATTERN,
  PAYMENT_CARD_SYSTEM_PATTERN,
  PAYMENT_CODE_PATTERN,
  PAYMENT_LIMITS,
  PAYMENT_PROVIDER_STATUS_PATTERN,
  PROVIDER_PAYMENT_ID_PATTERN,
} from "./limits.js";
import {
  PROVIDER_PAYMENT_STATUSES,
  PROVIDER_REFUND_STATUSES,
  type ProviderPaymentFact,
} from "./provider-port.js";

/*
 * The shape check of a `ProviderPaymentFact` (ADR 0032 decisions 3 and 7). The API runs it on every fact a plugin
 * answers before binding it: a malformed fact is treated like a malformed answer (`unavailable`), never applied. The
 * contract suite runs it too. Problems are plain sentences naming the field, never the value (it may hold card data).
 */

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/** Money with an integer amount from `min` to `MAX_AMOUNT` in a supported currency (`currency` when given). */
function isMoney(value: unknown, min: number, currency?: unknown): boolean {
  const money = value as { amount?: unknown; currency?: unknown } | null;
  return (
    typeof money === "object" &&
    money !== null &&
    Number.isSafeInteger(money.amount) &&
    (money.amount as number) >= min &&
    (money.amount as number) <= MAX_AMOUNT &&
    isSupportedCurrency(money.currency) &&
    (currency === undefined || money.currency === currency)
  );
}

function isCode(value: unknown): boolean {
  return typeof value === "string" && PAYMENT_CODE_PATTERN.test(value);
}

/** Every broken field of `value` as a sentence; empty for a well-formed fact. */
export function providerPaymentFactProblems(value: unknown): string[] {
  if (typeof value !== "object" || value === null) {
    return ["the fact is not an object"];
  }
  const fact = value as Record<string, unknown>;
  const problems: string[] = [];
  if (
    typeof fact.providerPaymentId !== "string" ||
    !PROVIDER_PAYMENT_ID_PATTERN.test(fact.providerPaymentId)
  ) {
    problems.push("providerPaymentId breaks PROVIDER_PAYMENT_ID_PATTERN");
  }
  if (
    typeof fact.reference !== "string" ||
    fact.reference.length < 1 ||
    fact.reference.length > PAYMENT_LIMITS.factReferenceMaxLength
  ) {
    problems.push("reference is not a string of 1 to 255 characters");
  }
  if (fact.status !== null && !PROVIDER_PAYMENT_STATUSES.includes(fact.status as never)) {
    problems.push("status is neither null nor a provider payment status");
  }
  if (
    typeof fact.providerStatus !== "string" ||
    !PAYMENT_PROVIDER_STATUS_PATTERN.test(fact.providerStatus)
  ) {
    problems.push("providerStatus breaks PAYMENT_PROVIDER_STATUS_PATTERN");
  }
  if (!isMoney(fact.amount, 1)) {
    problems.push("amount is not a positive amount in minor units");
  }
  const currency = (fact.amount as { currency?: unknown } | null | undefined)?.currency;
  if (fact.finalAmount !== null && !isMoney(fact.finalAmount, 0, currency)) {
    problems.push("finalAmount is neither null nor money in the amount's currency");
  }
  if (!isValidDate(fact.modifiedAt)) {
    problems.push("modifiedAt is not a valid Date");
  }
  if (fact.failureCode !== null && !isCode(fact.failureCode)) {
    problems.push("failureCode is neither null nor a code");
  }
  if (!Array.isArray(fact.refunds) || fact.refunds.length > PAYMENT_LIMITS.maxFactRefunds) {
    problems.push("refunds is not a list of at most 100 refunds");
  } else {
    (fact.refunds as unknown[]).forEach((entry, index) => {
      const refund = (typeof entry === "object" && entry !== null ? entry : {}) as Record<
        string,
        unknown
      >;
      const at = `refunds[${String(index)}]`;
      if (refund.refundId !== null && !isCode(refund.refundId)) {
        problems.push(`${at}.refundId is neither null nor a code`);
      }
      if (!PROVIDER_REFUND_STATUSES.includes(refund.status as never)) {
        problems.push(`${at}.status is not a provider refund status`);
      }
      if (!isMoney(refund.amount, 1, currency)) {
        problems.push(`${at}.amount is not a positive amount in the payment's currency`);
      }
      if (!isValidDate(refund.modifiedAt)) {
        problems.push(`${at}.modifiedAt is not a valid Date`);
      }
    });
  }
  const card = fact.card as { system?: unknown; last4?: unknown } | null | undefined;
  if (
    card !== null &&
    !(
      typeof card === "object" &&
      typeof card.system === "string" &&
      PAYMENT_CARD_SYSTEM_PATTERN.test(card.system) &&
      typeof card.last4 === "string" &&
      PAYMENT_CARD_LAST4_PATTERN.test(card.last4)
    )
  ) {
    problems.push("card is neither null nor {system, last4}");
  }
  return problems;
}

/** Whether `value` is a well-formed `ProviderPaymentFact`. */
export function isProviderPaymentFact(value: unknown): value is ProviderPaymentFact {
  return providerPaymentFactProblems(value).length === 0;
}
