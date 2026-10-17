import type { CookieOptions, Response } from "express";
import { readTokenCookie } from "../../auth/session-token.js";

export const CUSTOMER_SESSION_COOKIE_NAME = "fluxkit_customer_session";

/**
 * The customer session token from a `Cookie` header, or `undefined`. Reads ONLY `fluxkit_customer_session`, never the
 * admin cookie. Never throws (see `readTokenCookie`).
 */
export function readCustomerSessionCookie(header: string | undefined): string | undefined {
  return readTokenCookie(header, CUSTOMER_SESSION_COOKIE_NAME);
}

export interface CustomerSessionCookieSettings {
  /** The `Secure` flag; only `false` for local plain-HTTP development (`STORE_COOKIE_SECURE`). */
  secure: boolean;
}

/**
 * `SameSite=Lax` (not Strict, ADR 0016: a shopper arriving from an email link must still look signed in; writes are
 * protected by the CSRF header) and `Path=/store`, so the browser never sends it to `/admin`.
 */
function baseOptions({ secure }: CustomerSessionCookieSettings): CookieOptions {
  return { httpOnly: true, sameSite: "lax", path: "/store", secure };
}

export function setCustomerSessionCookie(
  response: Pick<Response, "cookie">,
  token: string,
  settings: CustomerSessionCookieSettings & { maxAgeSeconds: number },
): void {
  // Express takes milliseconds and writes both Max-Age (seconds) and Expires.
  response.cookie(CUSTOMER_SESSION_COOKIE_NAME, token, {
    ...baseOptions(settings),
    maxAge: settings.maxAgeSeconds * 1000,
  });
}

/** Must use the same Path (and flags) as `setCustomerSessionCookie`, or the browser keeps the old cookie. */
export function clearCustomerSessionCookie(
  response: Pick<Response, "clearCookie">,
  settings: CustomerSessionCookieSettings,
): void {
  response.clearCookie(CUSTOMER_SESSION_COOKIE_NAME, baseOptions(settings));
}
