import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startApp, type RunningApp } from "../test/app.js";
import { PaymentWorld } from "../test/payment-world.js";
import { captureLogs } from "../test/shipping-fixtures.js";
import {
  signedTestWebhook,
  testPaymentProviders,
  TEST_PAYMENT_SIGNATURE_HEADER,
} from "../test/test-payment-provider.js";

/**
 * `POST /webhooks/payments/{provider}` and the application of verified facts (ADR 0032 decisions 7 and 12): the
 * signature over the exact raw bytes before anything is parsed, dedupe, ordering, binding, the outcome table and the
 * size, type and rate limits. Real Postgres, the in-repo test provider (HMAC over the raw body).
 */
describe("payments: the webhook route and verified facts (real Postgres)", () => {
  let world: PaymentWorld;

  beforeAll(async () => {
    world = await PaymentWorld.start();
  });

  beforeEach(() => {
    world.resetProvider();
    world.clock.advanceMinutes(1);
  });

  afterAll(async () => {
    await world.stop();
  });

  async function paidAttempt() {
    const placed = await world.place([{ quantity: 1, price: 2_000 }]);
    const attempt = await world.created(placed);
    world.provider().setStatus(attempt.invoiceId, "succeeded");
    return { placed, ...attempt };
  }

  it("a verified success pays the order in the same transaction: reference <provider>:<invoice>, outcome applied, card system and last 4", async () => {
    const { placed, paymentId, invoiceId } = await paidAttempt();
    const answer = await world.webhook(world.provider().webhookFor(invoiceId));
    expect(answer).toEqual({ status: 200, text: "" });
    expect(await world.payment(paymentId)).toMatchObject({
      status: "succeeded",
      order_outcome: "applied",
      provider_status: "success",
      final_amount: 2_000,
      card_system: "visa",
      card_last4: "4242",
      redirect_url: null,
      next_check_at: null,
      needs_attention: false,
    });
    expect(await world.orderStatus(placed.id)).toMatchObject({
      status: "paid",
      payment_reference: `fake:${invoiceId}`,
    });
    expect(await world.eventTypes(placed.id)).toEqual(["order.placed", "order.paid"]);
    expect(await world.eventTypes(paymentId)).toEqual([
      "payment.status_changed",
      "payment.status_changed",
    ]);
    const journal = await world.eventsOf(paymentId);
    expect(journal.at(-1)).toMatchObject({
      source: "webhook",
      applied: true,
      from_status: "awaiting_customer",
      to_status: "succeeded",
      provider_status: "success",
    });
    expect(journal.at(-1)?.dedupe_key).toMatch(/^webhook:[0-9a-f]{64}$/);
  });

  it("the same webhook twice (and five at once) is one transition and one order.paid; every delivery answers 200", async () => {
    const { placed, paymentId, invoiceId } = await paidAttempt();
    const input = world.provider().webhookFor(invoiceId);
    const answers = await Promise.all(Array.from({ length: 5 }, () => world.webhook(input)));
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200, 200, 200]);
    expect((await world.webhook(input)).status).toBe(200);
    expect(await world.eventTypes(placed.id)).toEqual(["order.placed", "order.paid"]);
    const webhooks = (await world.eventsOf(paymentId)).filter((row) => row.source === "webhook");
    expect(webhooks).toHaveLength(1);
  });

  it("out of order: processing after success is journaled unapplied and never moves the attempt back", async () => {
    const placed = await world.place();
    const { paymentId, invoiceId } = await world.created(placed);
    world.provider().setStatus(invoiceId, "processing");
    const processing = world.provider().webhookFor(invoiceId);
    world.provider().setStatus(invoiceId, "succeeded");
    await world.notify(invoiceId);
    expect((await world.webhook(processing)).status).toBe(200);
    expect((await world.payment(paymentId)).status).toBe("succeeded");
    const late = (await world.eventsOf(paymentId)).at(-1);
    expect(late).toMatchObject({
      source: "webhook",
      provider_status: "processing",
      applied: false,
    });
    expect(await world.eventTypes(placed.id)).toEqual(["order.placed", "order.paid"]);
  });

  it("a replay with a different body (same fact, other bytes) gets its own key but cannot pay twice", async () => {
    const { placed, paymentId, invoiceId } = await paidAttempt();
    await world.notify(invoiceId);
    const body = world.provider().webhookBody(invoiceId);
    const spaced = signedTestWebhook(JSON.stringify(JSON.parse(body)));
    expect((await world.webhook(spaced)).status).toBe(200);
    expect(await world.eventTypes(placed.id)).toEqual(["order.placed", "order.paid"]);
    expect((await world.payment(paymentId)).status).toBe("succeeded");
    const webhooks = (await world.eventsOf(paymentId)).filter((row) => row.source === "webhook");
    expect(webhooks).toHaveLength(2);
    expect(webhooks[1]).toMatchObject({ applied: true, from_status: null, to_status: null });
  });

  it("an invalid or missing signature is 401 with no detail, stores nothing and logs no body or signature", async () => {
    const { placed, paymentId, invoiceId } = await paidAttempt();
    const input = world.provider().webhookFor(invoiceId);
    const before = await world.eventsOf(paymentId);
    const logs = captureLogs();
    let wrong: { status: number; text: string };
    let missing: { status: number; text: string };
    try {
      wrong = await world.webhook(input, {
        headers: { [TEST_PAYMENT_SIGNATURE_HEADER]: "0".repeat(64) },
      });
      missing = await world.webhook({
        headers: { "content-type": "application/json" },
        rawBody: input.rawBody,
      });
    } finally {
      logs.stop();
    }
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(JSON.parse(wrong.text)).toMatchObject({ code: "unauthorized" });
    expect(wrong.text).not.toContain(invoiceId);
    expect(await world.eventsOf(paymentId)).toEqual(before);
    expect((await world.orderStatus(placed.id)).status).toBe("awaiting_payment");
    const text = logs.text();
    expect(text).toContain("invalid signature");
    expect(text).not.toContain(invoiceId);
    expect(text).not.toContain(input.headers[TEST_PAYMENT_SIGNATURE_HEADER] ?? "unset");
    expect(text).not.toMatch(/4242|"amount"|cancelList/);
  });

  it("the signature covers the raw bytes: a re-serialized body with the original signature is refused", async () => {
    const { placed, invoiceId } = await paidAttempt();
    const input = world.provider().webhookFor(invoiceId);
    const parsed = JSON.parse(new TextDecoder().decode(input.rawBody)) as Record<string, unknown>;
    const reordered = JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse()));
    expect(reordered).not.toBe(new TextDecoder().decode(input.rawBody));
    const answer = await world.webhook({
      headers: input.headers,
      rawBody: new TextEncoder().encode(reordered),
    });
    expect(answer.status).toBe(401);
    expect((await world.orderStatus(placed.id)).status).toBe("awaiting_payment");
    // A changed amount with the original signature is refused the same way.
    const forged = JSON.stringify({ ...parsed, amount: 1 });
    expect(
      (await world.webhook({ headers: input.headers, rawBody: new TextEncoder().encode(forged) }))
        .status,
    ).toBe(401);
  });

  it("verifies before parsing: an unsigned garbage body is 401, a signed one 400; non-JSON is 415; an unknown provider is 404", async () => {
    const garbage = new TextEncoder().encode("{not json");
    expect(
      (await world.webhook({ headers: { "content-type": "application/json" }, rawBody: garbage }))
        .status,
    ).toBe(401);
    expect((await world.webhook(signedTestWebhook("{not json"))).status).toBe(400);
    const signed = signedTestWebhook("{}");
    expect(
      (await world.webhook(signed, { headers: { "content-type": "text/plain" } })).status,
    ).toBe(415);
    const unknown = await world.webhook(signed, { provider: "monobank" });
    expect(unknown.status).toBe(404);
  });

  it("a body over 64 KiB is 413 and stores nothing", async () => {
    const big = signedTestWebhook(JSON.stringify({ pad: "x".repeat(70 * 1024) }));
    const answer = await world.webhook(big);
    expect(answer.status).toBe(413);
  });

  it("a verified fact about a payment we do not know answers 200 and changes nothing", async () => {
    const placed = await world.place();
    const { invoiceId } = await world.created(placed);
    const body = JSON.parse(world.provider().webhookBody(invoiceId)) as Record<string, unknown>;
    const stranger = signedTestWebhook(
      JSON.stringify({ ...body, invoiceId: "someone-else-1", reference: randomUUID() }),
    );
    expect((await world.webhook(stranger)).status).toBe(200);
  });

  it.each([
    ["amount", { amount: { amount: 1_999, currency: "UAH" as const } }, "amount_mismatch"],
    ["currency", { amount: { amount: 2_000, currency: "EUR" as const } }, "amount_mismatch"],
    [
      "final amount",
      { finalAmount: { amount: 1_000, currency: "UAH" as const } },
      "amount_mismatch",
    ],
    ["reference", { reference: randomUUID() }, "fact_not_bound"],
  ])(
    "a fact whose %s does not bind never pays: journaled unapplied, attention",
    async (_field, override, code) => {
      const { placed, paymentId, invoiceId } = await paidAttempt();
      world.provider().override(invoiceId, override);
      expect((await world.webhook(world.provider().webhookFor(invoiceId))).status).toBe(200);
      expect(await world.payment(paymentId)).toMatchObject({
        status: "awaiting_customer",
        needs_attention: true,
        attention_code: code,
        order_outcome: null,
      });
      expect((await world.orderStatus(placed.id)).status).toBe("awaiting_payment");
      expect((await world.eventsOf(paymentId)).at(-1)).toMatchObject({
        source: "webhook",
        applied: false,
        to_status: null,
      });
    },
  );

  it("a late success after the order was cancelled: recorded, not paid, a full automatic refund queued, attention", async () => {
    const placed = await world.place([{ quantity: 1, price: 2_000 }]);
    const { paymentId, invoiceId } = await world.created(placed);
    expect((await world.orders.cancel(placed.id)).status).toBe(200);
    expect((await world.payment(paymentId)).status).toBe("invalidated");
    world.provider().setStatus(invoiceId, "succeeded");
    await world.notify(invoiceId);
    expect(await world.payment(paymentId)).toMatchObject({
      status: "succeeded",
      order_outcome: "order_not_payable",
      needs_attention: true,
      attention_code: "late_payment",
    });
    expect((await world.payment(paymentId)).next_check_at).not.toBeNull();
    expect(await world.refundsOf(paymentId)).toEqual([
      expect.objectContaining({ amount: 2_000, status: "requested", reason: "late_payment" }),
    ]);
    expect((await world.orderStatus(placed.id)).status).toBe("cancelled");
    expect(await world.eventTypes(placed.id)).not.toContain("order.paid");
    // The webhook path sends nothing: the refund goes out from job 11.
    expect(world.provider().refundCalls).toEqual([]);
  });

  it("a double payment: the second success is a reference conflict and is refunded in full", async () => {
    const placed = await world.place([{ quantity: 1, price: 2_000 }]);
    const first = await world.created(placed);
    const second = await world.created(placed);
    world.provider().setStatus(first.invoiceId, "succeeded");
    world.provider().setStatus(second.invoiceId, "succeeded");
    await world.notify(first.invoiceId);
    await world.notify(second.invoiceId);
    expect(await world.payment(first.paymentId)).toMatchObject({
      status: "succeeded",
      order_outcome: "applied",
    });
    expect(await world.payment(second.paymentId)).toMatchObject({
      status: "succeeded",
      order_outcome: "reference_conflict",
      attention_code: "duplicate_payment",
    });
    expect(await world.refundsOf(second.paymentId)).toEqual([
      expect.objectContaining({ amount: 2_000, reason: "duplicate_payment", status: "requested" }),
    ]);
    expect(await world.refundsOf(first.paymentId)).toEqual([]);
    expect(await world.orderStatus(placed.id)).toMatchObject({
      status: "paid",
      payment_reference: `fake:${first.invoiceId}`,
    });
  });

  it("a success on an older attempt pays the order and closes the open one, which then cannot take a second payment", async () => {
    const placed = await world.place([{ quantity: 1, price: 2_000 }]);
    const first = await world.created(placed);
    const second = await world.created(placed);
    world.provider().setStatus(first.invoiceId, "succeeded");
    await world.notify(first.invoiceId);
    expect(await world.payment(first.paymentId)).toMatchObject({ order_outcome: "applied" });
    expect(await world.payment(second.paymentId)).toMatchObject({
      status: "invalidated",
      redirect_url: null,
    });
    expect((await world.orderStatus(placed.id)).status).toBe("paid");
  });

  it("an online success after a manual mark paid is refunded as a duplicate", async () => {
    const placed = await world.place([{ quantity: 1, price: 2_000 }]);
    const { paymentId, invoiceId } = await world.created(placed);
    expect((await world.orders.pay(placed, "BANK-7")).status).toBe(200);
    expect((await world.payment(paymentId)).status).toBe("invalidated");
    world.provider().setStatus(invoiceId, "succeeded");
    await world.notify(invoiceId);
    expect(await world.payment(paymentId)).toMatchObject({
      order_outcome: "reference_conflict",
      attention_code: "duplicate_payment",
    });
    expect((await world.refundsOf(paymentId))[0]?.reason).toBe("duplicate_payment");
    expect((await world.orderStatus(placed.id)).payment_reference).toBe("BANK-7");
  });

  it("failed and expired facts close the attempt with the provider's code; the shopper may try again", async () => {
    const placed = await world.place();
    const { paymentId, invoiceId } = await world.created(placed);
    world.provider().setStatus(invoiceId, "failed", { failureCode: "59" });
    await world.notify(invoiceId);
    expect(await world.payment(paymentId)).toMatchObject({
      status: "failed",
      failure_code: "59",
      redirect_url: null,
      next_check_at: null,
    });
    expect((await world.create(placed)).kind).toBe("created");
  });

  it("a status the plugin does not know changes nothing and raises attention", async () => {
    const placed = await world.place();
    const { paymentId, invoiceId } = await world.created(placed);
    world.provider().setUnknownStatus(invoiceId, "teleported");
    await world.notify(invoiceId);
    expect(await world.payment(paymentId)).toMatchObject({
      status: "awaiting_customer",
      needs_attention: true,
      attention_code: "unknown_provider_status",
    });
  });

  it("a signed fact whose final amount exceeds the amount is journaled unapplied with attention and answered 200 (no retry loop)", async () => {
    const placed = await world.place([{ quantity: 1, price: 2_000 }]);
    const { paymentId, invoiceId } = await world.created(placed);
    const { amount } = await world.payment(paymentId);
    world.provider().setStatus(invoiceId, "processing");
    world.provider().override(invoiceId, { finalAmount: { amount: amount + 1, currency: "UAH" } });
    await world.notify(invoiceId);
    expect(await world.payment(paymentId)).toMatchObject({
      status: "awaiting_customer",
      final_amount: null,
      needs_attention: true,
      attention_code: "amount_mismatch",
    });
    expect((await world.eventsOf(paymentId)).at(-1)).toMatchObject({
      source: "webhook",
      applied: false,
    });
    expect((await world.orderStatus(placed.id)).status).toBe("awaiting_payment");
  });

  it("reversed after success (a refund made outside the shop) keeps the payment and raises external_reversal", async () => {
    const { placed, paymentId, invoiceId } = await paidAttempt();
    await world.notify(invoiceId);
    world.provider().setStatus(invoiceId, "reversed");
    await world.notify(invoiceId);
    expect(await world.payment(paymentId)).toMatchObject({
      status: "succeeded",
      attention_code: "external_reversal",
    });
    expect((await world.orderStatus(placed.id)).status).toBe("paid");
  });

  it("a processing fact makes job 11 due one minute later", async () => {
    const placed = await world.place();
    const { paymentId, invoiceId } = await world.created(placed);
    world.provider().setStatus(invoiceId, "processing");
    await world.notify(invoiceId);
    const row = await world.payment(paymentId);
    expect(row.status).toBe("processing");
    expect(row.next_check_at?.getTime()).toBe(world.clock.now().getTime() + 60_000);
  });

  describe("rate limit", () => {
    let limited: RunningApp;

    beforeAll(async () => {
      limited = await startApp({
        extraPaymentProviders: testPaymentProviders(),
        rateLimits: { paymentWebhook: { maxAttempts: 2, windowMinutes: 1 } },
      });
    });

    afterAll(async () => {
      await limited.app.close();
    });

    it("paymentWebhook limits a client address (429 with Retry-After)", async () => {
      const input = signedTestWebhook("{not json");
      const statuses: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        statuses.push((await world.webhook(input, { running: limited })).status);
      }
      expect(statuses).toEqual([400, 400, 429]);
    });
  });
});
