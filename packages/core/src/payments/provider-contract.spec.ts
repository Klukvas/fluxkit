import { describe, expect, it } from "vitest";
import type { Money } from "../pricing/money.js";
import type { ProviderAbortSignal } from "../shipping/provider-port.js";
import {
  checkPaymentProviderContract,
  type PaymentProviderContractScenario,
} from "./provider-contract.js";
import {
  paymentProviderFailure,
  paymentProviderOk,
  type CreatePaymentInput,
  type PaymentProviderPort,
  type PaymentWebhookInput,
  type ProviderPaymentFact,
  type ProviderRefundStatus,
} from "./provider-port.js";
import { OTHER_PAYMENT_ID, PAYMENT_ID, uah } from "./test-support.js";

function signal(aborted: boolean): ProviderAbortSignal {
  const reason = new Error("aborted");
  return {
    aborted,
    reason: aborted ? reason : undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    throwIfAborted: () => {
      if (aborted) {
        throw reason;
      }
    },
  };
}

interface Invoice {
  id: string;
  reference: string;
  amount: Money;
  status: ProviderPaymentFact["status"];
  refunds: { refundId: string; amount: Money; status: ProviderRefundStatus }[];
}

/** ASCII only: core has no DOM or Node types (no TextEncoder). */
const encode = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const decode = (bytes: Uint8Array) => String.fromCharCode(...bytes);
const checksum = (bytes: Uint8Array) => String(bytes.reduce((sum, byte) => sum + byte, 0));

/** A stub provider that keeps every rule; `breaks` switches one rule off. */
function stubProvider(breaks: Partial<Record<string, boolean>> = {}): PaymentProviderPort {
  const invoices = new Map<string, Invoice>();
  invoices.set("paid_1", {
    id: "paid_1",
    reference: OTHER_PAYMENT_ID,
    amount: uah(10_000),
    status: "succeeded",
    refunds: [],
  });
  let next = 1;
  const toFact = (invoice: Invoice): ProviderPaymentFact => ({
    providerPaymentId: invoice.id,
    reference: invoice.reference,
    status: invoice.status,
    providerStatus: invoice.status === "succeeded" ? "success" : "created",
    amount: invoice.amount,
    finalAmount: invoice.status === "succeeded" ? invoice.amount : null,
    modifiedAt: new Date("2026-10-26T10:00:00.000Z"),
    failureCode: null,
    refunds: invoice.refunds.map((refund) => ({
      refundId: breaks.forgetsRefundId ? null : refund.refundId,
      status: refund.status,
      amount: refund.amount,
      modifiedAt: new Date("2026-10-26T10:00:00.000Z"),
    })),
    card: null,
  });
  return {
    code: breaks.badCode ? "Bad-Code" : "stub",
    capabilities: {
      currencies: breaks.noCurrencies ? [] : ["UAH"],
      partialRefunds: true,
      multipleRefunds: true,
      invalidateUnpaid: true,
      webhooks: true,
    },
    async createPayment(input, abort) {
      if (abort.aborted && !breaks.ignoresAbort) {
        return paymentProviderFailure("not_sent");
      }
      const id = `inv_${String(next++)}`;
      invoices.set(id, {
        id,
        reference: breaks.wrongReference ? OTHER_PAYMENT_ID : input.paymentId,
        amount: input.amount,
        status: "created",
        refunds: [],
      });
      return paymentProviderOk({
        providerPaymentId: id,
        redirectUrl: breaks.httpRedirect ? `http://pay.example/${id}` : `https://pay.example/${id}`,
      });
    },
    async getPayment(id, abort) {
      if (abort.aborted) {
        throw new Error("aborted");
      }
      const invoice = invoices.get(id);
      if (invoice === undefined) {
        return breaks.unknownIsOk
          ? paymentProviderOk(toFact({ ...(invoices.get("paid_1") as Invoice), id }))
          : paymentProviderFailure("not_found", { providerCodes: ["404"] });
      }
      return paymentProviderOk(toFact(invoice));
    },
    async invalidatePayment(id, abort) {
      if (abort.aborted) {
        return paymentProviderFailure("not_sent");
      }
      return invoices.has(id)
        ? paymentProviderOk({ invalidated: true })
        : paymentProviderFailure("not_found");
    },
    async refund(input, abort) {
      if (abort.aborted) {
        return paymentProviderFailure("not_sent");
      }
      const invoice = invoices.get(input.providerPaymentId);
      if (invoice === undefined || invoice.status !== "succeeded") {
        return paymentProviderFailure("not_cancellable", {
          providerCodes: ["CANCEL_NOT_AVAILABLE"],
        });
      }
      invoice.refunds.push({ refundId: input.refundId, amount: input.amount, status: "succeeded" });
      if (breaks.textCodes) {
        return {
          ok: false,
          reason: "rejected",
          providerCodes: ["The refund was declined"],
        } as never;
      }
      return paymentProviderOk({ status: "succeeded" as const });
    },
    async verifyWebhook(input, abort) {
      if (abort.aborted) {
        return paymentProviderFailure("not_sent");
      }
      if (!breaks.acceptsAnySignature && input.headers["x-sign"] !== checksum(input.rawBody)) {
        return paymentProviderFailure("invalid_signature");
      }
      const id = decode(input.rawBody);
      const invoice = invoices.get(id);
      return invoice === undefined
        ? paymentProviderFailure("not_found")
        : paymentProviderOk(toFact(invoice));
    },
  };
}

