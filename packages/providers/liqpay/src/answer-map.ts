import { paymentProviderFailure, type PaymentProviderFailure } from "@fluxkit/core";
import type { LiqPayAnswer, LiqPayExchange } from "./http.js";

export const LIQPAY_ERROR_CODES = Object.freeze([
  "payment_not_found",
  "order_not_found",
  "err_auth",
  "err_missing",
  "err_wrong",
  "limit",
] as const);

export type LiqPayErrorCode = (typeof LIQPAY_ERROR_CODES)[number];

function codes(status: number, code?: string): string[] {
  return code === undefined ? [String(status)] : [code, String(status)];
}

export function liqpayErrorCodeOf(json: unknown): LiqPayErrorCode | undefined {
  if (typeof json !== "object" || json === null) {
    return undefined;
  }
  const err = (json as Record<string, unknown>).err_code;
  if (err === undefined || err === null) {
    return undefined;
  }
  const code = String(err);
  return (LIQPAY_ERROR_CODES as readonly string[]).includes(code)
    ? (code as LiqPayErrorCode)
    : undefined;
}

export function mapLiqPayError(answer: LiqPayAnswer): PaymentProviderFailure {
  const { status } = answer;
  const code = liqpayErrorCodeOf(answer.json);
  if (status === 400 || status === 422) {
    if (
      code === "payment_not_found" ||
      code === "order_not_found" ||
      (typeof answer.json === "object" &&
        answer.json !== null &&
        (answer.json as Record<string, unknown>).status === "error")
    ) {
      return paymentProviderFailure("not_found", { providerCodes: codes(status, code) });
    }
    return code === undefined
      ? paymentProviderFailure("unavailable", { providerCodes: ["unnamed_error", String(status)] })
      : paymentProviderFailure("rejected", { providerCodes: codes(status, code) });
  }
  if (status === 401 || status === 403) {
    return paymentProviderFailure("misconfigured", { providerCodes: codes(status, code) });
  }
  if (status === 404) {
    return paymentProviderFailure("not_found", { providerCodes: codes(status, code) });
  }
  if (status === 429) {
    return paymentProviderFailure("rate_limited", { providerCodes: codes(status, code) });
  }
  if (status >= 500 || status === 408) {
    return paymentProviderFailure("unavailable", { providerCodes: codes(status, code) });
  }
  return paymentProviderFailure("unavailable", {
    providerCodes: ["unexpected_status", String(status)],
  });
}

export function malformedAnswer(
  status: number,
  detail = "malformed_answer",
): PaymentProviderFailure {
  return paymentProviderFailure("unavailable", { providerCodes: [detail, String(status)] });
}

export function failureOfExchange(
  exchange: Extract<LiqPayExchange, { kind: "failed" }>,
): PaymentProviderFailure {
  if (exchange.code === "aborted_before_send") {
    return paymentProviderFailure("not_sent", { providerCodes: ["aborted"] });
  }
  return paymentProviderFailure("unavailable", {
    providerCodes:
      exchange.status === undefined ? [exchange.code] : [exchange.code, String(exchange.status)],
  });
}
