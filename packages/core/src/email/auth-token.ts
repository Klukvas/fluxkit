import { normalizeEmail } from "../auth/email.js";
import { GUEST_ACCESS_TOKEN_SECRET_MIN_LENGTH, type HmacSha256 } from "../orders/access-token.js";
import { toBase64Url } from "../orders/base64url.js";

/*
 * Customer auth tokens: password reset and email verification (ADR 0031 decision 9; the ADR 0023 technique). A token is
 * DERIVED, never stored: `base64url(HMAC-SHA256(ORDER_TOKEN_SECRET, label + "\n" + purpose + "\n" + tokenId))`, where
 * `tokenId` is the random id of the `customer_auth_token` row. The row stores only SHA-256 of the token and the outbox
 * only `tokenId`; the sender derives the token while rendering. Core has no crypto: the HMAC is the `HmacSha256` port
 * the API supplies (node:crypto), as for the guest order token. Core decides the message layout and every rule.
 */

export const AUTH_TOKEN_PURPOSES = Object.freeze(["password_reset", "email_verification"] as const);

export type AuthTokenPurpose = (typeof AUTH_TOKEN_PURPOSES)[number];

/** Lifetimes (decision 9): a reset 60 minutes, a verification 48 hours. */
export const AUTH_TOKEN_LIFETIME_MINUTES = Object.freeze({
  password_reset: 60,
  email_verification: 48 * 60,
} as const satisfies Record<AuthTokenPurpose, number>);

/** Domain separation from the guest order token (`fluxkit:order-access-token:v1`) under the same secret. */
export const CUSTOMER_AUTH_TOKEN_LABEL = "fluxkit:customer-auth-token:v1";

/** A derived token as it travels in a link fragment: 32 bytes in unpadded base64url, exactly 43 characters. */
export const CUSTOMER_AUTH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** `customer_auth_token.id` as Postgres prints a uuid: lower-case hex. */
const TOKEN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAC_BYTES = 32;
const MINUTE_MS = 60_000;

function assertPurpose(value: unknown): asserts value is AuthTokenPurpose {
  if (!AUTH_TOKEN_PURPOSES.includes(value as AuthTokenPurpose)) {
    throw new RangeError(`Unknown auth token purpose: ${String(value)}`);
  }
}

function timeOf(value: Date, name: string): number {
  const time = value instanceof Date ? value.getTime() : Number.NaN;
  if (Number.isNaN(time)) {
    throw new RangeError(`${name} must be a valid Date`);
  }
  return time;
}

/** `customer_auth_token.expires_at` of a token created at `createdAt`. */
export function authTokenExpiresAt(purpose: AuthTokenPurpose, createdAt: Date): Date {
  assertPurpose(purpose);
  return new Date(
    timeOf(createdAt, "createdAt") + AUTH_TOKEN_LIFETIME_MINUTES[purpose] * MINUTE_MS,
  );
}

/**
 * The HMAC message: `CUSTOMER_AUTH_TOKEN_LABEL`, the purpose and the token id, separated by `\n`. The token id must be a
 * lower-case UUID, so no field can contain the separator or trade characters with another.
 */
export function customerAuthTokenMessage(purpose: AuthTokenPurpose, tokenId: string): string {
  assertPurpose(purpose);
  if (typeof tokenId !== "string" || !TOKEN_ID_PATTERN.test(tokenId)) {
    throw new RangeError("tokenId must be a lower-case UUID");
  }
  return `${CUSTOMER_AUTH_TOKEN_LABEL}\n${purpose}\n${tokenId}`;
}

export interface CustomerAuthTokenInput {
  /** `ORDER_TOKEN_SECRET`. The HMAC key; never part of the message, never logged. */
  readonly secret: string;
  readonly purpose: AuthTokenPurpose;
  /** `customer_auth_token.id`. */
  readonly tokenId: string;
}

