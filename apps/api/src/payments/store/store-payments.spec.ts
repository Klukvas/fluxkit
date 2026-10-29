import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { CUSTOMER_SESSION_COOKIE_NAME } from "../../customers/auth/customer-session-cookie.js";
import type { StoreOrder } from "../../orders/orders.schemas.js";
import { startApp, TEST_STOREFRONT_PUBLIC_URL, type RunningApp } from "../../test/app.js";
import { deepKeys } from "../../test/cart-helpers.js";
import { createTestCustomer, deleteTestCustomers } from "../../test/customer-fixtures.js";
import { customerLoginCookie } from "../../test/customer-http.js";
import { http, type HttpResult } from "../../test/http.js";
import { PaymentWorld } from "../../test/payment-world.js";
import { captureLogs } from "../../test/shipping-fixtures.js";
import { Shopper } from "../../test/shopper.js";
import type { StoreCreatedPayment, StorePaymentStatus } from "./store-payments.schemas.js";
import { PAYMENT_RETRY_AFTER_SECONDS } from "./store-payments.service.js";

type Problem = Partial<Pick<ProblemBody, "code" | "detail" | "errors" | "rule">> & {
  payment?: { paymentId: string; status: string; canRetry: boolean };
};

const PASSWORD = "correct horse battery staple";
const HIGH = { maxAttempts: 100_000, windowMinutes: 10 };

/**
 * The store payment routes (ADR 0032 decisions 6, 14 and 18; plan step 8): ownership exactly like the order lookup and
 * cancel (one identical 404), the amount never from the client, idempotency, the refusals, the 503 of a provider that is
 * down or whose answer was lost, the status routes that read the provider at most once per 10 s, the `payment` member of
 * the store order views, no-store, CSRF and logs. Real Postgres and the in-repo test provider.
 */