const create: CreatePaymentInput = {
  paymentId: PAYMENT_ID,
  orderNumber: "7K3M-9QX2",
  amount: uah(125_000),
  description: "Order 7K3M-9QX2",
  lines: [
    { name: "Чашка", quantity: 1, unitAmount: uah(125_000), total: uah(125_000), code: "CUP-1" },
  ],
  returnUrl: "https://shop.example/uk/payment/return?payment=x",
  webhookUrl: "https://shop.example/webhooks/payments/stub",
  expiresAt: new Date("2026-10-26T10:27:00.000Z"),
};

const scenario: PaymentProviderContractScenario = {
  create,
  succeededPayment: {
    providerPaymentId: "paid_1",
    reference: OTHER_PAYMENT_ID,
    amount: uah(10_000),
  },
  unknownProviderPaymentId: "inv_999",
  webhookFor: (providerPaymentId): PaymentWebhookInput => {
    const rawBody = encode(providerPaymentId);
    return { headers: { "x-sign": checksum(rawBody) }, rawBody };
  },
  liveSignal: () => signal(false),
  abortedSignal: () => signal(true),
};

describe("checkPaymentProviderContract", () => {
  it("finds nothing wrong with a provider that keeps every rule", async () => {
    expect(await checkPaymentProviderContract(stubProvider(), scenario)).toEqual([]);
  });

  it("reports each broken rule", async () => {
    const cases: [string, string][] = [
      ["badCode", "code breaks PAYMENT_PROVIDER_CODE_PATTERN"],
      [
        "noCurrencies",
        "capabilities.currencies is not a non-empty list of distinct supported currencies",
      ],
      ["httpRedirect", "createPayment answered a redirectUrl that is not an https URL"],
      [
        "wrongReference",
        "getPayment answered a fact that does not bind to the created payment (reference_mismatch)",
      ],
      ["unknownIsOk", "getPayment did not answer not_found for an unknown payment"],
      ["acceptsAnySignature", "verifyWebhook accepted a body that was changed after signing"],
      [
        "forgetsRefundId",
        "getPayment does not list the refund under its refundId (lost refund answers cannot be settled)",
      ],
      ["textCodes", "refund did not answer a PaymentProviderResult with codes, not text"],
      ["ignoresAbort", "createPayment succeeded with an aborted signal"],
    ];
    for (const [rule, violation] of cases) {
      const found = await checkPaymentProviderContract(stubProvider({ [rule]: true }), scenario);
      expect(found, rule).toContain(violation);
    }
  });

  it("reports a provider that throws instead of answering", async () => {
    const provider = stubProvider();
    provider.createPayment = () => Promise.reject(new TypeError("boom"));
    expect(await checkPaymentProviderContract(provider, scenario)).toContain(
      "createPayment threw (TypeError)",
    );
  });

  it("reports a scenario whose amount is in a currency the provider does not take", async () => {
    const found = await checkPaymentProviderContract(stubProvider(), {
      ...scenario,
      create: { ...create, amount: { amount: 1, currency: "USD" } },
    });
    expect(found).toContain(
      "the scenario's create amount is not in a currency the provider takes (fix the scenario)",
    );
  });
});
