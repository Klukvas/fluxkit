import type { Locale } from "@fluxkit/ui";

/**
 * Links to orders and the guest token in the URL fragment (plan, "Guest order token"; owner answer 8).
 *
 * The guest access token is a bearer secret. It travels ONLY in the fragment (`#t=...`) of the order link and in the body
 * of `POST /store/orders/lookup|cancel`: a browser never sends a fragment to a server (not in the request line, not in
 * `Referer`), so it stays out of access logs, proxies and the Next server. Nothing here logs, stores or returns it in any
 * other form.
 */

/** An order number as the API prints it (`7K3M-9QX2`) or as a person types it; never a path or a query. */
const ORDER_NUMBER = /^[A-Za-z0-9-]{1,32}$/;
/** The API's token is 32 bytes in base64url (43 characters); a little room either way, never other characters. */
const ACCESS_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const FRAGMENT_KEY = "t";

export function isOrderNumber(value: string): boolean {
  return ORDER_NUMBER.test(value);
}

export function isAccessToken(value: string): boolean {
  return ACCESS_TOKEN.test(value);
}

function checkedNumber(number: string): string {
  if (!isOrderNumber(number)) throw new RangeError("Not an order number.");
  return number;
}

/** `/{locale}/order/{number}#t={token}`. Throws on a malformed number or token (a bug or a broken answer, never shown). */
export function guestOrderHref(locale: Locale, number: string, accessToken: string): string {
  if (!isAccessToken(accessToken)) throw new RangeError("Not an access token.");
  return `/${locale}/order/${checkedNumber(number)}#${FRAGMENT_KEY}=${accessToken}`;
}

export function accountOrderHref(locale: Locale, number: string): string {
  return `/${locale}/account/orders/${checkedNumber(number)}`;
}

export function accountOrdersHref(locale: Locale, page = 1): string {
  return page > 1 ? `/${locale}/account/orders?page=${String(page)}` : `/${locale}/account/orders`;
}

/**
 * The token from `location.hash` (`#t=...`), or `null` when the fragment has none or a malformed one. Only the browser
 * calls this: the server never sees a fragment.
 */
export function tokenFromFragment(hash: string): string | null {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  if (text === "") return null;
  const values = new URLSearchParams(text).getAll(FRAGMENT_KEY);
  if (values.length !== 1) return null;
  const token = values[0] as string;
  return isAccessToken(token) ? token : null;
}
