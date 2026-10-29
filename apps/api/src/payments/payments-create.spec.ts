import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startApp, TEST_STOREFRONT_PUBLIC_URL, type RunningApp } from "../test/app.js";
import { PaymentWorld } from "../test/payment-world.js";
import { captureLogs } from "../test/shipping-fixtures.js";
import { testPaymentProviders } from "../test/test-payment-provider.js";
import { PaymentCreateService } from "./payment-create.service.js";

const MINUTE = 60_000;

/**
 * The create flow of a payment attempt (ADR 0032 decision 6; plan step 5): guards, the amount from the order, the
 * provider call outside any transaction, the record step, lost answers never retried, and the crash windows that job 11
 * closes. Real Postgres, the in-repo test provider.
 */
describe("payments: the create flow (real Postgres)", () => {
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

  it("creates an attempt for the order total: creating -> awaiting_customer, URLs from STOREFRONT_PUBLIC_URL, a basket that adds up", async () => {
    const placed = await world.place([{ quantity: 2, price: 1_500 }]);
    const result = await world.create(placed, { locale: "en" });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.replay).toBe(false);
    const row = await world.payment(result.payment.paymentId);
    expect(row).toMatchObject({
      order_id: placed.id,
      provider_code: "fake",
      amount: 3_000,
      currency: "UAH",
      status: "awaiting_customer",
      provider_payment_id: world.provider().invoices[0]?.providerPaymentId,
      redirect_url: `https://pay.test.invalid/${world.provider().invoices[0]?.providerPaymentId ?? ""}`,
      created_by: "guest",
      needs_attention: false,
    });
    expect(result.payment.redirectUrl).toBe(row.redirect_url);
    // The invoice ends 3 minutes before the order deadline (decision 9); job 11 reads it then.
    const order = await world.orderStatus(placed.id);
    expect(row.expires_at.getTime()).toBe(order.expires_at.getTime() - 3 * MINUTE);
    expect(row.next_check_at?.getTime()).toBe(row.expires_at.getTime());
    const [request] = world.provider().creates;
    expect(request).toMatchObject({
      paymentId: row.id,
      orderNumber: placed.number,
      amount: { amount: 3_000, currency: "UAH" },
      description: `Order ${placed.number}`,
      returnUrl: `${TEST_STOREFRONT_PUBLIC_URL}/en/payment/return?payment=${row.id}`,
      webhookUrl: `${TEST_STOREFRONT_PUBLIC_URL}/webhooks/payments/fake`,
      expiresAt: row.expires_at,
    });
    expect(request?.lines.reduce((sum, line) => sum + line.total.amount, 0)).toBe(3_000);
    expect(request?.lines[0]).toMatchObject({ quantity: 2, unitAmount: { amount: 1_500 } });
    expect(await world.eventsOf(row.id)).toEqual([
      expect.objectContaining({
        source: "create",
        from_status: null,
        to_status: "creating",
        applied: true,
      }),
      expect.objectContaining({
        source: "create",
        from_status: "creating",
        to_status: "awaiting_customer",
      }),
    ]);
    expect(await world.eventTypes(row.id)).toEqual(["payment.status_changed"]);
    expect((await world.orderStatus(placed.id)).status).toBe("awaiting_payment");
  });

  it("describes the payment in the order locale when the request names none", async () => {
    const placed = await world.place();
    await world.created(placed);
    expect(world.provider().creates[0]?.description).toBe(`Замовлення ${placed.number}`);
    expect(world.provider().creates[0]?.returnUrl).toContain("/uk/payment/return?payment=");
  });

  it("answers a replay of the same Idempotency-Key with the same attempt and calls the provider once", async () => {
    const placed = await world.place();
    const key = randomUUID();
    const first = await world.create(placed, { key });
    const second = await world.create(placed, { key });
    expect(first.kind).toBe("created");
    expect(second).toMatchObject({ kind: "created", replay: true });
    if (first.kind !== "created" || second.kind !== "created") return;
    expect(second.payment.paymentId).toBe(first.payment.paymentId);
    expect(world.provider().calls.createPayment).toBe(1);
  });

  it("a new attempt closes the open one (invalidated, its invoice queued for invalidation): at most one live attempt", async () => {
    const placed = await world.place();
    const first = await world.created(placed);
    const second = await world.created(placed);
    const rows = await world.paymentsOf(placed.id);
    expect(Object.fromEntries(rows.map((row) => [row.id, row.status]))).toEqual({
      [first.paymentId]: "invalidated",
      [second.paymentId]: "awaiting_customer",
    });
    const closed = rows.find((row) => row.id === first.paymentId);
    expect(closed?.redirect_url).toBeNull();
    expect(closed?.next_check_at?.getTime()).toBe(world.clock.now().getTime());
  });

  it("refuses order_not_payable for a paid order and for an order an attempt already paid", async () => {
    const paidByHand = await world.place();
    expect((await world.orders.pay(paidByHand)).status).toBe(200);
    expect(await world.create(paidByHand)).toEqual({ kind: "refused", rule: "order_not_payable" });
  });

  it("refuses payment_in_progress while an attempt is processing or create_unknown", async () => {
    const placed = await world.place();
    const { invoiceId } = await world.created(placed);
    world.provider().setStatus(invoiceId, "processing");
    await world.notify(invoiceId);
    expect(await world.create(placed)).toEqual({ kind: "refused", rule: "payment_in_progress" });

    const unknown = await world.place();
    world.provider().failNext({ operation: "createPayment", reason: "unavailable" });
    expect((await world.create(unknown)).kind).toBe("provider_unavailable");
    expect(await world.create(unknown)).toEqual({ kind: "refused", rule: "payment_in_progress" });
    // Never retried with the same attempt: Monobank has no create idempotency (M5).
    expect(world.provider().calls.createPayment).toBe(2);
  });

  it("refuses payment_window_too_short when less than 5 minutes of invoice would remain", async () => {
    const placed = await world.place();
    const order = await world.orderStatus(placed.id);
    // 8 minutes before the deadline: an invoice of exactly 5 minutes is allowed.
    world.clock.set(new Date(order.expires_at.getTime() - 8 * MINUTE));
    expect((await world.create(placed)).kind).toBe("created");
    world.clock.set(new Date(order.expires_at.getTime() - 8 * MINUTE + 1));
    expect(await world.create(placed)).toEqual({
      kind: "refused",
      rule: "payment_window_too_short",
    });
    world.clock.set(new Date(Date.now() + MINUTE));
  });

  it("refuses payment_not_available without STOREFRONT_PUBLIC_URL (the URLs come from config, never a request's Host)", async () => {
    let bare: RunningApp | undefined;
    try {
      bare = await startApp({
        clock: world.clock,
        storefrontPublicUrl: null,
        extraPaymentProviders: testPaymentProviders(),
      });
      const placed = await world.place();
      const result = await bare.app.get(PaymentCreateService).createPaymentForOrder({
        orderId: placed.id,
        idempotencyKey: randomUUID(),
        createdBy: "guest",
      });
      expect(result).toEqual({ kind: "refused", rule: "payment_not_available" });
    } finally {
      await bare?.app.close();
    }
  });

  it("answers not_found for an unknown order", async () => {
    expect(
      await world.createService.createPaymentForOrder({
        orderId: randomUUID(),
        idempotencyKey: randomUUID(),
        createdBy: "guest",
      }),
    ).toEqual({ kind: "not_found" });
  });

  it.each([
    ["rejected", ["BAD_REQUEST"], "BAD_REQUEST"],
    ["misconfigured", [], "misconfigured"],
    ["not_sent", [], "not_sent"],
    ["rate_limited", [], "rate_limited"],
  ] as const)(
    "provider %s: the attempt is failed with a code, and the shopper may try again at once",
    async (reason, providerCodes, code) => {
      const placed = await world.place();
      world.provider().failNext({
        operation: "createPayment",
        reason,
        providerCodes,
        ...(reason === "rate_limited" ? { retryAfterSeconds: 30 } : {}),
      });
      const result = await world.create(placed);
      expect(result.kind).toBe("provider_unavailable");
      if (result.kind !== "provider_unavailable") return;
      expect(result.retryAfterSeconds).toBe(reason === "rate_limited" ? 30 : null);
      const row = await world.payment(result.payment.paymentId);
      expect(row).toMatchObject({ status: "failed", failure_code: code, next_check_at: null });
      expect((await world.create(placed)).kind).toBe("created");
    },
  );

  it.each([
    ["unavailable", { reason: "unavailable" as const }],
    ["a timeout", { hang: true }],
    ["a thrown error", { throws: true }],
  ])(
    "provider %s: the attempt is create_unknown, never retried, and blocks a new attempt",
    async (_label, failure) => {
      const placed = await world.place();
      const logs = captureLogs();
      try {
        world.provider().failNext({ operation: "createPayment", ...failure });
        const result = await world.create(placed);
        expect(result.kind).toBe("provider_unavailable");
        if (result.kind !== "provider_unavailable") return;
        const row = await world.payment(result.payment.paymentId);
        expect(row).toMatchObject({ status: "create_unknown", provider_payment_id: null });
        expect(row.next_check_at?.getTime()).toBe(row.expires_at.getTime());
        expect(world.provider().calls.createPayment).toBe(1);
      } finally {
        logs.stop();
      }
      expect(logs.text()).not.toMatch(/4242424242424242|tok_secret/);
    },
  );

  it("an answer that is not a usable page (not https) is a malformed answer: create_unknown", async () => {
    const placed = await world.place();
    const provider = world.provider();
    const original = provider.createPayment.bind(provider);
    provider.createPayment = async (input, signal) => {
      const answer = await original(input, signal);
      return answer.ok
        ? { ok: true, value: { ...answer.value, redirectUrl: "http://pay.test.invalid/x" } }
        : answer;
    };
    try {
      const result = await world.create(placed);
      expect(result.kind).toBe("provider_unavailable");
      if (result.kind !== "provider_unavailable") return;
      expect((await world.payment(result.payment.paymentId)).status).toBe("create_unknown");
    } finally {
      provider.createPayment = original;
    }
  });

  it("a lost answer whose invoice exists: a later webhook binds it by our reference", async () => {
    const placed = await world.place();
    world.provider().failNext({ operation: "createPayment", afterEffect: true });
    const result = await world.create(placed);
    if (result.kind !== "provider_unavailable") throw new Error(result.kind);
    const invoice = world.provider().invoiceOf(result.payment.paymentId);
    world.provider().setStatus(invoice.providerPaymentId, "succeeded");
    await world.notify(invoice.providerPaymentId);
    const row = await world.payment(result.payment.paymentId);
    expect(row).toMatchObject({
      status: "succeeded",
      provider_payment_id: invoice.providerPaymentId,
      order_outcome: "applied",
    });
    expect((await world.orderStatus(placed.id)).status).toBe("paid");
  });

  it("a hanging provider holds no database lock: the attempt is committed before the call and the order stays free", async () => {
    const placed = await world.place();
    const release = world.provider().hold("createPayment");
    const pending = world.create(placed);
    for (let i = 0; i < 200 && world.provider().calls.createPayment === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect((await world.paymentsOf(placed.id)).map((row) => row.status)).toEqual(["creating"]);
    const probe = await world.pool.connect();
    try {
      await probe.query("begin");
      await probe.query("select 1 from sales_order where id = $1 for update nowait", [placed.id]);
      await probe.query("select 1 from payment where order_id = $1 for update nowait", [placed.id]);
      await probe.query("rollback");
      const idle = await probe.query<{ count: number }>(
        `select count(*)::int as count from pg_stat_activity
          where datname = current_database() and state like 'idle in transaction%' and pid <> pg_backend_pid()`,
      );
      expect(idle.rows[0]?.count).toBe(0);
    } finally {
      probe.release();
      release();
    }
    expect((await pending).kind).toBe("created");
  });

  it("a create that is never recorded (the process died after the insert): job 11 closes it create_unknown; a late answer only teaches the provider id", async () => {
    const placed = await world.place();
    const release = world.provider().hold("createPayment");
    const pending = world.create(placed);
    for (let i = 0; i < 200 && world.provider().calls.createPayment === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const [creating] = await world.paymentsOf(placed.id);
    if (creating === undefined) throw new Error("no attempt");
    // Before the recovery time job 11 leaves it alone.
    expect(
      (await world.job11(new Date(world.clock.now().getTime() + MINUTE))).closedCrashedCreates,
    ).toBe(0);
    const later = new Date(world.clock.now().getTime() + 3 * MINUTE);
    expect((await world.job11(later)).closedCrashedCreates).toBe(1);
    expect((await world.payment(creating.id)).status).toBe("create_unknown");
    // The held call answers now (in the real crash it never does): it cannot reopen the attempt.
    release();
    const result = await pending;
    expect(result.kind).toBe("provider_unavailable");
    const row = await world.payment(creating.id);
    expect(row).toMatchObject({
      status: "create_unknown",
      provider_payment_id: world.provider().invoices[0]?.providerPaymentId,
    });
    expect(world.provider().calls.createPayment).toBe(1);
  });
});