describe("payments: store routes (real Postgres)", () => {
  let world: PaymentWorld;
  let base: string;
  const customers: string[] = [];

  beforeAll(async () => {
    world = await PaymentWorld.start({
      rateLimits: { checkout: HIGH, paymentCreate: HIGH, paymentStatus: HIGH, login: HIGH },
    });
    base = world.app.baseUrl;
  });

  beforeEach(() => {
    world.resetProvider();
    world.clock.advanceMinutes(1);
  });

  afterAll(async () => {
    await deleteTestCustomers(world.orders.db, customers);
    await world.stop();
  });

  function guestCreate(
    body: Record<string, unknown>,
    options: { key?: string | null; csrf?: boolean; headers?: Record<string, string> } = {},
  ): Promise<HttpResult<StoreCreatedPayment & Problem>> {
    const key = options.key === undefined ? randomUUID() : options.key;
    return http(base, "POST", "/store/orders/payments", {
      body,
      csrf: options.csrf,
      headers: { ...(key === null ? {} : { "idempotency-key": key }), ...options.headers },
    });
  }

  function guestStatus(
    body: Record<string, unknown>,
  ): Promise<HttpResult<StorePaymentStatus & Problem>> {
    return http(base, "POST", "/store/orders/payments/status", { body });
  }

  /** A signed-in customer (a real account and session) whose orders are placed through the real checkout. */
  async function customer(): Promise<Shopper> {
    const account = await createTestCustomer(world.orders.db, { password: PASSWORD });
    customers.push(account.id);
    const cookie = await customerLoginCookie(base, account.email, PASSWORD);
    const shopper = new Shopper(base);
    shopper.setCookie(CUSTOMER_SESSION_COOKIE_NAME, cookie.slice(cookie.indexOf("=") + 1));
    return shopper;
  }

  describe("guest create", () => {
    it("201 with the shopper view only; the attempt's amount is the order total; URLs from STOREFRONT_PUBLIC_URL despite forged hosts; no-store", async () => {
      const placed = await world.place([{ quantity: 3, price: 1_250 }]);
      const answer = await guestCreate(
        { number: placed.number, accessToken: placed.accessToken, locale: "en" },
        { headers: { "x-forwarded-host": "evil.example", forwarded: "host=evil.example" } },
      );
      expect(answer.status, JSON.stringify(answer.body)).toBe(201);
      expect(answer.headers.get("cache-control")).toBe("no-store");
      expect(Object.keys(answer.body).sort()).toEqual(
        ["expiresAt", "paymentId", "redirectUrl", "status"].sort(),
      );
      const row = await world.payment(answer.body.paymentId);
      expect(answer.body).toEqual({
        paymentId: row.id,
        status: "waiting",
        redirectUrl: row.redirect_url,
        expiresAt: row.expires_at.toISOString(),
      });
      expect(row).toMatchObject({ amount: 3_750, currency: "UAH", created_by: "guest" });
      expect(world.provider().creates[0]).toMatchObject({
        amount: { amount: 3_750, currency: "UAH" },
        returnUrl: `${TEST_STOREFRONT_PUBLIC_URL}/en/payment/return?payment=${row.id}`,
        webhookUrl: `${TEST_STOREFRONT_PUBLIC_URL}/webhooks/payments/fake`,
      });
    });

    it("never takes an amount, a currency or anything else from the client (strict body: 400, nothing created)", async () => {
      const placed = await world.place([{ quantity: 1, price: 2_000 }]);
      for (const extra of [
        { amount: 1 },
        { amount: { amount: 1, currency: "UAH" } },
        { currency: "USD" },
        { total: 1 },
        { returnUrl: "https://evil.example/" },
      ]) {
        const refused = await guestCreate({
          number: placed.number,
          accessToken: placed.accessToken,
          ...extra,
        });
        expect(refused.status, JSON.stringify(extra)).toBe(400);
        expect(refused.body).toMatchObject({ code: "validation_failed" });
      }
      expect(world.provider().calls.createPayment).toBe(0);
      expect(await world.paymentsOf(placed.id)).toEqual([]);
    });

    it("the same Idempotency-Key answers the same attempt (200) without a second provider call; with another provider it is 409 idempotency_key_reused", async () => {
      const placed = await world.place();
      const key = randomUUID();
      const body = { number: placed.number, accessToken: placed.accessToken };
      const first = await guestCreate(body, { key });
      expect(first.status).toBe(201);
      const again = await guestCreate(body, { key: key.toUpperCase() });
      expect(again.status).toBe(200);
      expect(again.body).toEqual(first.body);
      const otherProvider = await guestCreate({ ...body, provider: "other" }, { key });
      expect(otherProvider.status).toBe(409);
      expect(otherProvider.body).toMatchObject({ code: "idempotency_key_reused" });
      expect(world.provider().calls.createPayment).toBe(1);
      expect(await world.paymentsOf(placed.id)).toHaveLength(1);
    });

    it("needs the Idempotency-Key header (a UUID) and the store CSRF header", async () => {
      const placed = await world.place();
      const body = { number: placed.number, accessToken: placed.accessToken };
      expect((await guestCreate(body, { key: null })).body).toMatchObject({
        code: "validation_failed",
        errors: [{ path: "Idempotency-Key", code: "idempotency_key_required" }],
      });
      expect((await guestCreate(body, { key: "123" })).body).toMatchObject({
        errors: [{ path: "Idempotency-Key", code: "invalid_idempotency_key" }],
      });
      const noCsrf = await guestCreate(body, { csrf: false });
      expect(noCsrf.status).toBe(403);
      expect((await guestCreate({ ...body, locale: "de" })).status).toBe(400);
      expect(world.provider().calls.createPayment).toBe(0);
    });

    it("ownership: an unknown, malformed or other number, a wrong token and a customer's order are the same 404; nothing is created", async () => {
      const placed = await world.place();
      const other = await world.place();
      const shopper = await customer();
      const owned = await world.orders.place([{ quantity: 1 }], {}, shopper);
      const misses = [
        { number: placed.number, accessToken: other.accessToken },
        { number: placed.number, accessToken: `${placed.accessToken}x` },
        { number: "ZZZZ-ZZZZ", accessToken: placed.accessToken },
        { number: "nonsense", accessToken: placed.accessToken },
        { number: owned.number, accessToken: placed.accessToken },
      ];
      const bodies: string[] = [];
      for (const miss of misses) {
        const answer = await guestCreate(miss);
        expect(answer.status, JSON.stringify(miss)).toBe(404);
        bodies.push(JSON.stringify({ code: answer.body.code, detail: answer.body.detail }));
        const status = await guestStatus({ ...miss, paymentId: randomUUID() });
        expect(status.status).toBe(404);
      }
      expect(new Set(bodies).size).toBe(1);
      expect(world.provider().calls.createPayment).toBe(0);
      for (const order of [placed, other, owned]) {
        expect(await world.paymentsOf(order.id)).toEqual([]);
      }
    });

    it("refusals: 409 order_not_payable for a paid order, payment_in_progress while one is processing", async () => {
      const paid = await world.place();
      expect((await world.orders.pay(paid)).status).toBe(200);
      const notPayable = await guestCreate({ number: paid.number, accessToken: paid.accessToken });
      expect(notPayable.status).toBe(409);
      expect(notPayable.body).toMatchObject({ code: "rule_violation", rule: "order_not_payable" });

      const busy = await world.place();
      const { invoiceId } = await world.created(busy);
      world.provider().setStatus(invoiceId, "processing");
      await world.notify(invoiceId);
      const inProgress = await guestCreate({ number: busy.number, accessToken: busy.accessToken });
      expect(inProgress.status).toBe(409);
      expect(inProgress.body).toMatchObject({ rule: "payment_in_progress" });
    });

    it("503 payment_provider_unavailable: a refused create may be retried at once; a lost answer says wait (canRetry false, Retry-After until the invoice end) and blocks a new attempt", async () => {
      const placed = await world.place();
      const body = { number: placed.number, accessToken: placed.accessToken };
      world.provider().failNext({ operation: "createPayment", reason: "rejected" });
      const refused = await guestCreate(body);
      expect(refused.status).toBe(503);
      expect(refused.body).toMatchObject({
        code: "payment_provider_unavailable",
        payment: { status: "failed", canRetry: true },
      });
      expect(refused.headers.get("retry-after")).toBe(String(PAYMENT_RETRY_AFTER_SECONDS));
      expect(refused.headers.get("cache-control")).toBe("no-store");

      world.provider().failNext({ operation: "createPayment", reason: "unavailable" });
      const lost = await guestCreate(body);
      expect(lost.status).toBe(503);
      expect(lost.body.payment).toMatchObject({ status: "processing", canRetry: false });
      const row = await world.payment(lost.body.payment?.paymentId ?? "");
      expect(row.status).toBe("create_unknown");
      const untilEnd = Math.ceil((row.expires_at.getTime() - world.clock.now().getTime()) / 1_000);
      expect(Number(lost.headers.get("retry-after"))).toBe(untilEnd);
      const blocked = await guestCreate(body);
      expect(blocked.status).toBe(409);
      expect(blocked.body).toMatchObject({ rule: "payment_in_progress" });
      expect(world.provider().calls.createPayment).toBe(2);
    });
  });

  describe("status", () => {
    it("shows the shopper view; reads the provider while the attempt is live, at most once per 10 s; never provider data", async () => {
      const placed = await world.place();
      const created = await guestCreate({ number: placed.number, accessToken: placed.accessToken });
      const paymentId = created.body.paymentId;
      const body = { number: placed.number, accessToken: placed.accessToken, paymentId };
      const waiting = await guestStatus(body);
      expect(waiting.status).toBe(200);
      expect(waiting.headers.get("cache-control")).toBe("no-store");
      expect(waiting.body).toEqual({
        paymentId,
        status: "waiting",
        failureCategory: null,
        expiresAt: created.body.expiresAt,
        orderStatus: "awaiting_payment",
        canRetry: true,
      });
      expect(world.provider().calls.getPayment).toBe(1);

      // The provider took the money; no webhook arrived. Within 10 s the route answers what it knows...
      const invoiceId = (await world.payment(paymentId)).provider_payment_id ?? "";
      world.provider().setStatus(invoiceId, "succeeded");
      expect((await guestStatus(body)).body.status).toBe("waiting");
      expect(world.provider().calls.getPayment).toBe(1);
      // ... after that it reads once more and the order is paid from that verified read.
      world.clock.set(new Date(world.clock.now().getTime() + 11_000));
      const paid = await guestStatus(body);
      expect(paid.body).toMatchObject({
        status: "paid",
        failureCategory: null,
        orderStatus: "paid",
        canRetry: false,
      });
      expect(world.provider().calls.getPayment).toBe(2);
      // A final attempt is never read again.
      world.clock.set(new Date(world.clock.now().getTime() + 60_000));
      await guestStatus(body);
      expect(world.provider().calls.getPayment).toBe(2);
      const keys = [...deepKeys(paid.body)];
      for (const internal of [
        "providerStatus",
        "providerPaymentId",
        "invoiceId",
        "card",
        "amount",
      ]) {
        expect(keys).not.toContain(internal);
      }
      expect(JSON.stringify(paid.body)).not.toContain(invoiceId);
    });

    it("concurrent status calls share one provider read", async () => {
      const placed = await world.place();
      const { paymentId } = await world.created(placed);
      world.clock.set(new Date(world.clock.now().getTime() + 11_000));
      const release = world.provider().hold("getPayment");
      const body = { number: placed.number, accessToken: placed.accessToken, paymentId };
      const calls = [guestStatus(body), guestStatus(body), guestStatus(body)];
      await new Promise((resolve) => setTimeout(resolve, 200));
      release();
      const answers = await Promise.all(calls);
      expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200]);
      expect(world.provider().calls.getPayment).toBe(1);
    });

    it("a failed read answers what the shop knows (200); failure categories never carry bank text; an attempt of another order is 404", async () => {
      const placed = await world.place();
      const { paymentId, invoiceId } = await world.created(placed);
      const body = { number: placed.number, accessToken: placed.accessToken, paymentId };
      world.clock.set(new Date(world.clock.now().getTime() + 11_000));
      world.provider().failNext({ operation: "getPayment", reason: "unavailable" });
      expect((await guestStatus(body)).body).toMatchObject({ status: "waiting" });
      world.provider().setStatus(invoiceId, "failed", { failureCode: "59" });
      await world.notify(invoiceId);
      const failed = await guestStatus(body);
      expect(failed.body).toMatchObject({
        status: "failed",
        failureCategory: "declined",
        canRetry: true,
      });
      expect([...deepKeys(failed.body)]).not.toContain("failureCode");
      const other = await world.place();
      expect(
        (
          await guestStatus({
            number: other.number,
            accessToken: other.accessToken,
            paymentId,
          })
        ).status,
      ).toBe(404);
      expect((await guestStatus({ ...body, paymentId: "not-a-uuid" })).status).toBe(400);
    });
  });

  describe("customer", () => {
    it("creates and reads on the customer's own order; another customer, a guest's order and no session are 404 or 401", async () => {
      const shopper = await customer();
      const order = await world.orders.place([{ quantity: 2, price: 900 }], {}, shopper);
      const created = await shopper.request<StoreCreatedPayment & Problem>(
        "POST",
        `/store/account/orders/${order.number}/payments`,
        { headers: { "idempotency-key": randomUUID() } },
      );
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.headers.get("cache-control")).toBe("no-store");
      expect(await world.payment(created.body.paymentId)).toMatchObject({
        amount: 1_800,
        created_by: "customer",
      });
      const status = await shopper.get<StorePaymentStatus>(
        `/store/account/orders/${order.number}/payments/${created.body.paymentId}`,
      );
      expect(status.status).toBe(200);
      expect(status.headers.get("cache-control")).toBe("no-store");
      expect(status.body).toMatchObject({ paymentId: created.body.paymentId, status: "waiting" });

      const stranger = await customer();
      const guestOrder = await world.place();
      const strangerCreate = await stranger.request<Problem>(
        "POST",
        `/store/account/orders/${order.number}/payments`,
        { headers: { "idempotency-key": randomUUID() }, body: {} },
      );
      expect(strangerCreate.status).toBe(404);
      const guestViaAccount = await shopper.request<Problem>(
        "POST",
        `/store/account/orders/${guestOrder.number}/payments`,
        { headers: { "idempotency-key": randomUUID() } },
      );
      expect(guestViaAccount.status).toBe(404);
      expect(
        (
          await stranger.get(
            `/store/account/orders/${order.number}/payments/${created.body.paymentId}`,
          )
        ).status,
      ).toBe(404);
      const anonymous = await http(base, "POST", `/store/account/orders/${order.number}/payments`, {
        headers: { "idempotency-key": randomUUID() },
      });
      expect(anonymous.status).toBe(401);
      const withAmount = await shopper.request(
        "POST",
        `/store/account/orders/${order.number}/payments`,
        { headers: { "idempotency-key": randomUUID() }, body: { amount: 1 } },
      );
      expect(withAmount.status).toBe(400);
      expect(await world.paymentsOf(guestOrder.id)).toEqual([]);
      expect(await world.paymentsOf(order.id)).toHaveLength(1);
    });
  });

  describe("store order views", () => {
    it("carry `payment`: canPay and providers before an attempt, the latest attempt with its page while it waits", async () => {
      const placed = await world.place();
      const lookup = () =>
        http<StoreOrder>(base, "POST", "/store/orders/lookup", {
          body: { number: placed.number, accessToken: placed.accessToken },
        });
      expect((await lookup()).body.payment).toEqual({
        canPay: true,
        providers: ["fake"],
        latest: null,
      });
      const created = await guestCreate({ number: placed.number, accessToken: placed.accessToken });
      expect((await lookup()).body.payment).toEqual({
        canPay: true,
        providers: ["fake"],
        latest: {
          paymentId: created.body.paymentId,
          status: "waiting",
          failureCategory: null,
          expiresAt: created.body.expiresAt,
          redirectUrl: created.body.redirectUrl,
        },
      });
      const invoiceId = (await world.payment(created.body.paymentId)).provider_payment_id ?? "";
      world.provider().setStatus(invoiceId, "succeeded");
      await world.notify(invoiceId);
      expect((await lookup()).body.payment).toMatchObject({
        canPay: false,
        latest: { status: "paid", redirectUrl: null },
      });
    });
  });

  it("logs never carry the guest's access token", async () => {
    const placed = await world.place();
    const other = await world.place();
    const logs = captureLogs();
    try {
      world.provider().failNext({ operation: "createPayment", throws: true });
      const thrown = await guestCreate({ number: placed.number, accessToken: placed.accessToken });
      expect(thrown.status).toBe(503);
      expect(
        (await guestCreate({ number: other.number, accessToken: `${other.accessToken}x` })).status,
      ).toBe(404);
      expect(
        (
          await guestStatus({
            number: other.number,
            accessToken: other.accessToken,
            paymentId: randomUUID(),
          })
        ).status,
      ).toBe(404);
    } finally {
      logs.stop();
    }
    expect(logs.text()).not.toContain(placed.accessToken);
    expect(logs.text()).not.toContain(other.accessToken);
    expect(logs.text()).not.toMatch(/4242424242424242|tok_secret/);
  });
});

