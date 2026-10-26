import type { Money } from "../pricing/money.js";
import { MAX_AMOUNT } from "../pricing/limits.js";
import { isSupportedCurrency } from "../pricing/currency.js";
import { assertPositiveMoney } from "./guards.js";
import type { PaymentLine } from "./provider-port.js";

/*
 * The provider's basket (Monobank `basketOrder`, ADR 0032 decision 6 step 3): the order snapshot lines plus the shipping
 * line, with the sum checked equal to the payment amount in core. Display only (PRRO is not linked in v1, decision 1).
 * Integer minor units only; nothing is rounded.
 */

export interface BasketLineInput {
  /** The line title in the order's locale. */
  readonly title: string;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly lineTotal: Money;
  readonly sku: string;
}

export interface BasketInput {
  readonly lines: readonly BasketLineInput[];
  /** The order's shipping charge; `null` without shipping. */
  readonly shipping: {
    readonly title: string;
    readonly amount: Money;
    readonly code: string;
  } | null;
  /** The payment amount (the order total). */
  readonly amount: Money;
}

export type BasketDecision =
  | { readonly ok: true; readonly lines: readonly PaymentLine[] }
  | {
      readonly ok: false;
      readonly reason: "no_lines" | "invalid_line" | "currency_mismatch" | "sum_mismatch";
    };

function refuse(reason: Extract<BasketDecision, { ok: false }>["reason"]): BasketDecision {
  return Object.freeze({ ok: false as const, reason });
}

function isAmount(value: Money, min: number): boolean {
  return (
    Number.isSafeInteger(value.amount) &&
    value.amount >= min &&
    value.amount <= MAX_AMOUNT &&
    isSupportedCurrency(value.currency)
  );
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * One payment line per order line (`total` = unit price x quantity exactly, quantity a whole number of at least 1) and one
 * for a shipping charge above zero (a free shipping line is left out). The sum of the lines must equal `amount` exactly:
 * `sum_mismatch` otherwise (an order with a discount or a separate tax adjustment has no matching basket; the caller then
 * sends none). Lines in another currency than `amount` are `currency_mismatch`. A malformed `amount` is a bug (RangeError).
 */
export function buildPaymentLines(input: BasketInput): BasketDecision {
  assertPositiveMoney(input.amount, "amount");
  if (input.lines.length === 0) {
    return refuse("no_lines");
  }
  const currency = input.amount.currency;
  const lines: PaymentLine[] = [];
  let sum = 0;
  for (const line of input.lines) {
    if (
      !isText(line.title) ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      !isAmount(line.unitPrice, 0) ||
      !isAmount(line.lineTotal, 0)
    ) {
      return refuse("invalid_line");
    }
    if (line.unitPrice.currency !== currency || line.lineTotal.currency !== currency) {
      return refuse("currency_mismatch");
    }
    if (line.unitPrice.amount * line.quantity !== line.lineTotal.amount) {
      return refuse("invalid_line");
    }
    sum += line.lineTotal.amount;
    lines.push(
      Object.freeze({
        name: line.title,
        quantity: line.quantity,
        unitAmount: Object.freeze({ amount: line.unitPrice.amount, currency }),
        total: Object.freeze({ amount: line.lineTotal.amount, currency }),
        code: line.sku,
      }),
    );
  }
  const shipping = input.shipping;
  if (shipping !== null) {
    if (!isText(shipping.title) || !isAmount(shipping.amount, 0)) {
      return refuse("invalid_line");
    }
    if (shipping.amount.currency !== currency) {
      return refuse("currency_mismatch");
    }
    if (shipping.amount.amount > 0) {
      sum += shipping.amount.amount;
      const charge = Object.freeze({ amount: shipping.amount.amount, currency });
      lines.push(
        Object.freeze({
          name: shipping.title,
          quantity: 1,
          unitAmount: charge,
          total: charge,
          code: shipping.code,
        }),
      );
    }
  }
  if (sum !== input.amount.amount) {
    return refuse("sum_mismatch");
  }
  return Object.freeze({ ok: true as const, lines: Object.freeze(lines) });
}
