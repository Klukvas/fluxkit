import type { ProviderAbortSignal } from "../shipping/provider-port.js";
import type { EmailAddress } from "./address.js";
import { EMAIL_CODE_PATTERN, EMAIL_LIMITS, EMAIL_PROVIDER_CODE_PATTERN } from "./limits.js";

/*
 * The email provider port (ADR 0031 decision 3; the ADR 0028 / 0029 pattern). Types and constants only, so a provider
 * package in `packages/providers/<code>` implements it without importing `apps/api`, and core never imports a provider
 * (dependency-cruiser `core-must-not-import-providers`). Internal until the first external plugin, then listed in
 * `docs/contracts/`.
 *
 * Rules every provider follows:
 * - One recipient per message; no cc, bcc, attachments or custom headers from data (decision 16).
 * - Every attempt of one message carries the same `idempotencyKey` (the `email_message.id`); the provider passes it to
 *   the service unchanged.
 * - A failure carries CODES only (`emailProviderFailure` checks them), never the provider's message text: it can echo an
 *   address.
 * - `not_sent` is answered only when the provider can PROVE nothing left the process (local validation, an abort before
 *   the request): it is always safe to retry. A timeout, a network error or a malformed answer may have sent and is
 *   `unavailable` (retried with the same key).
 * - The API, not the provider, decides the timeout (`EMAIL_SEND_TIMEOUT_MS`, through the abort signal), logging and
 *   retries. A provider honours the signal (`ProviderAbortSignal`, the core type of ADR 0029) and never logs a request or
 *   response body.
 */

/** Metadata key on the provider class inside a provider's Nest module (`SetMetadata`); the API finds it by discovery. */
export const EMAIL_PROVIDER_METADATA = "fluxkit:email-provider";

/** The `kind` a provider package declares: `"fluxkit": {"provider": "<code>", "kind": "email"}` in `package.json`. */
export const EMAIL_PROVIDER_PACKAGE_KIND = "email";

export interface EmailProviderMetadata {
  /** Equals the provider's `code`; the API refuses to start on a mismatch. */
  readonly code: string;
}

/** The value for `SetMetadata(EMAIL_PROVIDER_METADATA, ...)`. A malformed code is a bug (RangeError). */
export function emailProviderMetadata(code: string): EmailProviderMetadata {
  if (typeof code !== "string" || !EMAIL_PROVIDER_CODE_PATTERN.test(code)) {
    throw new RangeError(`Not an email provider code: ${String(code)}`);
  }
  return Object.freeze({ code });
}

export const EMAIL_PROVIDER_FAILURE_REASONS = Object.freeze([
  /** Timeout, network failure, 5xx, a concurrent request with the same key, a malformed answer: may have sent. */
  "unavailable",
  /** The service throttles requests (Resend 429 `rate_limit_exceeded`). */
  "rate_limited",
  /** The service refused the message itself (a field, the recipient): retrying cannot help. */
  "rejected",
  /** The key or the sending domain is wrong (Resend 401, 403): the operator must act. */
  "misconfigured",
  /** A daily or monthly sending quota is used up. */
  "quota_exceeded",
  /** The key was already used with another body (Resend 409 `invalid_idempotent_request`): a mail may have gone out. */
  "idempotency_conflict",
  /** Provably nothing left the process (local validation, an abort before the request): always safe to retry. */
  "not_sent",
] as const);

export type EmailProviderFailureReason = (typeof EMAIL_PROVIDER_FAILURE_REASONS)[number];

/** Which quota a `quota_exceeded` failure names, when the service says (Resend `daily_quota_exceeded`, `monthly_...`). */
export const EMAIL_QUOTA_PERIODS = Object.freeze(["daily", "monthly"] as const);

export type EmailQuotaPeriod = (typeof EMAIL_QUOTA_PERIODS)[number];

export interface EmailProviderFailure {
  readonly ok: false;
  readonly reason: EmailProviderFailureReason;
  /** Raw service codes (`EMAIL_CODE_PATTERN`), never message text. May be empty. */
  readonly providerCodes: readonly string[];
  /** The service's `retry-after`, in whole seconds, when it sent one. */
  readonly retryAfterSeconds?: number;
  /** Only with `quota_exceeded`, when the service names the quota. */
  readonly quotaPeriod?: EmailQuotaPeriod;
}

