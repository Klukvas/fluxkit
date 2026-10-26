import { timingSafeEqual } from "node:crypto";
import { deriveCustomerAuthToken, type AuthTokenPurpose } from "@fluxkit/core";
import { hashSessionToken } from "../../auth/session-token.js";
import { hmacSha256 } from "../../orders/access-token.js";

/*
 * The node:crypto side of customer auth tokens (ADR 0031 decision 9). Core decides the derivation message and every rule;
 * this file supplies the HMAC (the same port as the guest order token, ADR 0023), the SHA-256 the row stores and the
 * constant-time comparison of two stored hashes. Nothing here logs or keeps a token.
 */

/** The token of the `customer_auth_token` row `tokenId`: derived from `ORDER_TOKEN_SECRET`, never stored. */
export function deriveAuthToken(
  secret: string,
  purpose: AuthTokenPurpose,
  tokenId: string,
): string {
  return deriveCustomerAuthToken({ secret, purpose, tokenId }, hmacSha256);
}

/** What `customer_auth_token.token_hash` holds: SHA-256 hex of the token (the session token primitive). */
export function hashAuthToken(token: string): string {
  return hashSessionToken(token);
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * True when two SHA-256 hex hashes are equal, compared in constant time. Anything that is not such a hash is unequal.
 * The row is found BY the hash (an index lookup on the hash of the presented token, never an early-exit compare on user
 * input); this check is the defence in depth that the row really carries the hash that was presented.
 */
export function authTokenHashesMatch(presented: string, stored: string): boolean {
  if (!SHA256_HEX.test(presented) || !SHA256_HEX.test(stored)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(presented, "hex"), Buffer.from(stored, "hex"));
}
