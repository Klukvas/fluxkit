import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { http } from "../test/http.js";
import { PaymentWorld } from "../test/payment-world.js";
import { captureLogs } from "../test/shipping-fixtures.js";
import { signedTestWebhook } from "../test/test-payment-provider.js";

const MINUTE = 60_000;
const TTL = 30;

/**
 * Races on one order (ADR 0032 decision 7, ADR 0015 lock order `sales_order` -> `payment` -> reservations): every writer
 * takes the order row first, so webhooks, job 11's read, a manual mark paid, a cancel and the expiry job decide one after
 * the other. Exactly one outcome, never a double payment without a refund, never a deadlock (a deadlock that survived
 * its one retry would answer 503 or fail the job). Every race first warms the API's connection pool (`warmPool`, review F3),
 * so the requests really run at once instead of queuing for one new connection. Real Postgres, real HTTP.
 */
describe("payments: races on one order (real Postgres)", () => {
  let world: PaymentWorld;

  beforeAll(async () => {
    world = await PaymentWorld.start({ orderPaymentTtlMinutes: TTL });
  });

  let logs: ReturnType<typeof captureLogs>;

  beforeEach(() => {
    world.resetProvider();
    world.clock.set(new Date(Math.max(Date.now(), world.clock.now().getTime()) + MINUTE));
    logs = captureLogs();
  });

  afterEach(async () => {
    logs.stop();
    // The lock order makes a deadlock impossible; the retry that would hide one logs it.
    expect(logs.text()).not.toMatch(/Deadlock|40P01/);
    await world.orders.placed.cleanup();
  });

  afterAll(async () => {
    await world.stop();
  });

  const at = (minutes: number): Date => new Date(world.clock.now().getTime() + minutes * MINUTE);

  async function succeededAt(placedPrice = 2_000) {
    const placed = await world.place([{ quantity: 1, price: placedPrice }]);
    const attempt = await world.created(placed);
    world.provider().setStatus(attempt.invoiceId, "processing");
    await world.notify(attempt.invoiceId);
    world.provider().setStatus(attempt.invoiceId, "succeeded");
    return { placed, ...attempt };
  }

  it("a webhook waits for the order row before it locks the attempt (lock order, decided without a race)", async () => {
    const { placed, paymentId, invoiceId } = await succeededAt();
    const holder = await world.pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select id from sales_order where id = $1 for update", [placed.id]);
      const delivery = world.webhook(world.provider().webhookFor(invoiceId));
      // Wait until the webhook's transaction is blocked on a lock the holder has.
      const deadline = Date.now() + 5_000;
      for (;;) {
        const waiting = await world.pool.query<{ count: string }>(
          "select count(*) from pg_locks where not granted and pid <> pg_backend_pid()",
        );
        if (Number(waiting.rows[0]?.count) > 0) break;
        if (Date.now() > deadline) throw new Error("the webhook never waited for the order row");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      // Correct order: the webhook holds nothing of the attempt yet, so this does not wait.
      await holder.query("select id from payment where id = $1 for update nowait", [paymentId]);
      await holder.query("rollback");
      expect((await delivery).status).toBe(200);
    } finally {
      // Destroyed, not returned to the pool: a failed assertion leaves its transaction open.
      holder.release(true);
    }
    expect((await world.orderStatus(placed.id)).status).toBe("paid");
  });

  it("two webhooks (different bodies) and job 11's read at once: exactly one paid, one order.paid, no failure", async () => {
    for (let round = 0; round < 3; round += 1) {
      const { placed, paymentId, invoiceId } = await succeededAt();
      const body = world.provider().webhookBody(invoiceId);
      await world.warmPool();
      const [first, second, job] = await Promise.all([
        world.webhook(world.provider().webhookFor(invoiceId)),
        world.webhook(signedTestWebhook(`${body} `)),
        world.job11(at(5)),
      ]);
      expect([first.status, second.status]).toEqual([200, 200]);
      expect(job.failures).toEqual([]);
      expect((await world.orderStatus(placed.id)).status).toBe("paid");
      expect(await world.eventTypes(placed.id)).toEqual(["order.placed", "order.paid"]);
      expect(
        (await world.eventsOf(paymentId)).filter((row) => row.to_status === "succeeded"),
      ).toHaveLength(1);
      expect(await world.payment(paymentId)).toMatchObject({ order_outcome: "applied" });
    }
  });

  it("a success webhook racing an admin's manual mark paid: one payment kept, any second one refunded", async () => {
    for (let round = 0; round < 3; round += 1) {
      const placed = await world.place([{ quantity: 1, price: 2_000 }]);
      const { paymentId, invoiceId } = await world.created(placed);
      world.provider().setStatus(invoiceId, "succeeded");
      await world.warmPool();
      const [hook, manual] = await Promise.all([
        world.webhook(world.provider().webhookFor(invoiceId)),
        world.orders.pay(placed, `BANK-${String(round)}`),
      ]);
      expect(hook.status).toBe(200);
      const order = await world.orderStatus(placed.id);
      expect(order.status).toBe("paid");
      const row = await world.payment(paymentId);
      if (order.payment_reference === `fake:${invoiceId}`) {
        // The webhook won; the manual payment met a paid order.
        expect(manual.status).toBe(409);
        expect(row.order_outcome).toBe("applied");
        expect(await world.refundsOf(paymentId)).toEqual([]);
      } else {
        // The manual payment won (it closed the open attempt); the online success is refunded.
        expect(manual.status).toBe(200);
        expect(row.order_outcome).toBe("reference_conflict");
        expect((await world.refundsOf(paymentId))[0]?.reason).toBe("duplicate_payment");
      }
      expect(await world.eventTypes(placed.id)).toEqual(["order.placed", "order.paid"]);
    }
  });

  it("a success webhook racing a guest cancel: paid (cancel refused) or cancelled (success refunded)", async () => {
    for (let round = 0; round < 3; round += 1) {
      const placed = await world.place([{ quantity: 1, price: 2_000 }]);
      const { paymentId, invoiceId } = await world.created(placed);
      world.provider().setStatus(invoiceId, "succeeded");
      await world.warmPool();
      const [hook, cancel] = await Promise.all([
        world.webhook(world.provider().webhookFor(invoiceId)),
        http(world.app.baseUrl, "POST", "/store/orders/cancel", {
          body: { number: placed.number, accessToken: placed.accessToken },
        }),
      ]);
      expect(hook.status).toBe(200);
      const order = await world.orderStatus(placed.id);
      const refunds = await world.refundsOf(paymentId);
      if (order.status === "paid") {
        expect(cancel.status).toBe(409);
        expect(refunds).toEqual([]);
      } else {
        expect(order.status).toBe("cancelled");
        expect(cancel.status).toBe(200);
        expect(refunds[0]?.reason).toBe("late_payment");
      }
    }
  });

  it("a success webhook racing the expiry job at the cap: paid, or expired with the success refunded", async () => {
    for (let round = 0; round < 3; round += 1) {
      const { placed, paymentId, invoiceId } = await succeededAt();
      const placedAt = (
        await world.pool.query<{ placed_at: Date }>(
          "select placed_at from sales_order where id = $1",
          [placed.id],
        )
      ).rows[0]?.placed_at;
      const cap = new Date((placedAt ?? new Date()).getTime() + (TTL + 30) * MINUTE);
      await world.warmPool();
      const [hook, expiry] = await Promise.all([
        world.webhook(world.provider().webhookFor(invoiceId)),
        world.orderService.expireOne(placed.id, cap),
      ]);
      expect(hook.status).toBe(200);
      const order = await world.orderStatus(placed.id);
      const row = await world.payment(paymentId);
      expect(row.status).toBe("succeeded");
      if (order.status === "paid") {
        expect(expiry).toBe("not_due");
        expect(row.order_outcome).toBe("applied");
      } else {
        expect(order.status).toBe("expired");
        expect(expiry).toBe("expired");
        expect(row.order_outcome).toBe("order_not_payable");
        expect((await world.refundsOf(paymentId))[0]?.reason).toBe("late_payment");
      }
    }
  });

  it("job 11 reading while an admin cancels and a webhook lands: one outcome, no failure, no deadlock", async () => {
    const results: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      const { placed, paymentId, invoiceId } = await succeededAt();
      await world.warmPool();
      const [job, cancel, hook] = await Promise.all([
        world.job11(at(5)),
        world.orders.cancel(placed.id),
        world.webhook(world.provider().webhookFor(invoiceId)),
      ]);
      expect(job.failures).toEqual([]);
      expect(hook.status).toBe(200);
      // A processing attempt blocks the cancel until the success is applied; after that the paid order can be cancelled
      // by an admin (ADR 0022) and the payment stays (a refund is the admin's separate choice).
      expect([200, 409]).toContain(cancel.status);
      const order = await world.orderStatus(placed.id);
      expect((await world.payment(paymentId)).order_outcome).toBe("applied");
      expect(await world.refundsOf(paymentId)).toEqual([]);
      results.push(`${order.status}:${String(cancel.status)}`);
    }
    for (const result of results) {
      expect(["paid:409", "cancelled:200"]).toContain(result);
    }
  });
  describe("a create racing a cancel, the expiry job or a manual mark paid (review F4: the order row lock of the create)", () => {
    const LIVE = ["creating", "awaiting_customer", "processing", "create_unknown"];

    /**
     * Sets the race up deterministically: the test holds the `payment` table (ACCESS EXCLUSIVE), so the create (started
     * first) and then `other` both stop at their first read of payment rows. With the create's order row lock the create
     * stops holding the order, `other` waits for the order until the create committed its new attempt, and then sees it.
     * Without that lock (review F4) `other` takes the order row first; when the table is released, `other` reads no live
     * attempt and closes the order, while the create's insert waits for the order row and then lands a live attempt on
     * the closed order.
     */
    async function raceCreateWith<T>(
      other: (placed: Awaited<ReturnType<typeof world.place>>) => Promise<T>,
    ) {
      const placed = await world.place([{ quantity: 1, price: 2_000 }]);
      await world.warmPool();
      const holder = await world.pool.connect();
      try {
        await holder.query("begin");
        await holder.query("lock table payment in access exclusive mode");
        const create = world.create(placed);
        await world.waitForLockWaiters(1);
        const competing = other(placed);
        await world.waitForLockWaiters(2);
        await holder.query("rollback");
        const [created, result] = await Promise.all([create, competing]);
        return { placed, created, result };
      } finally {
        // Destroyed, not returned to the pool: a failed assertion leaves its transaction open.
        holder.release(true);
      }
    }

    async function liveAttempts(orderId: string): Promise<string[]> {
      return (await world.paymentsOf(orderId))
        .map((row) => row.status)
        .filter((status) => LIVE.includes(status));
    }

    it("a guest cancel: refused payment_in_progress, or the order is cancelled with no live attempt left", async () => {
      const { placed, created, result } = await raceCreateWith((order) =>
        http(world.app.baseUrl, "POST", "/store/orders/cancel", {
          body: { number: order.number, accessToken: order.accessToken },
        }),
      );
      expect(created.kind).toBe("created");
      const order = await world.orderStatus(placed.id);
      if (result.status === 200) {
        expect(order.status).toBe("cancelled");
        expect(await liveAttempts(placed.id)).toEqual([]);
      } else {
        expect(result.status, JSON.stringify(result.body)).toBe(409);
        expect(result.body).toMatchObject({ rule: "payment_in_progress" });
        expect(order.status).toBe("awaiting_payment");
      }
    });

    it("the expiry job at the deadline: deferred while the new attempt is live, never expired under it", async () => {
      const { placed, created, result } = await raceCreateWith(async (order) => {
        const deadline = (await world.orderStatus(order.id)).expires_at;
        return world.orderService.expireOne(order.id, deadline);
      });
      expect(created.kind).toBe("created");
      const order = await world.orderStatus(placed.id);
      expect(result).toBe("deferred");
      expect(order.status).toBe("awaiting_payment");
      expect(await liveAttempts(placed.id)).toEqual(["awaiting_customer"]);
    });

    it("an admin's manual mark paid: refused payment_in_progress, or paid with no live attempt left", async () => {
      const { placed, created, result } = await raceCreateWith((order) =>
        world.orders.pay(order, "BANK-F4"),
      );
      expect(created.kind).toBe("created");
      const order = await world.orderStatus(placed.id);
      if (result.status === 200) {
        expect(order.status).toBe("paid");
        expect(await liveAttempts(placed.id)).toEqual([]);
      } else {
        expect(result.status, JSON.stringify(result.body)).toBe(409);
        expect(result.body).toMatchObject({ rule: "payment_in_progress" });
        expect(order.status).toBe("awaiting_payment");
      }
    });
  });
});
