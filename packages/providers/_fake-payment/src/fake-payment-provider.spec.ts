import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkPaymentProviderContract,
  PAYMENT_PROVIDER_METADATA,
  type CreatePaymentInput,
  type PaymentProviderFailure,
  type PaymentProviderResult,
  type PaymentWebhookInput,
  type ProviderPaymentFact,
} from "@fluxkit/core";
import {
  FAKE_PAYMENT_PAGE_ORIGIN,
  FAKE_PAYMENT_PROVIDER_CODE,
  FAKE_PAYMENT_SIGNATURE_HEADER,
  FakePaymentProvider,
  fakeWebhookInput,
  parseAdoptWebhooks,
  providerModule,
  signFakeWebhook,
} from "./index.js";

const PAYMENT_ID = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const OTHER_PAYMENT_ID = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const REFUND_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SECOND_REFUND_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

function createInput(overrides: Partial<CreatePaymentInput> = {}): CreatePaymentInput {
  return {
    paymentId: PAYMENT_ID,
    orderNumber: "FX-100001",
    amount: { amount: 125_000, currency: "UAH" },
    description: "Order FX-100001",
    lines: [],
    returnUrl: "http://localhost:3001/uk/payment/return?payment=x",
    webhookUrl: "http://localhost:3001/webhooks/payments/fake",
    expiresAt: new Date("2026-10-26T12:00:00.000Z"),
    ...overrides,
  };
}

function live() {
  return new AbortController().signal;
}

function aborted() {
  const controller = new AbortController();
  controller.abort(new Error("timeout"));
  return controller.signal;
}

function failureOf<T>(result: PaymentProviderResult<T>): PaymentProviderFailure {
  if (result.ok) {
    throw new Error("expected a failure");
  }
  return result;
}