describe("payments: store routes with no payment provider (real Postgres)", () => {
  let world: PaymentWorld;
  let running: RunningApp;

  beforeAll(async () => {
    world = await PaymentWorld.start();
    running = await startApp({});
  });

  afterAll(async () => {
    await running.app.close();
    await world.stop();
  });

  it("a create is 409 payment_not_available; the order view says canPay false with no providers", async () => {
    const placed = await world.place();
    const answer = await http<Problem>(running.baseUrl, "POST", "/store/orders/payments", {
      body: { number: placed.number, accessToken: placed.accessToken },
      headers: { "idempotency-key": randomUUID() },
    });
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ code: "rule_violation", rule: "payment_not_available" });
    const view = await http<StoreOrder>(running.baseUrl, "POST", "/store/orders/lookup", {
      body: { number: placed.number, accessToken: placed.accessToken },
    });
    expect(view.body.payment).toEqual({ canPay: false, providers: [], latest: null });
    expect(await world.paymentsOf(placed.id)).toEqual([]);
  });
});

describe("payments: store rate limits (real Postgres)", () => {
  let running: RunningApp;

  beforeAll(async () => {
    running = await startApp({
      rateLimits: {
        paymentCreate: { maxAttempts: 2, windowMinutes: 10 },
        paymentStatus: { maxAttempts: 2, windowMinutes: 10 },
      },
    });
  });

  afterAll(async () => {
    await running.app.close();
  });

  it("limits creates and status reads per address (429 with Retry-After), counted before anything is looked up", async () => {
    const miss = { number: "ZZZZ-ZZZZ", accessToken: "x" };
    for (const [path, body] of [
      ["/store/orders/payments", miss],
      ["/store/orders/payments/status", { ...miss, paymentId: randomUUID() }],
    ] as const) {
      const statuses: number[] = [];
      let last: HttpResult<unknown> | undefined;
      for (let index = 0; index < 3; index += 1) {
        last = await http(running.baseUrl, "POST", path, {
          body,
          headers: { "idempotency-key": randomUUID() },
        });
        statuses.push(last.status);
      }
      expect(statuses, path).toEqual([404, 404, 429]);
      expect(Number(last?.headers.get("retry-after"))).toBeGreaterThan(0);
    }
  });
});
