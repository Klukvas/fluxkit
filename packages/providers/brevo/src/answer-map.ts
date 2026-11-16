import { z } from "zod";
import {
  emailProviderFailure,
  emailProviderOk,
  isEmailProviderMessageId,
  type EmailProviderResult,
  type EmailSent,
} from "@fluxkit/core";
import type { BrevoAnswer } from "./http.js";

/** Official generic vocabulary, never provider free-form message or another vendor's names. */
export const BREVO_ERROR_CODES = Object.freeze([
  "invalid_parameter",
  "missing_parameter",
  "out_of_range",
  "unauthorized",
  "document_not_found",
  "method_not_allowed",
  "not_enough_credits",
  "duplicate_parameter",
  "duplicate_request",
  "account_under_validation",
  "permission_denied",
] as const);
export type BrevoErrorCode = (typeof BREVO_ERROR_CODES)[number];
const successSchema = z.looseObject({ messageId: z.string().refine(isEmailProviderMessageId) });
const errorSchema = z.looseObject({ code: z.enum(BREVO_ERROR_CODES), message: z.string() });
export function brevoErrorCodeOf(json: unknown): BrevoErrorCode | undefined {
  const parsed = errorSchema.safeParse(json);
  return parsed.success ? parsed.data.code : undefined;
}
/** Only explicitly seconds-based Retry-After is consumed; send-endpoint reset units remain unverified. */
export function retryAfterSecondsOf(header: string | null): number | undefined {
  if (header === null || !/^\d{1,8}$/.test(header.trim())) return undefined;
  const seconds = Number(header.trim());
  return seconds <= 31 * 24 * 60 * 60 ? seconds : undefined;
}
/** TODO(fluxkit): not live-verified — B3 reset units and B4 exact endpoint status/code combinations.
 * Unknown envelopes, 408 and all 5xx are ambiguous before any body code is considered.
 * TODO(fluxkit): not live-verified — B5/B6 credit refusal versus remote acceptance/queueing/reset.
 * A credit-looking response is NOT proven non-acceptance yet, so it remains unavailable (no quota period).
 */
export function mapBrevoAnswer(answer: BrevoAnswer): EmailProviderResult<EmailSent> {
  const { status } = answer;
  const retryAfterSeconds = retryAfterSecondsOf(answer.retryAfter);
  const retry = retryAfterSeconds === undefined ? {} : { retryAfterSeconds };
  if (status === 201) {
    const parsed = successSchema.safeParse(answer.json);
    return parsed.success
      ? emailProviderOk({ providerMessageId: parsed.data.messageId })
      : emailProviderFailure("unavailable", {
          providerCodes: ["malformed_answer", String(status)],
        });
  }
  if (status === 408 || status >= 500)
    return emailProviderFailure("unavailable", { providerCodes: [String(status)], ...retry });
  const code = brevoErrorCodeOf(answer.json);
  if (code === undefined)
    return emailProviderFailure("unavailable", {
      providerCodes: ["malformed_answer", String(status)],
      ...retry,
    });
  const details = { providerCodes: [code, String(status)] };
  if (
    (status === 401 || status === 403) &&
    (code === "unauthorized" || code === "permission_denied")
  ) {
    return emailProviderFailure("misconfigured", details);
  }
  if ((status === 400 || status === 402 || status === 403) && code === "account_under_validation") {
    return emailProviderFailure("misconfigured", details);
  }
  if (status === 400 && ["invalid_parameter", "missing_parameter", "out_of_range"].includes(code)) {
    return emailProviderFailure("rejected", details);
  }
  // TODO(fluxkit): not live-verified — B2 duplicate context (same body, changed body and concurrent UUID).
  // A duplicate is ambiguous: record the conflict, never manufacture success or assume remote protection.
  if (status === 400 && code === "duplicate_parameter")
    return emailProviderFailure("idempotency_conflict", details);
  // A valid Brevo envelope plus 429 identifies throttling, not daily/monthly sending credits.
  if (
    status === 429 &&
    !["not_enough_credits", "duplicate_parameter", "duplicate_request"].includes(code)
  )
    return emailProviderFailure("rate_limited", { ...details, ...retry });
  return emailProviderFailure("unavailable", { ...details, ...retry });
}
