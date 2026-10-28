import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * The fake webhook scheme (TEST-ONLY, documented in the package README). It is NOT Monobank's: Monobank signs with ECDSA
 * (`X-Sign`, ADR 0032 M12). The fake needs only a scheme that a body changed after signing, or a missing signature,
 * visibly breaks, so API specs and e2e can drive the webhook route with `invalid_signature` and valid cases:
 *   header `x-fake-signature` = lower-case hex of HMAC-SHA256(key = FAKE_PAYMENT_WEBHOOK_KEY, message = the exact raw body).
 * The key is a fixed public constant on purpose: nothing it signs is worth forging, and the package refuses production.
 */

export const FAKE_PAYMENT_SIGNATURE_HEADER = "x-fake-signature";

/** The fixed test key. Public on purpose; never a real secret. */
export const FAKE_PAYMENT_WEBHOOK_KEY = "fluxkit-fake-payment-webhook-test-key";

export function signFakeWebhook(rawBody: Uint8Array): string {
  return createHmac("sha256", FAKE_PAYMENT_WEBHOOK_KEY).update(rawBody).digest("hex");
}

/** Constant-time comparison; false for a missing, malformed or wrong signature. */
export function fakeWebhookSignatureMatches(
  headers: Readonly<Record<string, string>>,
  rawBody: Uint8Array,
): boolean {
  const given = headers[FAKE_PAYMENT_SIGNATURE_HEADER];
  if (typeof given !== "string" || !/^[0-9a-f]{64}$/.test(given)) {
    return false;
  }
  const expected = signFakeWebhook(rawBody);
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

/** A webhook request exactly as the fake would send it: the body bytes and the signed header (lower-case names). */
export function fakeWebhookInput(body: string | Uint8Array): {
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: Uint8Array;
} {
  const rawBody = typeof body === "string" ? new TextEncoder().encode(body) : Uint8Array.from(body);
  return {
    headers: {
      "content-type": "application/json",
      [FAKE_PAYMENT_SIGNATURE_HEADER]: signFakeWebhook(rawBody),
    },
    rawBody,
  };
}
