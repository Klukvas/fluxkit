import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JobsRunner } from "../jobs/jobs-runner.js";
import { http } from "../test/http.js";
import { reservationsOfOrder } from "../test/order-http.js";
import { PaymentWorld } from "../test/payment-world.js";

const MINUTE = 60_000;
const TTL = 30;

/**
 * The order side of online payments (ADR 0032 decisions 8 and 10, owner answers 2 and 3): the expiry deferral of job 1
 * while a payment is in flight (10-minute steps, capped at placed_at + TTL + 30 minutes) and the `payment_in_progress`
 * guards of the cancels and of the manual mark paid. Real Postgres.
 */
describe("payments: expiry deferral and the cancel and mark-paid guards (real Postgres)", () => {
  let world: PaymentWorld;

  beforeAll(async () => {
    world = await PaymentWorld.start({ orderPaymentTtlMinutes: TTL });
  });

  beforeEach(() => {
    world.resetProvider();
    world.clock.set(new Date(Math.max(Date.now(), world.clock.now().getTime()) + MINUTE));
  });

  afterEach(async () => {
    await world.orders.placed.cleanup();
  });

  afterAll(async () => {
    await world.stop();
  });

  async function placedAt(placed: { id: string }): Promise<Date> {
    const result = await world.pool.query<{ placed_at: Date }>(
      "select placed_at from sales_order where id = $1",
      [placed.id],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("no order");
    return row.placed_at;
  }

  describe("expiry", () => {
    it("an order without a live attempt expires on time, as before", async () => {
      const placed = await world.place();
      const { expires_at } = await world.orderStatus(placed.id);
      expect(await world.orderService.expireOne(placed.id, expires_at)).toBe("expired");
    });

    it("a closed (failed) attempt does not hold the order", async () => {
      const placed = await world.place();
      const { paymentId, invoiceId } = await world.created(placed);
      world.provider().setStatus(invoiceId, "failed");
      await world.notify(invoiceId);
      expect((await world.payment(paymentId)).status).toBe("failed");
      const { expires_at } = await world.orderStatus(placed.id);
      expect(await world.orderService.expireOne(placed.id, expires_at)).toBe("expired");
    });

    it("a live attempt defers expiry by 10 minutes: deadline and active reservations move, a system journal row, job 11 due now", async () => {
      const placed = await world.place([{ quantity: 2 }]);
      const { paymentId } = await world.created(placed);
      const deadline = (await world.orderStatus(placed.id)).expires_at;
      expect(await world.orderService.expireOne(placed.id, deadline)).toBe("deferred");
      const moved = await world.orderStatus(placed.id);
      expect(moved.status).toBe("awaiting_payment");
      expect(moved.expires_at.getTime()).toBe(deadline.getTime() + 10 * MINUTE);
      for (const reservation of await reservationsOfOrder(world.pool, placed.id)) {
        expect(reservation.status).toBe("active");
        expect(reservation.expires_at.getTime()).toBe(deadline.getTime() + 20 * MINUTE);
      }
      expect((await world.eventsOf(paymentId)).at(-1)).toMatchObject({
        source: "system",
        applied: false,
        to_status: null,
      });
      // Due for job 11 in this tick (the invoice end, 3 minutes before the deadline, is already due).
      expect((await world.payment(paymentId)).next_check_at?.getTime()).toBeLessThanOrEqual(
        deadline.getTime(),
      );
      expect(await world.eventTypes(placed.id)).toEqual(["order.placed"]);
    });

    it("a deferral makes job 11 read a processing attempt now, even one its backoff put hours ahead", async () => {
      const placed = await world.place();
      const { paymentId, invoiceId } = await world.created(placed);
      world.provider().setStatus(invoiceId, "processing");
      await world.notify(invoiceId);
      const deadline = (await world.orderStatus(placed.id)).expires_at;
      await world.pool.query("update payment set next_check_at = $2 where id = $1", [
        paymentId,
        new Date(deadline.getTime() + 5 * 60 * MINUTE),
      ]);
      expect(await world.orderService.expireOne(placed.id, deadline)).toBe("deferred");
      expect((await world.payment(paymentId)).next_check_at?.getTime()).toBe(deadline.getTime());
    });

    it("steps of 10 minutes up to exactly placed_at + TTL + 30 minutes, then expires and closes the open attempt", async () => {
      const placed = await world.place();
      const { paymentId } = await world.created(placed);
      const cap = (await placedAt(placed)).getTime() + (TTL + 30) * MINUTE;
      const deadline = (await world.orderStatus(placed.id)).expires_at.getTime();
      const seen: number[] = [];
      for (let step = 0; step < 3; step += 1) {
        const now = new Date((await world.orderStatus(placed.id)).expires_at.getTime());
        expect(await world.orderService.expireOne(placed.id, now)).toBe("deferred");
        seen.push((await world.orderStatus(placed.id)).expires_at.getTime());
      }
      expect(seen).toEqual([
        Math.min(deadline + 10 * MINUTE, cap),
        Math.min(deadline + 20 * MINUTE, cap),
        cap,
      ]);
      expect(await world.orderService.expireOne(placed.id, new Date(cap))).toBe("expired");
      expect((await world.orderStatus(placed.id)).status).toBe("expired");
      expect((await world.payment(paymentId)).status).toBe("invalidated");
    });

    it("a job that runs late defers from now, still capped", async () => {
      const placed = await world.place();
      await world.created(placed);
      const cap = (await placedAt(placed)).getTime() + (TTL + 30) * MINUTE;
      const deadline = (await world.orderStatus(placed.id)).expires_at.getTime();
      const late = new Date(deadline + 25 * MINUTE);
      expect(await world.orderService.expireOne(placed.id, late)).toBe("deferred");
      expect((await world.orderStatus(placed.id)).expires_at.getTime()).toBe(cap);
    });

    it("a processing payment that lands after the cap is refunded automatically with attention", async () => {
      const placed = await world.place([{ quantity: 1, price: 3_000 }]);
      const { paymentId, invoiceId } = await world.created(placed);
      world.provider().setStatus(invoiceId, "processing");
      await world.notify(invoiceId);
      const cap = new Date((await placedAt(placed)).getTime() + (TTL + 30) * MINUTE);
      expect(await world.orderService.expireOne(placed.id, cap)).toBe("expired");
      expect((await world.payment(paymentId)).status).toBe("processing");
      world.provider().setStatus(invoiceId, "succeeded");
      await world.notify(invoiceId);
      expect(await world.payment(paymentId)).toMatchObject({
        status: "succeeded",
        order_outcome: "order_not_payable",
        attention_code: "late_payment",
      });
      expect((await world.refundsOf(paymentId))[0]).toMatchObject({
        amount: 3_000,
        reason: "late_payment",
      });
      expect((await world.orderStatus(placed.id)).status).toBe("expired");
    });

    it("in one scheduler tick: job 1 defers, job 11 reads the lapsed invoice and closes it; the next tick expires the order", async () => {
      const placed = await world.place();
      const { paymentId, invoiceId } = await world.created(placed);
      const deadline = (await world.orderStatus(placed.id)).expires_at;
      const runner = world.app.app.get(JobsRunner);
      const first = await runner.runAll(deadline);
      expect(first.every((report) => report.ok)).toBe(true);
      expect((await world.orderStatus(placed.id)).status).toBe("awaiting_payment");
      expect((await world.payment(paymentId)).status).toBe("invalidated");
      expect(world.provider().invoice(invoiceId).status).toBe("created");
      const next = new Date((await world.orderStatus(placed.id)).expires_at.getTime());
      await runner.runAll(next);
      expect((await world.orderStatus(placed.id)).status).toBe("expired");
      // The invalidation call of the closed invoice ran in a tick.
      expect(world.provider().invoice(invoiceId).status).toBe("expired");
    });
  });

  describe("cancel and manual mark paid", () => {
    async function inProgress(status: "processing" | "create_unknown") {
      const placed = await world.place();
      if (status === "processing") {
        const { invoiceId } = await world.created(placed);
        world.provider().setStatus(invoiceId, "processing");
        await world.notify(invoiceId);
      } else {
        world.provider().failNext({ operation: "createPayment" });
        expect((await world.create(placed)).kind).toBe("provider_unavailable");
      }
      return placed;
    }

    it.each(["processing", "create_unknown"] as const)(
      "while an attempt is %s: admin cancel, guest cancel and manual mark paid are 409 payment_in_progress",
      async (status) => {
        const placed = await inProgress(status);
        const cancel = await world.orders.cancel(placed.id);
        expect(cancel.status).toBe(409);
        expect(cancel.body).toMatchObject({ code: "rule_violation", rule: "payment_in_progress" });
        const pay = await world.orders.pay(placed);
        expect(pay.status).toBe(409);
        expect(pay.body).toMatchObject({ code: "rule_violation", rule: "payment_in_progress" });
        const guest = await http<{ code: string; rule: string }>(
          world.app.baseUrl,
          "POST",
          "/store/orders/cancel",
          { body: { number: placed.number, accessToken: placed.accessToken } },
        );
        expect(guest.status).toBe(409);
        expect(guest.body).toMatchObject({ rule: "payment_in_progress" });
        expect((await world.orderStatus(placed.id)).status).toBe("awaiting_payment");
      },
    );

    it("an admin cancel closes an awaiting_customer attempt in the same transaction, journaled with the admin", async () => {
      const placed = await world.place();
      const { paymentId } = await world.created(placed);
      expect((await world.orders.cancel(placed.id)).status).toBe(200);
      expect(await world.payment(paymentId)).toMatchObject({
        status: "invalidated",
        redirect_url: null,
      });
      expect((await world.eventsOf(paymentId)).at(-1)).toMatchObject({
        source: "admin",
        from_status: "awaiting_customer",
        to_status: "invalidated",
        actor_admin_id: world.orders.ownerId,
      });
    });

    it("a guest cancel closes an awaiting_customer attempt (system)", async () => {
      const placed = await world.place();
      const { paymentId } = await world.created(placed);
      const guest = await http(world.app.baseUrl, "POST", "/store/orders/cancel", {
        body: { number: placed.number, accessToken: placed.accessToken },
      });
      expect(guest.status).toBe(200);
      expect((await world.eventsOf(paymentId)).at(-1)).toMatchObject({
        source: "system",
        to_status: "invalidated",
      });
    });

    it("a paid order is still cancelled by an admin (ADR 0022) without touching its succeeded attempt", async () => {
      const placed = await world.place();
      const { paymentId, invoiceId } = await world.created(placed);
      world.provider().setStatus(invoiceId, "succeeded");
      await world.notify(invoiceId);
      expect((await world.orders.cancel(placed.id)).status).toBe(200);
      expect((await world.payment(paymentId)).status).toBe("succeeded");
      expect(await world.refundsOf(paymentId)).toEqual([]);
    });
  });
});
