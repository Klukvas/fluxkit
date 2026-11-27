import { createHmac, timingSafeEqual } from "node:crypto";
import {
  paymentProviderFailure,
  paymentProviderOk,
  type CreateOutboundClient,
  type LocateWebhook,
  type ProviderAbortSignal,
} from "@fluxkit/core";
import {
  signTestWebhook,
  TEST_PAYMENT_SIGNATURE_HEADER,
  TestPaymentProvider,
  type TestPaymentWebhookBody,
} from "./test-payment-provider.js";

export interface ManagedPaymentRequest {
  readonly operation: string;
  readonly token: string;
}

/** TEST ONLY: shared remote state, but each managed client captures its own credential bundle and gate. */
export class ManagedTestPaymentProvider {
  readonly backend = new TestPaymentProvider();
  readonly calls: ManagedPaymentRequest[] = [];
  onRequest?: (request: ManagedPaymentRequest, input?: unknown) => Promise<void>;

  constructor(
    readonly code: string,
    readonly formHandoff = false,
  ) {
    this.backend.formHandoff = formHandoff;
  }

  invoice(id: string): TestPaymentWebhookBody {
    return JSON.parse(this.backend.webhookBody(id)) as TestPaymentWebhookBody;
  }

  readonly createOutboundClient: CreateOutboundClient<"payment"> = (secrets, context) => {
    const token = this.formHandoff ? secrets.private_key : secrets.token;
    if (!token || (this.formHandoff && !secrets.public_key)) throw new Error("incomplete_bundle");
    const request = <T>(
      operation: string,
      signal: ProviderAbortSignal,
      work: () => Promise<T>,
      input?: unknown,
    ): Promise<T> =>
      context.transport.start(signal, () => {
        const call = { operation, token };
        this.calls.push(call);
        // Start the simulated request inside admission; its response may arrive after locks release.
        const observed = this.onRequest?.(call, input);
        return { completion: Promise.resolve(observed).then(work) };
      });
    return {
      code: this.code,
      capabilities: { ...this.backend.capabilities, currencies: ["UAH"] },
      createPayment: (input, signal) =>
        request("create", signal, () => this.backend.createPayment(input, signal), input),
      getPayment: (id, signal) =>
        request("status", signal, () => this.backend.getPayment(id, signal)),
      invalidatePayment: (id, signal) =>
        request("remove", signal, () => this.backend.invalidatePayment(id, signal)),
      refund: (input, signal) =>
        request("refund", signal, () => this.backend.refund(input, signal)),
      verifyWebhook: (input, signal) =>
        request("verify", signal, () => {
          const expected = createHmac("sha256", token).update(input.rawBody).digest("hex");
          const given = input.headers[TEST_PAYMENT_SIGNATURE_HEADER] ?? "";
          if (
            !/^[a-f0-9]{64}$/.test(given) ||
            !timingSafeEqual(Buffer.from(given), Buffer.from(expected))
          )
            return Promise.resolve(paymentProviderFailure("invalid_signature"));
          return this.backend.verifyWebhook(
            {
              ...input,
              headers: {
                ...input.headers,
                [TEST_PAYMENT_SIGNATURE_HEADER]: signTestWebhook(input.rawBody),
              },
            },
            signal,
          );
        }),
      buildCheckoutHandoff: (input, signal) =>
        request("sign", signal, async () => {
          const handoff = await this.backend.buildCheckoutHandoff(input, signal);
          if (!handoff.ok) return handoff;
          const data = Buffer.from(
            JSON.stringify({
              reference: input.paymentId,
              public_key: secrets.public_key,
            }),
          ).toString("base64");
          return paymentProviderOk({
            ...handoff.value,
            fields: { data, signature: createHmac("sha256", token).update(data).digest("hex") },
          });
        }),
    };
  };

  readonly locateWebhook: LocateWebhook = (input) => {
    if (input.rawBody.length > 65_536) return null;
    try {
      const body = JSON.parse(
        Buffer.from(input.rawBody).toString("utf8"),
      ) as TestPaymentWebhookBody;
      return typeof body.invoiceId === "string" && typeof body.reference === "string"
        ? { providerPaymentId: body.invoiceId, reference: body.reference }
        : null;
    } catch {
      return null;
    }
  };
}