function valueOf<T>(result: PaymentProviderResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.reason}`);
  }
  return result.value;
}

describe("FakePaymentProvider", () => {
  let fake: FakePaymentProvider;

  /** Creates an invoice for `paymentId` and answers its provider id. */
  async function create(paymentId = PAYMENT_ID, overrides: Partial<CreatePaymentInput> = {}) {
    return valueOf(await fake.createPayment(createInput({ paymentId, ...overrides }), live()))
      .providerPaymentId;
  }

  beforeEach(() => {
    fake = new FakePaymentProvider();
  });

  it("is a Nest provider marked for discovery with code fake", async () => {
    expect(Reflect.getMetadata(PAYMENT_PROVIDER_METADATA, FakePaymentProvider)).toEqual({
      code: "fake",
    });
    const moduleRef = await Test.createTestingModule({ imports: [providerModule] }).compile();
    const instance = moduleRef.get(FakePaymentProvider);
    expect(instance.code).toBe(FAKE_PAYMENT_PROVIDER_CODE);
    expect(instance.capabilities).toMatchObject({
      partialRefunds: true,
      multipleRefunds: true,
      invalidateUnpaid: true,
      webhooks: true,
    });
    expect(instance.capabilities.currencies).toContain("UAH");
  });

  it("keeps the core payment provider contract", async () => {
    // A payment the service reports as paid, to refund (the suite creates its own to read, sign and invalidate).
    const paidId = await create(OTHER_PAYMENT_ID);
    fake.complete(paidId);
    const violations = await checkPaymentProviderContract(fake, {
      create: createInput(),
      succeededPayment: {
        providerPaymentId: paidId,
        reference: OTHER_PAYMENT_ID,
        amount: { amount: 125_000, currency: "UAH" },
      },
      unknownProviderPaymentId: "fake-pay-999999",
      webhookFor: (providerPaymentId) => fake.webhookFor(providerPaymentId),
      liveSignal: live,
      abortedSignal: aborted,
    });
    expect(violations).toEqual([]);
  });

  describe("creating and reading", () => {
    it("answers a numbered id and an https page on a reserved host, and keeps the invoice", async () => {
      const first = valueOf(await fake.createPayment(createInput(), live()));
      expect(first).toEqual({
        providerPaymentId: "fake-pay-000001",
        redirectUrl: `${FAKE_PAYMENT_PAGE_ORIGIN}/pay/fake-pay-000001`,
      });
      const second = valueOf(
        await fake.createPayment(createInput({ paymentId: OTHER_PAYMENT_ID }), live()),
      );
      expect(second.providerPaymentId).toBe("fake-pay-000002");
      expect(fake.invoice("fake-pay-000001")).toMatchObject({
        reference: PAYMENT_ID,
        orderNumber: "FX-100001",
        status: "created",
        providerStatus: "created",
        finalAmount: null,
        amount: { amount: 125_000, currency: "UAH" },
        returnUrl: "http://localhost:3001/uk/payment/return?payment=x",
      });
      expect(fake.invoices().map((invoice) => invoice.providerPaymentId)).toEqual([
        "fake-pay-000001",
        "fake-pay-000002",
      ]);
    });

    it("is NOT idempotent on create, like Monobank (M5): the same payment id makes a second invoice", async () => {
      const one = await create();
      const two = await create();
      expect(two).not.toBe(one);
      expect(fake.invoices()).toHaveLength(2);
    });

    it("reads a created payment as a well-formed fact with our reference", async () => {
      const id = await create();
      const fact = valueOf(await fake.getPayment(id, live()));
      expect(fact).toMatchObject({
        providerPaymentId: id,
        reference: PAYMENT_ID,
        status: "created",
        providerStatus: "created",
        amount: { amount: 125_000, currency: "UAH" },
        finalAmount: null,
        failureCode: null,
        refunds: [],
        card: null,
      });
    });

    it("answers not_found for an unknown id and not_sent for a malformed one", async () => {
      expect(failureOf(await fake.getPayment("fake-pay-000009", live()))).toMatchObject({
        reason: "not_found",
        providerCodes: ["unknown_payment"],
      });
      expect(failureOf(await fake.getPayment("bad id", live())).reason).toBe("not_sent");
    });

    it("answers not_sent and records no request for an aborted signal or an invalid create", async () => {
      expect(failureOf(await fake.createPayment(createInput(), aborted())).reason).toBe("not_sent");
      expect(
        failureOf(
          await fake.createPayment(createInput({ amount: { amount: 0, currency: "UAH" } }), live()),
        ).reason,
      ).toBe("not_sent");
      expect(
        failureOf(
          await fake.createPayment(
            createInput({ amount: { amount: 100, currency: "ZZZ" as never } }),
            live(),
          ),
        ).reason,
      ).toBe("not_sent");
      expect(
        failureOf(await fake.createPayment(createInput({ description: "x".repeat(281) }), live()))
          .reason,
      ).toBe("not_sent");
      expect(fake.requests()).toEqual([]);
      expect(fake.invoices()).toEqual([]);
    });

    it("records every call that passed local validation", async () => {
      const id = await create();
      await fake.getPayment(id, live());
      await fake.getPayment("fake-pay-000009", live());
      expect(fake.requests()).toEqual([
        { operation: "createPayment", paymentId: PAYMENT_ID },
        { operation: "getPayment", providerPaymentId: id },
        { operation: "getPayment", providerPaymentId: "fake-pay-000009" },
      ]);
    });
  });

  describe("status transitions", () => {
    it("moves modifiedAt forward on every change, so the greater one is current (M10)", async () => {
      const id = await create();
      const created = fake.invoice(id)?.modifiedAt as Date;
      fake.process(id);
      const processing = fake.invoice(id)?.modifiedAt as Date;
      fake.complete(id);
      const succeeded = fake.invoice(id)?.modifiedAt as Date;
      expect(processing.getTime()).toBeGreaterThan(created.getTime());
      expect(succeeded.getTime()).toBeGreaterThan(processing.getTime());
    });

    it("complete: succeeded, final amount equals the amount, a card system and last four digits", async () => {
      const id = await create();
      fake.complete(id);
      const fact = valueOf(await fake.getPayment(id, live()));
      expect(fact).toMatchObject({
        status: "succeeded",
        providerStatus: "success",
        finalAmount: { amount: 125_000, currency: "UAH" },
        card: { system: "visa", last4: "4242" },
        failureCode: null,
      });
    });

    it("fail and expire set the status; fail carries a code, never a message", async () => {
      const failed = await create();
      fake.fail(failed, "card_declined");
      expect(valueOf(await fake.getPayment(failed, live()))).toMatchObject({
        status: "failed",
        providerStatus: "failure",
        failureCode: "card_declined",
      });
      const expired = await create(OTHER_PAYMENT_ID);
      fake.expire(expired);
      expect(valueOf(await fake.getPayment(expired, live()))).toMatchObject({
        status: "expired",
        providerStatus: "expired",
      });
    });

    it("refuses a transition the real service would not make", async () => {
      const id = await create();
      fake.complete(id);
      expect(() => fake.fail(id)).toThrow(RangeError);
      expect(() => fake.expire(id)).toThrow(RangeError);
      expect(() => fake.process(id)).toThrow(RangeError);
      expect(() => fake.complete("fake-pay-000009")).toThrow(/unknown invoice/);
      const other = await create(OTHER_PAYMENT_ID);
      expect(() => fake.reverse(other)).toThrow(RangeError);
    });

    it("reverse: a succeeded payment becomes reversed", async () => {
      const id = await create();
      fake.complete(id);
      fake.reverse(id);
      expect(valueOf(await fake.getPayment(id, live()))).toMatchObject({
        status: "reversed",
        providerStatus: "reversed",
      });
    });
  });

  describe("invalidating", () => {
    it("invalidates an unpaid invoice, which then reads as expired; repeating it is fine", async () => {
      const id = await create();
      expect(valueOf(await fake.invalidatePayment(id, live()))).toEqual({ invalidated: true });
      expect(fake.invoice(id)?.status).toBe("expired");
      expect(valueOf(await fake.invalidatePayment(id, live()))).toEqual({ invalidated: true });
    });

    it("cannot invalidate a paid or an in-progress invoice (not_cancellable, codes only)", async () => {
      const paid = await create();
      fake.complete(paid);
      expect(failureOf(await fake.invalidatePayment(paid, live()))).toMatchObject({
        reason: "not_cancellable",
        providerCodes: ["already_paid"],
      });
      const busy = await create(OTHER_PAYMENT_ID);
      fake.process(busy);
      expect(failureOf(await fake.invalidatePayment(busy, live()))).toMatchObject({
        reason: "not_cancellable",
        providerCodes: ["in_progress"],
      });
    });

    it("answers invalidated false for a failed invoice and not_found for an unknown one", async () => {
      const id = await create();
      fake.fail(id);
      expect(valueOf(await fake.invalidatePayment(id, live()))).toEqual({ invalidated: false });
      expect(failureOf(await fake.invalidatePayment("fake-pay-000009", live())).reason).toBe(
        "not_found",
      );
    });
  });

  describe("refunds", () => {
    async function paid() {
      const id = await create();
      fake.complete(id);
      return id;
    }
    const money = (amount: number) => ({ amount, currency: "UAH" as const });

    it("a full refund succeeds and is listed under its refund id with the final amount lowered", async () => {
      const id = await paid();
      expect(
        valueOf(
          await fake.refund(
            { providerPaymentId: id, refundId: REFUND_ID, amount: money(125_000), full: true },
            live(),
          ),
        ),
      ).toEqual({ status: "succeeded" });
      const fact = valueOf(await fake.getPayment(id, live()));
      expect(fact.refunds).toEqual([
        {
          refundId: REFUND_ID,
          status: "succeeded",
          amount: money(125_000),
          modifiedAt: expect.any(Date),
        },
      ]);
      expect(fact.finalAmount).toEqual(money(0));
      expect(fact.status).toBe("succeeded");
    });

    it("takes several partial refunds up to the amount and refuses more", async () => {
      const id = await paid();
      await fake.refund(
        { providerPaymentId: id, refundId: REFUND_ID, amount: money(25_000), full: false },
        live(),
      );
      await fake.refund(
        { providerPaymentId: id, refundId: SECOND_REFUND_ID, amount: money(100_000), full: false },
        live(),
      );
      expect(valueOf(await fake.getPayment(id, live())).refunds).toHaveLength(2);
      const over = failureOf(
        await fake.refund(
          {
            providerPaymentId: id,
            refundId: "cccccccc-dddd-4eee-8fff-000000000000",
            amount: money(1),
            full: false,
          },
          live(),
        ),
      );
      expect(over).toMatchObject({
        reason: "not_cancellable",
        providerCodes: ["refund_exceeds_remaining"],
      });
    });

    it("a full refund after a partial one is refused", async () => {
      const id = await paid();
      await fake.refund(
        { providerPaymentId: id, refundId: REFUND_ID, amount: money(1), full: false },
        live(),
      );
      expect(
        failureOf(
          await fake.refund(
            {
              providerPaymentId: id,
              refundId: SECOND_REFUND_ID,
              amount: money(125_000),
              full: true,
            },
            live(),
          ),
        ).providerCodes,
      ).toEqual(["refund_exceeds_remaining"]);
    });

    it("is deduplicated by our refund id: a replay changes nothing, another amount is refused", async () => {
      const id = await paid();
      const request = {
        providerPaymentId: id,
        refundId: REFUND_ID,
        amount: money(500),
        full: false,
      };
      await fake.refund(request, live());
      expect(valueOf(await fake.refund(request, live()))).toEqual({ status: "succeeded" });
      expect(fake.invoice(id)?.refunds).toHaveLength(1);
      expect(
        failureOf(await fake.refund({ ...request, amount: money(600) }, live())),
      ).toMatchObject({ reason: "rejected", providerCodes: ["extref_reused"] });
    });

    it("refuses an unpaid payment, another currency and an unknown payment", async () => {
      const unpaid = await create(OTHER_PAYMENT_ID);
      expect(
        failureOf(
          await fake.refund(
            { providerPaymentId: unpaid, refundId: REFUND_ID, amount: money(1), full: false },
            live(),
          ),
        ).providerCodes,
      ).toEqual(["not_paid"]);
      const id = await paid();
      expect(
        failureOf(
          await fake.refund(
            {
              providerPaymentId: id,
              refundId: REFUND_ID,
              amount: { amount: 1, currency: "USD" },
              full: false,
            },
            live(),
          ),
        ).providerCodes,
      ).toEqual(["currency_mismatch"]);
      expect(
        failureOf(
          await fake.refund(
            {
              providerPaymentId: "fake-pay-000009",
              refundId: REFUND_ID,
              amount: money(1),
              full: false,
            },
            live(),
          ),
        ).reason,
      ).toBe("not_found");
    });

    it("processing mode keeps a new refund processing until settled; a failed one frees the amount", async () => {
      const id = await paid();
      fake.setRefundMode("processing");
      expect(
        valueOf(
          await fake.refund(
            { providerPaymentId: id, refundId: REFUND_ID, amount: money(125_000), full: true },
            live(),
          ),
        ),
      ).toEqual({ status: "processing" });
      expect(valueOf(await fake.getPayment(id, live())).finalAmount).toEqual(money(125_000));
      fake.settleRefund(id, REFUND_ID, "failed");
      const fact = valueOf(await fake.getPayment(id, live()));
      expect(fact.refunds[0]?.status).toBe("failed");
      expect(fact.finalAmount).toEqual(money(125_000));
      expect(() => fake.settleRefund(id, REFUND_ID, "succeeded")).toThrow(RangeError);
    });

    it("lists a refund made outside the shop with a null refund id", async () => {
      const id = await paid();
      fake.addExternalRefund(id, money(1_000));
      const fact = valueOf(await fake.getPayment(id, live()));
      expect(fact.refunds).toMatchObject([{ refundId: null, status: "succeeded" }]);
      expect(fact.finalAmount).toEqual(money(124_000));
    });
  });

  describe("webhooks", () => {
    it("signs the exact body with an HMAC and verifies it back into the same fact as getPayment", async () => {
      const id = await create();
      fake.complete(id);
      const input = fake.webhookFor(id);
      expect(input.headers[FAKE_PAYMENT_SIGNATURE_HEADER]).toBe(signFakeWebhook(input.rawBody));
      expect(input.headers[FAKE_PAYMENT_SIGNATURE_HEADER]).toMatch(/^[0-9a-f]{64}$/);
      const fromWebhook = valueOf(await fake.verifyWebhook(input, live()));
      const fromRead = valueOf(await fake.getPayment(id, live()));
      expect(fromWebhook).toEqual(fromRead);
    });

    it("carries refunds and a failure code through the webhook", async () => {
      const id = await create();
      fake.complete(id);
      await fake.refund(
        {
          providerPaymentId: id,
          refundId: REFUND_ID,
          amount: { amount: 10, currency: "UAH" },
          full: false,
        },
        live(),
      );
      const failed = await create(OTHER_PAYMENT_ID);
      fake.fail(failed, "card_declined");
      expect(valueOf(await fake.verifyWebhook(fake.webhookFor(id), live())).refunds).toHaveLength(
        1,
      );
      expect(valueOf(await fake.verifyWebhook(fake.webhookFor(failed), live()))).toMatchObject({
        status: "failed",
        failureCode: "card_declined",
      });
    });

    it("refuses a body changed after signing, a missing, wrong or malformed signature", async () => {
      const id = await create();
      const input = fake.webhookFor(id);
      const changed = Uint8Array.from(input.rawBody);
      changed[changed.length - 1] = (changed[changed.length - 1] as number) ^ 1;
      const candidates: PaymentWebhookInput[] = [
        { headers: input.headers, rawBody: changed },
        { headers: {}, rawBody: input.rawBody },
        { headers: { [FAKE_PAYMENT_SIGNATURE_HEADER]: "0".repeat(64) }, rawBody: input.rawBody },
        { headers: { [FAKE_PAYMENT_SIGNATURE_HEADER]: "not hex" }, rawBody: input.rawBody },
        {
          headers: {
            [FAKE_PAYMENT_SIGNATURE_HEADER]: signFakeWebhook(input.rawBody).toUpperCase(),
          },
          rawBody: input.rawBody,
        },
      ];
      for (const candidate of candidates) {
        expect(failureOf(await fake.verifyWebhook(candidate, live()))).toMatchObject({
          reason: "invalid_signature",
          providerCodes: ["bad_signature"],
        });
      }
    });

    it("refuses a correctly signed body that is not the fake's shape, and an oversized one", async () => {
      for (const body of ["not json", "[]", '{"invoiceId":1}', '{"status":"success"}']) {
        expect(failureOf(await fake.verifyWebhook(fakeWebhookInput(body), live()))).toMatchObject({
          reason: "rejected",
          providerCodes: ["malformed_body"],
        });
      }
      expect(
        failureOf(await fake.verifyWebhook(fakeWebhookInput(new Uint8Array(64 * 1024 + 1)), live()))
          .providerCodes,
      ).toEqual(["body_too_large"]);
    });

    it("keeps an unknown raw status as a null status with the word kept (core raises attention)", async () => {
      const id = await create();
      const body = JSON.parse(new TextDecoder().decode(fake.webhookFor(id).rawBody)) as Record<
        string,
        unknown
      >;
      const fact = valueOf(
        await fake.verifyWebhook(
          fakeWebhookInput(JSON.stringify({ ...body, status: "teapot" })),
          live(),
        ),
      );
      expect(fact).toMatchObject({ status: null, providerStatus: "teapot" });
    });

    it("builds a webhook for an expired invoice although the real service sends none (M8)", async () => {
      const id = await create();
      fake.expire(id);
      const fact: ProviderPaymentFact = valueOf(
        await fake.verifyWebhook(fake.webhookFor(id), live()),
      );
      expect(fact.status).toBe("expired");
      expect(() => fake.webhookFor("fake-pay-000009")).toThrow(RangeError);
    });
  });

  describe("failure hooks", () => {
    it.each(["rate_limited", "unavailable", "rejected", "misconfigured", "not_sent"] as const)(
      "failNext reason %s fails the next create with codes only and no effect",
      async (reason) => {
        fake.failNext({ reason, providerCodes: ["some_code"], retryAfterSeconds: 7 });
        const result = failureOf(await fake.createPayment(createInput(), live()));
        expect(result).toMatchObject({
          reason,
          providerCodes: ["some_code"],
          retryAfterSeconds: 7,
        });
        expect(fake.invoices()).toEqual([]);
        // Only one call was planned: the next one works.
        expect((await fake.createPayment(createInput(), live())).ok).toBe(true);
      },
    );

    it("afterEffect: the invoice IS created but the answer is lost (create_unknown), and a repeat makes a second one", async () => {
      fake.failNext({ afterEffect: true });
      expect(failureOf(await fake.createPayment(createInput(), live())).reason).toBe("unavailable");
      expect(fake.invoices()).toHaveLength(1);
      expect(fake.invoices()[0]?.reference).toBe(PAYMENT_ID);
      await fake.createPayment(createInput(), live());
      expect(fake.invoices()).toHaveLength(2);
    });

    it("afterEffect on a refund: the refund is recorded, the answer lost, and the refund id replays safely", async () => {
      const id = await create();
      fake.complete(id);
      const request = {
        providerPaymentId: id,
        refundId: REFUND_ID,
        amount: { amount: 125_000, currency: "UAH" as const },
        full: true,
      };
      fake.failNext({ operation: "refund", afterEffect: true });
      expect(failureOf(await fake.refund(request, live())).reason).toBe("unavailable");
      expect(fake.invoice(id)?.refunds).toHaveLength(1);
      expect(valueOf(await fake.refund(request, live()))).toEqual({ status: "succeeded" });
      expect(fake.invoice(id)?.refunds).toHaveLength(1);
    });

    it("an operation filter leaves other calls alone and is consumed by the first match", async () => {
      const id = await create();
      fake.failNext({ operation: "getPayment", reason: "rate_limited", times: 2 });
      expect((await fake.invalidatePayment(id, live())).ok).toBe(true);
      expect(failureOf(await fake.getPayment(id, live())).reason).toBe("rate_limited");
      expect(failureOf(await fake.getPayment(id, live())).reason).toBe("rate_limited");
      expect((await fake.getPayment(id, live())).ok).toBe(true);
    });

    it("without an operation a failure does not touch verifyWebhook, with one it does", async () => {
      const id = await create();
      fake.failNext({});
      expect((await fake.verifyWebhook(fake.webhookFor(id), live())).ok).toBe(true);
      expect(failureOf(await fake.getPayment(id, live())).reason).toBe("unavailable");
      fake.failNext({ operation: "verifyWebhook", reason: "unavailable" });
      expect(failureOf(await fake.verifyWebhook(fake.webhookFor(id), live())).reason).toBe(
        "unavailable",
      );
    });

    it("hang never answers until the signal fires, then rejects with its reason", async () => {
      fake.failNext({ hang: true });
      const controller = new AbortController();
      const pending = fake.createPayment(createInput(), controller.signal);
      let settled = false;
      void pending.then(
        () => (settled = true),
        () => (settled = true),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(settled).toBe(false);
      const reason = new Error("timeout");
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
      expect(fake.invoices()).toEqual([]);
    });

    it("throws rejects with a plain error that carries no data", async () => {
      fake.failNext({ throws: true });
      await expect(fake.createPayment(createInput(), live())).rejects.toThrow(
        "fake payment provider failure",
      );
    });

    it("refuses a bad description at once", () => {
      expect(() => fake.failNext({ times: 0 })).toThrow(RangeError);
      expect(() => fake.failNext({ reason: "boom" as never })).toThrow(RangeError);
      expect(() => fake.failNext({ operation: "nope" as never })).toThrow(RangeError);
      expect(() => fake.failNext({ providerCodes: ["a message with spaces"] })).toThrow(RangeError);
      expect(() => fake.failNext({ retryAfterSeconds: -1 })).toThrow(RangeError);
    });

    it("never puts a message text, an address or an amount into a failure", async () => {
      fake.failNext({ reason: "rejected", providerCodes: ["validation_error"] });
      const result = failureOf(await fake.createPayment(createInput(), live()));
      expect(JSON.stringify(result)).not.toMatch(/FX-100001|125000|localhost/);
    });
  });

  it("reset forgets invoices, requests and plans; numbering and the clock restart", async () => {
    const id = await create();
    const first = fake.invoice(id)?.modifiedAt;
    fake.failNext({});
    fake.setRefundMode("processing");
    fake.reset();
    expect(fake.invoices()).toEqual([]);
    expect(fake.requests()).toEqual([]);
    expect((await fake.createPayment(createInput(), live())).ok).toBe(true);
    expect(fake.invoices()[0]?.providerPaymentId).toBe("fake-pay-000001");
    expect(fake.invoices()[0]?.modifiedAt).toEqual(first);
    fake.complete("fake-pay-000001");
    expect(
      valueOf(
        await fake.refund(
          {
            providerPaymentId: "fake-pay-000001",
            refundId: REFUND_ID,
            amount: { amount: 1, currency: "UAH" },
            full: false,
          },
          live(),
        ),
      ),
    ).toEqual({ status: "succeeded" });
  });

  it("takes an injected clock for modifiedAt", async () => {
    const instant = new Date("2026-10-26T10:00:00.000Z");
    const clocked = new FakePaymentProvider({ clock: () => instant });
    const created = valueOf(await clocked.createPayment(createInput(), live()));
    expect(clocked.invoice(created.providerPaymentId)?.modifiedAt).toEqual(instant);
  });

  it("returns copies: changing an answer changes nothing in the fake", async () => {
    const id = await create();
    const copy = fake.invoice(id);
    (copy?.amount as { amount: number }).amount = 1;
    expect(fake.invoice(id)?.amount.amount).toBe(125_000);
  });
  describe("adopting verified webhooks (a second process, FAKE_PAYMENT_ADOPT_WEBHOOKS)", () => {
    const LATER = "2026-10-29T10:00:00.000Z";
    const money = (amount: number) => ({ amount, currency: "UAH" as const });

    /** What the provider would POST for an invoice that the test process cannot reach (the API is another process). */
    function signedBody(id: string, changes: Record<string, unknown>) {
      const body = JSON.parse(new TextDecoder().decode(fake.webhookFor(id).rawBody)) as Record<
        string,
        unknown
      >;
      return fakeWebhookInput(JSON.stringify({ ...body, ...changes }));
    }

    const paid = { status: "success", finalAmount: 125_000, modifiedDate: LATER };

    it("keeps its own state when the option is off (the default): a verified webhook is only read", async () => {
      const id = await create();
      expect((await fake.verifyWebhook(signedBody(id, paid), live())).ok).toBe(true);
      expect(fake.invoice(id)?.status).toBe("created");
    });

    describe("with the option on", () => {
      beforeEach(() => {
        fake = new FakePaymentProvider({ adoptVerifiedWebhooks: true });
      });

      it("follows a signed success: getPayment then says success and refunds work in order, after the webhook's time", async () => {
        const id = await create();
        valueOf(await fake.verifyWebhook(signedBody(id, paid), live()));
        expect(fake.invoice(id)).toMatchObject({
          status: "succeeded",
          finalAmount: money(125_000),
        });
        const read = valueOf(await fake.getPayment(id, live()));
        expect(read.status).toBe("succeeded");
        expect(read.modifiedAt.toISOString()).toBe(LATER);

        valueOf(
          await fake.refund(
            { providerPaymentId: id, refundId: REFUND_ID, amount: money(25_000), full: false },
            live(),
          ),
        );
        const afterRefund = valueOf(await fake.getPayment(id, live()));
        expect(afterRefund.finalAmount).toEqual(money(100_000));
        expect(afterRefund.modifiedAt.getTime()).toBeGreaterThan(Date.parse(LATER));
      });

      it("ignores a webhook that is not about this invoice as the service knows it", async () => {
        const id = await create();
        for (const changes of [
          { ...paid, amount: 1 }, // another amount than the invoice has
          { ...paid, reference: OTHER_PAYMENT_ID },
          { ...paid, invoiceId: "fake-pay-999999" },
          { ...paid, modifiedDate: "2025-01-01T00:00:00.000Z" }, // older than the invoice
        ]) {
          expect((await fake.verifyWebhook(signedBody(id, changes), live())).ok).toBe(true);
        }
        expect(fake.invoice(id)?.status).toBe("created");
        expect(fake.invoice("fake-pay-999999")).toBeUndefined();
        expect(fake.invoices()).toHaveLength(1);
      });

      it("adopts nothing from a webhook whose signature fails", async () => {
        const id = await create();
        const input = signedBody(id, paid);
        const forged = {
          ...input,
          headers: { ...input.headers, "x-fake-signature": "0".repeat(64) },
        };
        expect(failureOf(await fake.verifyWebhook(forged, live())).reason).toBe(
          "invalid_signature",
        );
        expect(fake.invoice(id)?.status).toBe("created");
      });

      it("follows a failure with its code", async () => {
        const id = await create();
        valueOf(
          await fake.verifyWebhook(
            signedBody(id, {
              status: "failure",
              finalAmount: null,
              failureCode: "declined",
              modifiedDate: LATER,
            }),
            live(),
          ),
        );
        expect(fake.invoice(id)).toMatchObject({ status: "failed", failureCode: "declined" });
      });
    });
  });
});

describe("parseAdoptWebhooks (FAKE_PAYMENT_ADOPT_WEBHOOKS)", () => {
  it("is off when unset, empty or false, on for true, and refuses anything else without echoing it", () => {
    expect(parseAdoptWebhooks(undefined)).toBe(false);
    expect(parseAdoptWebhooks("")).toBe(false);
    expect(parseAdoptWebhooks("false")).toBe(false);
    expect(parseAdoptWebhooks("true")).toBe(true);
    expect(() => parseAdoptWebhooks("yes-please")).toThrow(/must be true or false/);
    expect(() => parseAdoptWebhooks("yes-please")).not.toThrow(/yes-please/);
  });
});
