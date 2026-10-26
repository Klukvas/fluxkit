import { assertDate } from "./guards.js";
import { PAYMENT_INVOICE_WINDOW } from "./limits.js";

/*
 * The invoice validity (ADR 0032 decision 9; ADR 0017: the provider session is shorter than the order TTL). Pure date
 * arithmetic on UTC epoch milliseconds; `now` is a parameter.
 */

const MINUTE_MS = 60_000;

export type InvoiceValidity =
  | {
      readonly ok: true;
      /** `payment.expires_at`: 3 minutes before the order deadline. */
      readonly expiresAt: Date;
      /** The provider's validity (Monobank `validity`), whole seconds rounded down, so it never outlives `expiresAt`. */
      readonly validitySeconds: number;
    }
  | { readonly ok: false; readonly reason: "payment_window_too_short" };

/**
 * The invoice ends `PAYMENT_INVOICE_WINDOW.marginMinutes` (3) before `orderExpiresAt`. ADR 0032 open question 3, decided
 * here: the minimum of 5 minutes is measured on the INVOICE (`expiresAt - now`), so a shopper always gets at least 5
 * minutes on the provider's page; exactly 5 minutes is allowed. Consequence: an order with less than 8 minutes left is
 * refused `payment_window_too_short`, so with `ORDER_PAYMENT_TTL_MINUTES` below 8 no order can be paid online (the
 * minimum TTL of 5 stays valid for shops without a payment provider). An invalid date is a bug (RangeError).
 */
export function invoiceValidity(input: {
  readonly now: Date;
  readonly orderExpiresAt: Date;
}): InvoiceValidity {
  assertDate(input.now, "now");
  assertDate(input.orderExpiresAt, "orderExpiresAt");
  const nowMs = input.now.getTime();
  const expiresMs =
    input.orderExpiresAt.getTime() - PAYMENT_INVOICE_WINDOW.marginMinutes * MINUTE_MS;
  const windowMs = expiresMs - nowMs;
  if (windowMs < PAYMENT_INVOICE_WINDOW.minimumMinutes * MINUTE_MS) {
    return Object.freeze({ ok: false as const, reason: "payment_window_too_short" as const });
  }
  return Object.freeze({
    ok: true as const,
    expiresAt: new Date(expiresMs),
    validitySeconds: Math.floor(windowMs / 1_000),
  });
}
