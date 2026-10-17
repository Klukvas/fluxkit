import { createHash, timingSafeEqual } from "node:crypto";

/*
 * The request fingerprint of a checkout (ADR 0015, Idempotency): SHA-256 of the normalized request plus the id of the
 * cart it was made from. The same `Idempotency-Key` with the same fingerprint is a retry and gets the same order; with
 * another fingerprint it is `idempotency_key_reused`. Including the cart id means a replay is only answered to whoever
 * can still reach that cart (its cookie or the account session), because a replay hands out a new guest access token.
 * Nothing here is a secret: the fingerprint never leaves the API.
 */

export interface FingerprintInput {
  readonly cartId: string;
  /** The values after normalization (trimmed, lower-cased email, `+digits` phone), never the raw request text. */
  readonly email: string;
  readonly phone: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly shippingAddress: Readonly<Record<string, string>> | null;
  readonly billingAddress: Readonly<Record<string, string>> | null;
  /** The locale actually used (the default when the request sent none). */
  readonly locale: string;
  readonly expectedTotal: { readonly amount: number; readonly currency: string };
}

/** Bump when the fields above change, so an old order is never matched against a new layout by accident. */
const FINGERPRINT_VERSION = 1;

/**
 * JSON with the keys of every object sorted, so that equal values give equal text whatever the order the keys were
 * written in. Only what JSON carries exactly is accepted; anything else is a bug of the caller (RangeError).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError("A fingerprint can not contain a number that is not finite");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  throw new RangeError(`A fingerprint can not contain a value of type ${typeof value}`);
}

export function requestFingerprint(input: FingerprintInput): string {
  return createHash("sha256")
    .update(canonicalJson({ v: FINGERPRINT_VERSION, ...input }))
    .digest("hex");
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Constant-time comparison of two stored fingerprints; false (never an error) for anything that is not a SHA-256 hex. */
export function fingerprintsEqual(a: string, b: string): boolean {
  if (!SHA256_HEX.test(a) || !SHA256_HEX.test(b)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
