import type { CreatePaymentInput, ProviderAbortSignal } from "@fluxkit/core";
import { LiqPayHttp } from "../http.js";
import { LiqPayPaymentProvider, type LiqPayLogger } from "../liqpay-provider.js";
import { STUB_PRIVATE_KEY, STUB_PUBLIC_KEY, type StubLiqPay } from "./stub-liqpay.js";

export const PAYMENT_ID = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
export const REFUND_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

export const NOW = new Date("2026-11-18T10:00:00.000Z");
export const EXPIRES_AT = new Date("2026-11-18T10:27:00.000Z");

const HANDOFF_URL = `https://shop.example/uk/payment/handoff?payment=${PAYMENT_ID}`;

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
    webhookUrl: "https://shop.example/webhooks/payments/liqpay",
    handoffUrl: HANDOFF_URL,
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

export class RecordingLogger implements LiqPayLogger {
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
  stub: StubLiqPay,
  options: { clock?: TestClock } = {},
): { provider: LiqPayPaymentProvider; logger: RecordingLogger; clock: TestClock } {
  const logger = new RecordingLogger();
  const clock = options.clock ?? new TestClock();
  const http = new LiqPayHttp({
    publicKey: STUB_PUBLIC_KEY,
    privateKey: STUB_PRIVATE_KEY,
    origin: stub.origin,
  });
  return { provider: new LiqPayPaymentProvider(http, logger, clock.now), logger, clock };
}

export async function createdPayment(
  provider: LiqPayPaymentProvider,
  stub: StubLiqPay,
  overrides: Partial<CreatePaymentInput> = {},
): Promise<string> {
  const input = createInput(overrides);
  const result = await provider.createPayment(input, live());
  if (!result.ok) {
    throw new Error(
      `expected a created payment, got ${result.reason} ${result.providerCodes.join(",")}`,
    );
  }
  stub.register(input.paymentId, input.amount.amount);
  return result.value.providerPaymentId;
}