export type EmailProviderResult<T> =
  { readonly ok: true; readonly value: T } | EmailProviderFailure;

export function emailProviderOk<T>(value: T): EmailProviderResult<T> {
  return Object.freeze({ ok: true as const, value });
}

/**
 * A typed failure. Each code must match `EMAIL_CODE_PATTERN` (short, no spaces), so a provider's message text cannot be
 * passed as a code; a bad reason, a bad code, more than `EMAIL_LIMITS.maxProviderCodes` codes, a `retryAfterSeconds` that
 * is not a non-negative whole number, or a `quotaPeriod` on another reason is a bug in the provider (RangeError).
 */
export function emailProviderFailure(
  reason: EmailProviderFailureReason,
  details: {
    readonly providerCodes?: readonly string[];
    readonly retryAfterSeconds?: number;
    readonly quotaPeriod?: EmailQuotaPeriod;
  } = {},
): EmailProviderFailure {
  if (!EMAIL_PROVIDER_FAILURE_REASONS.includes(reason)) {
    throw new RangeError(`Unknown email provider failure reason: ${String(reason)}`);
  }
  const providerCodes = details.providerCodes ?? [];
  if (!Array.isArray(providerCodes) || providerCodes.length > EMAIL_LIMITS.maxProviderCodes) {
    throw new RangeError(
      `An email provider failure carries at most ${String(EMAIL_LIMITS.maxProviderCodes)} codes`,
    );
  }
  for (const code of providerCodes) {
    if (typeof code !== "string" || !EMAIL_CODE_PATTERN.test(code)) {
      throw new RangeError("An email provider failure code must be a short code, not a message");
    }
  }
  const { retryAfterSeconds, quotaPeriod } = details;
  if (
    retryAfterSeconds !== undefined &&
    !(Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds >= 0)
  ) {
    throw new RangeError("retryAfterSeconds must be a non-negative whole number of seconds");
  }
  if (
    quotaPeriod !== undefined &&
    (reason !== "quota_exceeded" || !EMAIL_QUOTA_PERIODS.includes(quotaPeriod))
  ) {
    throw new RangeError("quotaPeriod is daily or monthly, and only with quota_exceeded");
  }
  return Object.freeze({
    ok: false as const,
    reason,
    providerCodes: Object.freeze([...providerCodes]),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    ...(quotaPeriod === undefined ? {} : { quotaPeriod }),
  });
}

export interface EmailProviderCapabilities {
  /** Whether the service deduplicates by `idempotencyKey` (Resend: yes, 24 h, R4). */
  readonly idempotencyKeys: boolean;
  /** Most recipients of one request the service accepts; the API always sends one (v1). */
  readonly maxRecipients: number;
}

/** One mail as the API hands it to a provider: already rendered, sanitized and checked (`validateOutgoingEmail`). */
export interface OutgoingEmail {
  readonly from: EmailAddress;
  readonly replyTo?: EmailAddress;
  /** One recipient (v1). */
  readonly to: EmailAddress;
  readonly subject: string;
  readonly html: string;
  /** Mandatory plain-text part. */
  readonly text: string;
  /** `category` matches `EMAIL_TAG_VALUE_PATTERN` (the template category, e.g. `order`). */
  readonly tags: { readonly category: string };
}

export interface EmailSendOptions {
  /** The `email_message.id`: the same for every attempt of one message (`EMAIL_LIMITS.idempotencyKeyMaxLength`). */
  readonly idempotencyKey: string;
}

export interface EmailSent {
  /** The service's id of the accepted mail (`EMAIL_CODE_PATTERN`; Resend answers a UUID). */
  readonly providerMessageId: string;
}

export interface EmailProviderPort {
  /** Matches `EMAIL_PROVIDER_CODE_PATTERN`, e.g. `resend`. */
  readonly code: string;
  readonly capabilities: EmailProviderCapabilities;
  /**
   * Hands one mail to the service. `ok` means accepted by the service, not delivered. Never throws for a service
   * answer; a thrown error is treated by the API as `unavailable`.
   */
  send(
    message: OutgoingEmail,
    options: EmailSendOptions,
    signal: ProviderAbortSignal,
  ): Promise<EmailProviderResult<EmailSent>>;
}
