import { z } from "zod";
import {
  EMAIL_CODE_PATTERN,
  emailProviderFailure,
  emailProviderOk,
  type EmailProviderResult,
  type EmailSent,
} from "@fluxkit/core";
import type { ResendAnswer } from "./http.js";

/*
 * Resend's answer to `POST /emails` as a typed `EmailProviderResult` (ADR 0031 decisions 3 and 6; plan section 2, R4, R5,
 * R7, R8, R9). Mapping is by HTTP status first (R8: `validation_error` appears on 400, 401 and 403); the error `name` only
 * refines a status, and only when it is one of the names Resend documents (`RESEND_ERROR_NAMES`). Nothing else from an
 * error body is ever kept: its `message` can echo an address, and an unknown `name` could echo anything.
 *
 * Codes of a failure: the documented error name first (when there is one), then the HTTP status, so the API's
 * `last_error_code` reads `quota_exceeded:daily_quota_exceeded` rather than a bare status.
 */

/**
 * Every error name the plan's R4 and R8 list (Resend's errors page, read 2026-10-26; the URL is in the plan). A name not
 * in this list is dropped, never echoed.
 */
export const RESEND_ERROR_NAMES = Object.freeze([
  "validation_error",
  "missing_api_key",
  "restricted_api_key",
  "suspended_api_key",
  "not_found",
  "concurrent_idempotent_requests",
  "invalid_idempotent_request",
  "invalid_idempotency_key",
  "resource_locked",
  "missing_required_field",
  "invalid_parameter",
  "invalid_attachment",
  "rate_limit_exceeded",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
  "application_error",
  "service_unavailable",
] as const);

export type ResendErrorName = (typeof RESEND_ERROR_NAMES)[number];

/** R5: `{ "id": "<uuid>" }`. Extra members are allowed; the id must fit the core code pattern (a UUID does). */
const successSchema = z.looseObject({ id: z.string().regex(EMAIL_CODE_PATTERN) });

/** R9 (LIKELY, not in the official reference): `{statusCode, name, message}`. Only `name` is read, leniently. */
const errorSchema = z.looseObject({ name: z.string().max(64) });

/** The error name of an answer when it is a documented one, else `undefined`. */
export function resendErrorNameOf(json: unknown): ResendErrorName | undefined {
  const parsed = errorSchema.safeParse(json);
  if (!parsed.success) {
    return undefined;
  }
  const name = parsed.data.name;
  return (RESEND_ERROR_NAMES as readonly string[]).includes(name)
    ? (name as ResendErrorName)
    : undefined;
}

/** Longest `retry-after` taken (31 days); a larger or other value is ignored as unreadable. */
const RETRY_AFTER_MAX_SECONDS = 31 * 24 * 60 * 60;

/**
 * `retry-after` in whole seconds (R7: "retry-after (seconds)"). Resend documents seconds only, so an HTTP-date or any
 * other form is ignored (the core schedule applies), never guessed.
 */
export function retryAfterSecondsOf(header: string | null): number | undefined {
  if (header === null) {
    return undefined;
  }
  const trimmed = header.trim();
  if (!/^\d{1,8}$/.test(trimmed)) {
    return undefined;
  }
  const seconds = Number(trimmed);
  return seconds <= RETRY_AFTER_MAX_SECONDS ? seconds : undefined;
}

function codes(name: ResendErrorName | undefined, status: number): string[] {
  return name === undefined ? [String(status)] : [name, String(status)];
}

/**
 * The result of one answered request. Rules (decision 6 and the plan's step 6 row):
 * - 2xx with a readable `{id}`: success. A 2xx that cannot be read is `unavailable` `malformed_answer`: the mail may
 *   have been accepted, so it is retried with the same idempotency key (Resend replays the first answer), never failed.
 * - 400 and 422 with a documented name: `rejected` (local validation runs first, so a field refusal is unlikely to be
 *   ours; R8's ambiguity of `validation_error` is accepted as the ADR says). Without a documented name the answer did not
 *   come from Resend's API layer as documented: `unavailable` (retried with the same key, which cannot duplicate).
 * - 401, 403, 404, 405: `misconfigured` (key, sending domain, testing mode, `User-Agent`, endpoint; the operator acts).
 * - 409: `invalid_idempotent_request` is `idempotency_conflict` (an earlier attempt with this key reached Resend with
 *   another body; a mail may have gone out); any other 409 (`concurrent_idempotent_requests`, `resource_locked`,
 *   unnamed) is `unavailable` (retry with the same key).
 * - 429: `daily_quota_exceeded` and `monthly_quota_exceeded` are `quota_exceeded` with the period; anything else is
 *   `rate_limited`; `retry-after` is passed on.
 * - 408 and 5xx: `unavailable` (with `retry-after` when sent). Other 4xx: `rejected`. Anything else: `unavailable`.
 */
export function mapResendAnswer(answer: ResendAnswer): EmailProviderResult<EmailSent> {
  const { status } = answer;
  if (status >= 200 && status < 300) {
    const parsed = successSchema.safeParse(answer.json);
    return parsed.success
      ? emailProviderOk({ providerMessageId: parsed.data.id })
      : emailProviderFailure("unavailable", {
          providerCodes: ["malformed_answer", String(status)],
        });
  }
  const name = resendErrorNameOf(answer.json);
  const retryAfterSeconds = retryAfterSecondsOf(answer.retryAfter);
  const retry = retryAfterSeconds === undefined ? {} : { retryAfterSeconds };
  if (status === 400 || status === 422) {
    return name === undefined
      ? emailProviderFailure("unavailable", { providerCodes: ["unnamed_error", String(status)] })
      : emailProviderFailure("rejected", { providerCodes: codes(name, status) });
  }
  if (status === 401 || status === 403 || status === 404 || status === 405) {
    return emailProviderFailure("misconfigured", { providerCodes: codes(name, status) });
  }
  if (status === 409) {
    return name === "invalid_idempotent_request"
      ? emailProviderFailure("idempotency_conflict", { providerCodes: codes(name, status) })
      : emailProviderFailure("unavailable", { providerCodes: codes(name, status), ...retry });
  }
  if (status === 429) {
    if (name === "daily_quota_exceeded" || name === "monthly_quota_exceeded") {
      return emailProviderFailure("quota_exceeded", {
        providerCodes: codes(name, status),
        quotaPeriod: name === "daily_quota_exceeded" ? "daily" : "monthly",
        ...retry,
      });
    }
    return emailProviderFailure("rate_limited", { providerCodes: codes(name, status), ...retry });
  }
  if (status === 408 || status >= 500) {
    return emailProviderFailure("unavailable", { providerCodes: codes(name, status), ...retry });
  }
  if (status >= 400) {
    return emailProviderFailure("rejected", { providerCodes: codes(name, status) });
  }
  return emailProviderFailure("unavailable", {
    providerCodes: ["unexpected_status", String(status)],
  });
}
