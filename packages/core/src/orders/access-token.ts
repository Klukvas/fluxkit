import { toBase64Url } from "./base64url.js";

/*
 * Guest access tokens of orders (ADR 0023, which supersedes the random, rotating token of ADR 0017 and 0020). The token
 * is DERIVED, not drawn: HMAC-SHA256 under a server secret over the order id and the idempotency key of the checkout. The
 * same checkout therefore always yields the same token, so a double submit hands the same working token to both
 * answers and a replay has nothing to rotate. Core stays pure: it has no crypto, so the HMAC is a port that the API
 * supplies (node:crypto), and the secret is a parameter. Only the SHA-256 of the token is ever stored (by the API).
 */

/** The shortest accepted secret (`ORDER_TOKEN_SECRET`). 32 characters of a random secret are at least 128 bits. */
export const GUEST_ACCESS_TOKEN_SECRET_MIN_LENGTH = 32;

/** HMAC-SHA256 of `message` under `key`: exactly 32 bytes. Supplied by the caller (core has no crypto). */
export type HmacSha256 = (key: string, message: string) => Uint8Array;

export interface GuestAccessTokenInput {
  /** `ORDER_TOKEN_SECRET`. Never part of the message, never logged. */
  readonly secret: string;
  readonly orderId: string;
  /** The `Idempotency-Key` of the checkout that placed the order (lower case, as stored). */
  readonly idempotencyKey: string;
}

/** Domain separation: the same secret can never produce a value that is valid for another purpose. */
const MESSAGE_PREFIX = "fluxkit:order-access-token:v1";
const MAC_BYTES = 32;

function assertField(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\n")) {
    throw new RangeError(`${name} must be a non-empty single line`);
  }
}

/**
 * The access token of a guest order: 32 bytes in unpadded base64url (43 characters). Deterministic. A secret shorter
 * than `GUEST_ACCESS_TOKEN_SECRET_MIN_LENGTH`, an empty or multi-line field, or a port that does not return 32 bytes is a
 * misconfiguration or a bug, so it throws a RangeError instead of producing a weak token.
 */
export function deriveGuestAccessToken(
  input: GuestAccessTokenInput,
  hmacSha256: HmacSha256,
): string {
  if (
    typeof input.secret !== "string" ||
    input.secret.length < GUEST_ACCESS_TOKEN_SECRET_MIN_LENGTH
  ) {
    throw new RangeError(
      `The order token secret must be at least ${String(GUEST_ACCESS_TOKEN_SECRET_MIN_LENGTH)} characters`,
    );
  }
  assertField(input.orderId, "orderId");
  assertField(input.idempotencyKey, "idempotencyKey");
  const mac = hmacSha256(
    input.secret,
    `${MESSAGE_PREFIX}\n${input.orderId}\n${input.idempotencyKey}`,
  );
  if (!(mac instanceof Uint8Array) || mac.length !== MAC_BYTES) {
    throw new RangeError(`The HMAC port must return exactly ${String(MAC_BYTES)} bytes`);
  }
  return toBase64Url(mac);
}
