import type { CookieOptions, Response } from "express";
import { readTokenCookie } from "../auth/session-token.js";

export const CART_COOKIE_NAME = "fluxkit_cart";

/**
 * The guest cart token from a `Cookie` header, or `undefined`. Reads ONLY `fluxkit_cart`. Never throws (see
 * `readTokenCookie`). Only a well-formed token comes back, so nothing else ever reaches a query.
 */
export function readCartCookie(header: string | undefined): string | undefined {
  return readTokenCookie(header, CART_COOKIE_NAME);
}

export interface CartCookieSettings {
  /** The `Secure` flag; only `false` for local plain-HTTP development (`STORE_COOKIE_SECURE`). */
  secure: boolean;
}

/**
 * `SameSite=Lax` (not Strict, ADR 0015: a shopper arriving from a link on another site must still see the cart; writes
 * are protected by the CSRF header) and `Path=/store`, like the customer session cookie.
 */
function baseOptions({ secure }: CartCookieSettings): CookieOptions {
  return { httpOnly: true, sameSite: "lax", path: "/store", secure };
}

export function setCartCookie(
  response: Pick<Response, "cookie">,
  token: string,
  settings: CartCookieSettings & { maxAgeSeconds: number },
): void {
  // Express takes milliseconds and writes both Max-Age (seconds) and Expires.
  response.cookie(CART_COOKIE_NAME, token, {
    ...baseOptions(settings),
    maxAge: settings.maxAgeSeconds * 1000,
  });
}

/** Must use the same Path (and flags) as `setCartCookie`, or the browser keeps the old cookie. */
export function clearCartCookie(
  response: Pick<Response, "clearCookie">,
  settings: CartCookieSettings,
): void {
  response.clearCookie(CART_COOKIE_NAME, baseOptions(settings));
}