/**
 * The token of one `customer_auth_token` row: deterministic, 43 characters. A short secret, a bad purpose or token id,
 * or a port that does not return 32 bytes is a misconfiguration or a bug: RangeError, never a weak token.
 */
export function deriveCustomerAuthToken(
  input: CustomerAuthTokenInput,
  hmacSha256: HmacSha256,
): string {
  if (
    typeof input.secret !== "string" ||
    input.secret.length < GUEST_ACCESS_TOKEN_SECRET_MIN_LENGTH
  ) {
    throw new RangeError(
      `The token secret must be at least ${String(GUEST_ACCESS_TOKEN_SECRET_MIN_LENGTH)} characters`,
    );
  }
  const mac = hmacSha256(input.secret, customerAuthTokenMessage(input.purpose, input.tokenId));
  if (!(mac instanceof Uint8Array) || mac.length !== MAC_BYTES) {
    throw new RangeError(`The HMAC port must return exactly ${String(MAC_BYTES)} bytes`);
  }
  return toBase64Url(mac);
}

/** Whether a client-sent value can be a token at all: checked before it is hashed and looked up. */
export function isCustomerAuthTokenFormat(value: unknown): value is string {
  return typeof value === "string" && CUSTOMER_AUTH_TOKEN_PATTERN.test(value);
}

/** The stored facts of the token row found by the hash of the presented token. */
export interface AuthTokenFacts {
  readonly purpose: AuthTokenPurpose;
  /** The address the token was sent to. */
  readonly email: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
}

/** The facts of the token's customer, read with the token. */
export interface AuthTokenCustomerFacts {
  readonly email: string;
  readonly isActive: boolean;
}

/** In the order they are checked; `used` comes last (see `evaluateAuthToken`). */
export const AUTH_TOKEN_REFUSALS = Object.freeze([
  "not_found",
  "wrong_purpose",
  "expired",
  "customer_inactive",
  "email_changed",
  "used",
] as const);

export type AuthTokenRefusal = (typeof AUTH_TOKEN_REFUSALS)[number];

export type AuthTokenDecision =
  { readonly ok: true } | { readonly ok: false; readonly reason: AuthTokenRefusal };

/**
 * Whether a presented token may be used now (ADR 0031 decision 9). Checked in this order: the row exists, it is for
 * `purpose`, `now` is strictly before `expiresAt` (at exactly `expiresAt` it is expired), the customer exists and is
 * active, the customer's address is still the one the token was sent to (compared in the stored, normalized form), and
 * the token is unused. `used` therefore means "valid in every other way": the one case the verify route answers `204`
 * again for an already verified customer. A newer token of the same purpose, a password change and a deactivation mark
 * older tokens used (the API does). The routes answer every refusal alike (`invalid_or_expired`); the reason is for
 * tests and logs. Input that can only be a bug (an invalid date, an unknown purpose) throws a RangeError.
 */
export function evaluateAuthToken(input: {
  readonly token: AuthTokenFacts | null;
  readonly customer: AuthTokenCustomerFacts | null;
  readonly purpose: AuthTokenPurpose;
  readonly now: Date;
}): AuthTokenDecision {
  assertPurpose(input.purpose);
  const nowMs = timeOf(input.now, "now");
  const refuse = (reason: AuthTokenRefusal): AuthTokenDecision =>
    Object.freeze({ ok: false as const, reason });
  const { token, customer } = input;
  if (token === null) {
    return refuse("not_found");
  }
  if (token.purpose !== input.purpose) {
    return refuse("wrong_purpose");
  }
  if (nowMs >= timeOf(token.expiresAt, "expiresAt")) {
    return refuse("expired");
  }
  if (customer === null || !customer.isActive) {
    return refuse("customer_inactive");
  }
  if (normalizeEmail(customer.email) !== normalizeEmail(token.email)) {
    return refuse("email_changed");
  }
  if (token.usedAt !== null) {
    return refuse("used");
  }
  return Object.freeze({ ok: true as const });
}
