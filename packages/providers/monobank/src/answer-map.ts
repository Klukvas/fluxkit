import { z } from "zod";
import { paymentProviderFailure, type PaymentProviderFailure } from "@fluxkit/core";
import type { MonobankAnswer, MonobankExchange } from "./http.js";

/*
 * Monobank's failed answers as typed `PaymentProviderFailure`s (ADR 0032 decisions 3 and 15; M16). Mapping is by HTTP
 * status first; the error code (`errCode`) only refines a status, and only when it is one of the codes Monobank documents
 * (`MONOBANK_ERROR_CODES`, the OpenAPI spec "Acquiring v2410" embedded in https://api.monobank.ua/docs/acquiring.html,
 * read 2026-10-29). Nothing else from an error body is ever kept: `errText` is "informative only, do not use it in
 * business logic" (M16) and may echo request values; an undocumented code could echo anything.
 *
 * Codes of a failure: the documented `errCode` first (when there is one), then the HTTP status, so the API's
 * `failure_code` reads `WRONG_CANCEL_AMOUNT` rather than a bare `400`.
 */

/**
 * Every `errCode` the OpenAPI spec documents for the API's own errors (`BadRequestError`, `ForbiddenError`,
 * `NotFoundError`, `MethodNotAllowedError`, `TooManyRequestsError`, `InternalServerError`). A code not in this list is
 * dropped, never echoed. Payment error codes (`errCode` of an invoice, M7) are a different field and are not mapped here.
 */
export const MONOBANK_ERROR_CODES = Object.freeze([
  "BAD_REQUEST",
  "1001",
  "INVALID_MERCHANT_PAYM_INFO",
  "ORDER_IN_PROGRESS",
  "HOLD_INVOICE_NOT_FINALIZED",
  "WRONG_CANCEL_AMOUNT",
  "TOKEN_NOT_FOUND",
  "FORBIDDEN",
  "NOT_FOUND",
  "1004",
  "METHOD_NOT_ALLOWED",
  "TMR",
  "INTERNAL_ERROR",
  "CANCEL_NOT_AVAILABLE",
] as const);

export type MonobankErrorCode = (typeof MONOBANK_ERROR_CODES)[number];

/** M16: `{errCode, errText}`. Only `errCode` is read, leniently (a number is accepted as its digits). */
const errorSchema = z.looseObject({ errCode: z.union([z.string().max(64), z.int()]) });

/** The error code of an answer when it is a documented one, else `undefined`. */
export function monobankErrorCodeOf(json: unknown): MonobankErrorCode | undefined {
  const parsed = errorSchema.safeParse(json);
  if (!parsed.success) {
    return undefined;
  }
  const code = String(parsed.data.errCode);
  return (MONOBANK_ERROR_CODES as readonly string[]).includes(code)
    ? (code as MonobankErrorCode)
    : undefined;
}

/** Longest `retry-after` taken (one day); a larger or other value is ignored as unreadable. */
const RETRY_AFTER_MAX_SECONDS = 24 * 60 * 60;

/**
 * `retry-after` in whole seconds. Monobank documents no such header (M17: UNKNOWN); if one comes, only the plain seconds
 * form is taken. An HTTP-date or any other form is ignored, never guessed.
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

function codes(code: MonobankErrorCode | undefined, status: number): string[] {
  return code === undefined ? [String(status)] : [code, String(status)];
}

/**
 * The failure of an answered request whose status is not a success (the caller handles 2xx). Rules:
 * - 400 with a documented code: `rejected` (Monobank refused the request; for a refund `WRONG_CANCEL_AMOUNT` also
 *   means "already cancelled", which core settles from the payment's refund list). A 400 without a documented code did
 *   not come from the API layer as documented: `unavailable` (the request may have been processed).
 * - 403: `misconfigured` (the token is invalid, M16). 405: `misconfigured` (a wrong method is our bug or a proxy's).
 * - 404 with `NOT_FOUND` or `1004`: `not_found`. A 404 without a documented code may be a proxy or a wrong route:
 *   `unavailable` (never a false "no such invoice").
 * - 429: `rate_limited` (M16 `TMR`; the request was not processed); a `retry-after` in seconds is passed on (M17).
 * - 500 with `CANCEL_NOT_AVAILABLE`: `not_cancellable` (M13). Any other 5xx and 408: `unavailable`.
 * - Anything else (other 4xx, 1xx, 3xx that `fetch` did not refuse): `unavailable`, because Monobank documents no other
 *   status and a create or a refund may have been processed.
 */
export function mapMonobankError(answer: MonobankAnswer): PaymentProviderFailure {
  const { status } = answer;
  const code = monobankErrorCodeOf(answer.json);
  if (status === 400) {
    return code === undefined
      ? paymentProviderFailure("unavailable", { providerCodes: ["unnamed_error", "400"] })
      : paymentProviderFailure("rejected", { providerCodes: codes(code, status) });
  }
  if (status === 403 || status === 405) {
    return paymentProviderFailure("misconfigured", { providerCodes: codes(code, status) });
  }
  if (status === 404) {
    return code === "NOT_FOUND" || code === "1004"
      ? paymentProviderFailure("not_found", { providerCodes: codes(code, status) })
      : paymentProviderFailure("unavailable", { providerCodes: codes(code, status) });
  }
  if (status === 429) {
    const retryAfterSeconds = retryAfterSecondsOf(answer.retryAfter);
    return paymentProviderFailure("rate_limited", {
      providerCodes: codes(code, status),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
  }
  if (status === 500 && code === "CANCEL_NOT_AVAILABLE") {
    return paymentProviderFailure("not_cancellable", { providerCodes: codes(code, status) });
  }
  if (status === 408 || status >= 500) {
    return paymentProviderFailure("unavailable", { providerCodes: codes(code, status) });
  }
  return paymentProviderFailure("unavailable", {
    providerCodes: ["unexpected_status", String(status)],
  });
}

/** A 2xx the plugin cannot read: the request may have been processed, so it is never a refusal (decision 3). */
export function malformedAnswer(
  status: number,
  detail = "malformed_answer",
): PaymentProviderFailure {
  return paymentProviderFailure("unavailable", { providerCodes: [detail, String(status)] });
}

/**
 * The failure of an exchange that produced no readable answer. Only an abort before `fetch` proves nothing left the
 * process (`not_sent`); a timeout, a network failure, a refused redirect, an oversized or unreadable answer may have
 * reached Monobank (`unavailable`).
 */
export function failureOfExchange(
  exchange: Extract<MonobankExchange, { kind: "failed" }>,
): PaymentProviderFailure {
  if (exchange.code === "aborted_before_send") {
    return paymentProviderFailure("not_sent", { providerCodes: ["aborted"] });
  }
  return paymentProviderFailure("unavailable", {
    providerCodes:
      exchange.status === undefined ? [exchange.code] : [exchange.code, String(exchange.status)],
  });
}
