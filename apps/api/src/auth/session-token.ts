import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

/** 32 random bytes as unpadded base64url. Anything else cannot be a token we issued. */
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * A Cookie header longer than this is ignored. Node already caps the whole header block (16 KiB by default), and
 * browsers send far less; the cap only bounds the work done on a hostile header.
 */
const MAX_COOKIE_HEADER_LENGTH = 8192;

/** A new random session token (256 bits). It exists only in the cookie; the database keeps its SHA-256. */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** SHA-256 hex of the token text. A random 256-bit token needs no salt or slow hash; this only makes a database leak useless. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isWellFormedSessionToken(token: unknown): token is string {
  return typeof token === "string" && SESSION_TOKEN_PATTERN.test(token);
}

/**
 * The token in the cookie called `cookieName` of a `Cookie` header, or `undefined`. Never throws. The name must match
 * exactly (case included). When the cookie is repeated (for example one set by a sibling path or subdomain) only the
 * first occurrence with a well-formed value is used; the rest are ignored. The value is not percent-decoded or
 * unquoted: a token we issued never needs it.
 */
export function readTokenCookie(
  header: string | undefined,
  cookieName: string,
): string | undefined {
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
    if (pair.slice(0, separator).trim() !== cookieName) {
      continue;
    }
    const value = pair.slice(separator + 1).trim();
    if (SESSION_TOKEN_PATTERN.test(value)) {
      return value;
    }
  }
  return undefined;
}
