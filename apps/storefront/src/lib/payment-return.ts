import type { Locale } from "@fluxkit/ui";
import type { AttemptStorage } from "./checkout-attempt";
import { accountOrderHref, guestOrderHref, isAccessToken, isOrderNumber } from "./order-links";

/**
 * The hand-off from "Pay now" to the return page (ADR 0032 decision 6): "the token is read from `sessionStorage`, saved
 * before the redirect in the same tab, never sent to the provider".
 *
 * The provider sends the shopper back to `/{locale}/payment/return?payment=<id>`, a URL that holds an attempt id and nothing
 * else (no order number, no token, no status). The page therefore needs to know WHICH order the id belongs to and, for a
 * guest, the access token. "Pay now" saves exactly that in this tab's `sessionStorage` right before it navigates away, and the
 * return page reads it back and clears it when the attempt is final. Another tab or device finds nothing and says to open the
 * order link again.
 *
 * Rules:
 * - the entry is `{kind, number, accessToken?, paymentId}`, validated on every read (a damaged or hand-made entry is ignored);
 * - the token is in this entry for the length of one payment trip only, and in `sessionStorage` (cleared with the tab), never
 *   `localStorage` or a cookie;
 * - the query string is only a HINT of which attempt to show (`paymentIdFromSearch`, a UUID); everything shown comes from the
 *   status route, which checks ownership.
 */

export const PAYMENT_RETURN_STORAGE_KEY = "fluxkit.paymentReturn";

export type PaymentReturn =
  | { kind: "guest"; number: string; accessToken: string; paymentId: string }
  | { kind: "account"; number: string; paymentId: string };

const PAYMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPaymentId(value: unknown): value is string {
  return typeof value === "string" && PAYMENT_ID.test(value);
}

function validated(value: unknown): PaymentReturn | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const { kind, number, accessToken, paymentId } = record;
  if (typeof number !== "string" || !isOrderNumber(number) || !isPaymentId(paymentId)) return null;
  if (kind === "guest") {
    if (Object.keys(record).length !== 4) return null;
    if (typeof accessToken !== "string" || !isAccessToken(accessToken)) return null;
    return { kind, number, accessToken, paymentId };
  }
  if (kind === "account") {
    if (Object.keys(record).length !== 3) return null;
    return { kind, number, paymentId };
  }
  return null;
}

/** Saves the entry; `false` when storage is missing or refuses (the return page then asks to open the order again). */
export function savePaymentReturn(storage: AttemptStorage | null, entry: PaymentReturn): boolean {
  if (storage === null || validated(entry) === null) return false;
  try {
    storage.setItem(PAYMENT_RETURN_STORAGE_KEY, JSON.stringify(entry));
    return true;
  } catch {
    // Reported through the return value: the page says the link must be opened again after paying.
    return false;
  }
}

export function readPaymentReturn(storage: AttemptStorage | null): PaymentReturn | null {
  if (storage === null) return null;
  let text: string | null;
  try {
    text = storage.getItem(PAYMENT_RETURN_STORAGE_KEY);
  } catch {
    return null;
  }
  if (text === null) return null;
  try {
    return validated(JSON.parse(text));
  } catch {
    return null;
  }
}

export function clearPaymentReturn(storage: AttemptStorage | null): void {
  if (storage === null) return;
  try {
    storage.removeItem(PAYMENT_RETURN_STORAGE_KEY);
  } catch {
    // Nothing to do: the entry goes with the tab.
  }
}

/** The `payment` of `?payment=<id>`: only a well-formed, single id; nothing else of the query is read. */
export function paymentIdFromSearch(search: string): string | null {
  const text = search.startsWith("?") ? search.slice(1) : search;
  const values = new URLSearchParams(text).getAll("payment");
  if (values.length !== 1) return null;
  const id = values[0];
  return isPaymentId(id) ? id : null;
}

/** The order page the return page links back to. */
export function returnOrderHref(locale: Locale, entry: PaymentReturn): string {
  return entry.kind === "guest"
    ? guestOrderHref(locale, entry.number, entry.accessToken)
    : accountOrderHref(locale, entry.number);
}
