import { timingSafeEqual } from "node:crypto";
import { generateSessionToken, hashSessionToken } from "../auth/session-token.js";

/*
 * Guest access tokens of orders (ADR 0017): 32 random bytes in base64url, shown to the guest once, only the SHA-256 is
 * stored on the order. The same primitives as session tokens. A match is decided on the HASHES in constant time, so the
 * comparison leaks nothing about a stored hash.
 */

export interface IssuedAccessToken {
  /** Goes to the guest, once. Never stored, never logged. */
  readonly token: string;
  /** What the order row keeps. */
  readonly hash: string;
}

export function issueAccessToken(): IssuedAccessToken {
  const token = generateSessionToken();
  return { token, hash: hashSessionToken(token) };
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Hash of a token no order has: compared when the number is unknown, so a miss costs the same as a wrong token. */
const NO_ORDER_HASH = hashSessionToken("fluxkit:no-such-order");

/**
 * True when `presented` is the token whose hash is `storedHash`. `null` (no such order, or an order without a token such
 * as a customer's) is compared against a dummy hash and answers false. Never throws, whatever the input.
 */
export function accessTokenMatches(presented: string, storedHash: string | null): boolean {
  const wanted = storedHash !== null && SHA256_HEX.test(storedHash) ? storedHash : NO_ORDER_HASH;
  const presentedHash = hashSessionToken(typeof presented === "string" ? presented : "");
  const equal = timingSafeEqual(Buffer.from(presentedHash, "hex"), Buffer.from(wanted, "hex"));
  return equal && storedHash !== null && wanted === storedHash;
}
