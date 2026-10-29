import type { CreatePaymentInput, ProviderAbortSignal } from "@fluxkit/core";
import { MonobankHttp } from "../http.js";
import { MonobankPaymentProvider, type MonobankLogger } from "../monobank-provider.js";
import { STUB_TOKEN, type StubMonobank } from "./stub-monobank.js";

/*
 * TEST ONLY. Invented inputs and helpers shared by the specs. No real shop, person, card or token.
 */

export const PAYMENT_ID = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
export const REFUND_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

/** The fixed "now" of the specs; the invoice ends 27 minutes later (an order TTL of 30 minutes less the 3-minute margin). */
export const NOW = new Date("2026-10-29T10:00:00.000Z");
export const EXPIRES_AT = new Date("2026-10-29T10:27:00.000Z");

export function createInput(overrides: Partial<CreatePaymentInput> = {}): CreatePaymentInput {
  return {
    paymentId: PAYMENT_ID,
    orderNumber: "7K3M-9QX2",
    amount: { amount: 125_000, currency: "UAH" },
    description: "Замовлення 7K3M-9QX2",
    lines: [
      {
        name: "Вигаданий товар",
        quantity: 2,
        unitAmount: { amount: 50_000, currency: "UAH" },
        total: { amount: 100_000, currency: "UAH" },
        code: "SKU-DEMO-1",
      },
      {
        name: "Доставка",
        quantity: 1,
        unitAmount: { amount: 25_000, currency: "UAH" },
        total: { amount: 25_000, currency: "UAH" },
        code: "nova_post_branch",
      },
    ],
    returnUrl: `https://shop.example/uk/payment/return?payment=${PAYMENT_ID}`,
    webhookUrl: "https://shop.example/webhooks/payments/monobank",
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

export function live(): ProviderAbortSignal {
  return new AbortController().signal;
}

export function aborted(): ProviderAbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

export class RecordingLogger implements MonobankLogger {
  readonly lines: string[] = [];
  readonly errors: string[] = [];

  warn(message: string): void {
    this.lines.push(message);
  }

  error(message: string): void {
    this.lines.push(message);
    this.errors.push(message);
  }
}

/** A mutable clock the specs move (the key refetch interval and the invoice validity read it). */
export class TestClock {
  private ms: number;

  constructor(start: Date = NOW) {
    this.ms = start.getTime();
  }

  readonly now = (): Date => new Date(this.ms);

  advance(ms: number): void {
    this.ms += ms;
  }
}

export function providerOn(
  stub: StubMonobank,
  options: { token?: string; clock?: TestClock } = {},
): { provider: MonobankPaymentProvider; logger: RecordingLogger; clock: TestClock } {
  const logger = new RecordingLogger();
  const clock = options.clock ?? new TestClock();
  const http = new MonobankHttp({ token: options.token ?? STUB_TOKEN, origin: stub.origin });
  return { provider: new MonobankPaymentProvider(http, logger, clock.now), logger, clock };
}

/** Creates an invoice through the provider and answers its id (fails the spec otherwise). */
export async function createdInvoice(
  provider: MonobankPaymentProvider,
  overrides: Partial<CreatePaymentInput> = {},
): Promise<string> {
  const result = await provider.createPayment(createInput(overrides), live());
  if (!result.ok) {
    throw new Error(
      `expected a created invoice, got ${result.reason} ${result.providerCodes.join(",")}`,
    );
  }
  return result.value.providerPaymentId;
}
