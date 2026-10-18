import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveGuestAccessToken } from "@fluxkit/core";
import { hashSessionToken } from "../auth/session-token.js";

/*
 * Guest access tokens of orders (ADR 0023): derived, not random. The token is the HMAC-SHA256 of the order id and the
 * idempotency key under `ORDER_TOKEN_SECRET` (the rule lives in core, this file supplies node:crypto), shown to the
 * guest in the checkout answer and again, identically, in the answer of a replay. Only its SHA-256 is stored on the
 * order (the same primitive as session tokens). A match is decided on the HASHES in constant time, so the comparison
 * leaks nothing about a stored hash.
 */

export interface IssuedAccessToken {
  /** Goes to the guest in the checkout answer. Never stored, never logged. */
  readonly token: string;
  /** What the order row keeps. */
  readonly hash: string;
}

/** The HMAC port of core's derivation. */
export function hmacSha256(key: string, message: string): Uint8Array {
  return createHmac("sha256", key).update(message).digest();
}

/** The token of an order and its hash. Throws a RangeError when the secret is shorter than core's minimum. */
export function deriveAccessToken(
  secret: string,
  orderId: string,
  idempotencyKey: string,
): IssuedAccessToken {
  const token = deriveGuestAccessToken({ secret, orderId, idempotencyKey }, hmacSha256);
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
