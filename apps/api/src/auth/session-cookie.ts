import type { CookieOptions, Response } from "express";
import { readTokenCookie, SESSION_TOKEN_PATTERN } from "./session-token.js";

export const SESSION_COOKIE_NAME = "fluxkit_admin_session";

export { SESSION_TOKEN_PATTERN };

/**
 * The session token from a `Cookie` header, or `undefined`. Never throws. See `readTokenCookie` for how repeated,
 * malformed and look-alike cookies are treated.
 */
export function readSessionCookie(header: string | undefined): string | undefined {
  return readTokenCookie(header, SESSION_COOKIE_NAME);
}

export interface SessionCookieSettings {
  /** The `Secure` flag; only `false` for local plain-HTTP development (`ADMIN_COOKIE_SECURE`). */
  secure: boolean;
}

function baseOptions({ secure }: SessionCookieSettings): CookieOptions {
  return { httpOnly: true, sameSite: "strict", path: "/admin", secure };
}

export function setSessionCookie(
  response: Pick<Response, "cookie">,
  token: string,
  settings: SessionCookieSettings & { maxAgeSeconds: number },
): void {
  // Express takes milliseconds and writes both Max-Age (seconds) and Expires.
  response.cookie(SESSION_COOKIE_NAME, token, {
    ...baseOptions(settings),
    maxAge: settings.maxAgeSeconds * 1000,
  });
}

/** Must use the same Path (and flags) as `setSessionCookie`, or the browser keeps the old cookie. */
export function clearSessionCookie(
  response: Pick<Response, "clearCookie">,
  settings: SessionCookieSettings,
): void {
  response.clearCookie(SESSION_COOKIE_NAME, baseOptions(settings));
}
