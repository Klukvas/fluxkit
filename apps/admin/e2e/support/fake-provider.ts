import { createHmac } from "node:crypto";
import type { APIRequestContext, APIResponse } from "@playwright/test";

/**
 * Kept identical to apps/storefront/e2e/support/fake-provider.ts (two suites, two API processes, one scheme).
 *
 * The test-only `fake` payment provider seen from outside the API process (payments plan step 11). The API of this suite runs
 * in its own process, the production API has no test-only route, so the suite plays the PROVIDER: it POSTs the webhook the
 * provider would send to the real `POST /webhooks/payments/fake` (through the proxy, like the edge proxy does in production),
 * signed with the fake's PUBLIC test key over the exact body bytes. The API therefore runs its real signature check, body
 * reader, fact binding and order integration. Scheme and body shape: `packages/providers/_fake-payment/README.md` ("Driving
 * it from another process"); a drift makes the legitimate webhook of these scenarios fail with `401` or `400`.
 */
export const FAKE_PAYMENT_SIGNATURE_HEADER = "x-fake-signature";
/** The fake's fixed, public test key (never a secret). */
const FAKE_PAYMENT_WEBHOOK_KEY = "fluxkit-fake-payment-webhook-test-key";
const WEBHOOK_PATH = "/webhooks/payments/fake";
const PAGE_ORIGIN = "https://pay.fake.invalid";

export function signFakeWebhook(bytes: Uint8Array): string {
  return createHmac("sha256", FAKE_PAYMENT_WEBHOOK_KEY).update(bytes).digest("hex");
}

/** The fake's invoice id: the last segment of the page URL the API gave the shopper (`https://pay.fake.invalid/pay/<id>`). */
export function providerPaymentIdOf(redirectUrl: string): string {
  const prefix = `${PAGE_ORIGIN}/pay/`;
  if (!redirectUrl.startsWith(prefix)) {
    throw new Error(`Not a fake provider page URL: ${redirectUrl}`);
  }
  return redirectUrl.slice(prefix.length);
}

/**
 * Provider times are fixed instants after the fake's logical clock (which starts on 2026-01-01 and moves one second per
 * change), so no wall clock is involved: a later step of one invoice passes a larger `minutes`.
 */
export function providerTime(minutes: number): string {
  return new Date(Date.UTC(2026, 5, 1, 0, minutes, 0)).toISOString();
}

export interface InvoiceAnnouncement {
  /** The id of the fake invoice (`fake-pay-000001`). */
  providerPaymentId: string;
  /** Our attempt id: the `paymentId` the store create answered. */
  reference: string;
  /** The invoice amount in minor units (what the shop sent: the order total). */
  amount: number;
  currency?: string;
  status: "created" | "processing" | "success" | "failure" | "reversed" | "expired";
  /** Minor units the provider says it took; `null` while nothing was taken. Default: the amount for `success`. */
  finalAmount?: number | null;
  failureCode?: string | null;
  /** See `providerTime`. */
  minutes: number;
  refunds?: {
    refundId: string | null;
    status: "processing" | "success" | "failure";
    amount: number;
    minutes: number;
  }[];
}

/** The JSON text of a webhook body, exactly the shape the fake service sends. */
export function webhookBody(invoice: InvoiceAnnouncement): string {
  const paid = invoice.status === "success";
  return JSON.stringify({
    invoiceId: invoice.providerPaymentId,
    reference: invoice.reference,
    status: invoice.status,
    amount: invoice.amount,
    currency: invoice.currency ?? "UAH",
    finalAmount:
      invoice.finalAmount === undefined ? (paid ? invoice.amount : null) : invoice.finalAmount,
    modifiedDate: providerTime(invoice.minutes),
    failureCode: invoice.failureCode ?? null,
    cancelList: (invoice.refunds ?? []).map((refund) => ({
      extRef: refund.refundId,
      status: refund.status,
      amount: refund.amount,
      modifiedDate: providerTime(refund.minutes),
    })),
    card: paid ? { system: "visa", last4: "4242" } : null,
  });
}

/** The payment provider as a caller of the webhook route. Its own client address, so the webhook limit never couples tests. */
export class FakeProvider {
  constructor(readonly context: APIRequestContext) {}

  /** Posts exactly these bytes. `headers` are sent as given (no signature unless the caller adds one). */
  post(body: string | Buffer, headers: Record<string, string> = {}): Promise<APIResponse> {
    return this.context.post(WEBHOOK_PATH, {
      headers: { "content-type": "application/json", ...headers },
      // A Buffer goes out byte for byte (a string or an object would be encoded by Playwright).
      data: typeof body === "string" ? Buffer.from(body, "utf8") : body,
      failOnStatusCode: false,
    });
  }

  /** The webhook as the provider sends it: the body and `x-fake-signature` over its exact bytes. */
  postSigned(body: string): Promise<APIResponse> {
    return this.post(body, {
      [FAKE_PAYMENT_SIGNATURE_HEADER]: signFakeWebhook(Buffer.from(body, "utf8")),
    });
  }
}
