import type { CookieOptions, Response } from "express";

export const SESSION_COOKIE_NAME = "fluxkit_admin_session";

/** 32 random bytes as unpadded base64url. Anything else cannot be a token we issued. */
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * A Cookie header longer than this is ignored. Node already caps the whole header block (16 KiB by default), and
 * browsers send far less; the cap only bounds the work done on a hostile header.
 */
const MAX_COOKIE_HEADER_LENGTH = 8192;

/**
 * The session token from a `Cookie` header, or `undefined`. Never throws. When the cookie is repeated (for example
 * one set by a sibling path or subdomain) only the first occurrence with a well-formed value is used; the rest are
 * ignored. The value is not percent-decoded or unquoted: a token we issued never needs it.
 */
export function readSessionCookie(header: string | undefined): string | undefined {
  if (
    typeof header !== "string" ||
    header.length === 0 ||
    header.length > MAX_COOKIE_HEADER_LENGTH
  ) {
    return undefined;
  }
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (pair.slice(0, separator).trim() !== SESSION_COOKIE_NAME) {
      continue;
    }
    const value = pair.slice(separator + 1).trim();
    if (SESSION_TOKEN_PATTERN.test(value)) {
      return value;
    }
  }
  return undefined;
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
