import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JobBudget } from "../jobs/job-budget.js";
import { PaymentWorld } from "../test/payment-world.js";
import { captureLogs } from "../test/shipping-fixtures.js";

const MINUTE = 60_000;

/**
 * Job 11 `reconcile-payments` and refunds (ADR 0032 decisions 11 and 13): status reads by the backoff, lost webhooks,
 * closing lapsed and unknown creates, invalidation, automatic refunds sent after commit, lost refund answers settled by
 * our refund id and never resent, throttling, budget and starvation. Real Postgres, the in-repo test provider.
 */
describe("payments: job 11 reconcile-payments and refunds (real Postgres)", () => {
  let world: PaymentWorld;

  beforeAll(async () => {
    world = await PaymentWorld.start();
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

  const at = (minutes: number): Date => new Date(world.clock.now().getTime() + minutes * MINUTE);

  /** A processing attempt (its webhook arrived); job 11 is due 1 minute later. */
  async function processing(price = 2_000) {
    const placed = await world.place([{ quantity: 1, price }]);
    const attempt = await world.created(placed);
    world.provider().setStatus(attempt.invoiceId, "processing");
    await world.notify(attempt.invoiceId);
    return { placed, ...attempt };
  }

  /** A succeeded attempt whose order was cancelled before: a late payment with an automatic refund `requested`. */
  async function latePayment(price = 2_000) {
    const placed = await world.place([{ quantity: 1, price }]);
    const attempt = await world.created(placed);
    expect((await world.orders.cancel(placed.id)).status).toBe(200);
    world.provider().setStatus(attempt.invoiceId, "succeeded");
    await world.notify(attempt.invoiceId);
    const [refund] = await world.refundsOf(attempt.paymentId);
    if (refund === undefined) throw new Error("no refund queued");
    return { placed, ...attempt, refundId: refund.id };
  }

  it("pays an order whose success webhook was lost: the status read is applied like a webhook (source poll)", async () => {
    const { placed, paymentId, invoiceId } = await processing();
    world.provider().setStatus(invoiceId, "succeeded");
    expect((await world.job11(at(0))).polled).toBe(0);
    const result = await world.job11(at(1));
    expect(result).toMatchObject({ scanned: 1, polled: 1, failures: [] });
    expect(await world.payment(paymentId)).toMatchObject({
      status: "succeeded",
      order_outcome: "applied",
      next_check_at: null,
    });
    expect((await world.orderStatus(placed.id)).status).toBe("paid");
    const poll = (await world.eventsOf(paymentId)).at(-1);
    expect(poll).toMatchObject({ source: "poll", to_status: "succeeded" });
    expect(poll?.dedupe_key).toMatch(/^poll:success:/);
  });

  it("a read that says nothing new counts a check and backs off 1, 2, 5, 10, 30 minutes, then hourly; journaled once", async () => {
    const { paymentId } = await processing();
    const delays: number[] = [];
    let now = at(1);
    for (let i = 0; i < 6; i += 1) {
      await world.job11(now);
      const row = await world.payment(paymentId);
      delays.push(((row.next_check_at?.getTime() ?? 0) - now.getTime()) / MINUTE);
      now = row.next_check_at ?? now;
    }
    expect(delays).toEqual([1, 2, 5, 10, 30, 60]);
    expect((await world.payment(paymentId)).check_attempts).toBe(6);
    const polls = (await world.eventsOf(paymentId)).filter((row) => row.source === "poll");
    expect(polls).toHaveLength(1);
  });

  it("when the schedule ends a live attempt raises reconcile_gave_up and is still read hourly", async () => {
    const { paymentId } = await processing();
    await world.pool.query(
      "update payment set check_attempts = 53, next_check_at = $2 where id = $1",
      [paymentId, at(1)],
    );
    await world.job11(at(1));
    const row = await world.payment(paymentId);
    expect(row).toMatchObject({ needs_attention: true, attention_code: "reconcile_gave_up" });
    expect(row.next_check_at?.getTime()).toBe(at(61).getTime());
  });

  it("a failing read backs off the same way; one failing attempt never blocks the others", async () => {
    const first = await processing();
    const second = await processing();
    world.provider().failNext({ operation: "getPayment", reason: "unavailable" });
    world.provider().setStatus(second.invoiceId, "succeeded");
    const result = await world.job11(at(2));
    expect(result).toMatchObject({ scanned: 2, polled: 1, pollFailures: 1, failures: [] });
    const rows = [await world.payment(first.paymentId), await world.payment(second.paymentId)];
    const failed = rows.find((row) => row.status === "processing");
    expect(failed?.check_attempts).toBe(1);
    expect(rows.filter((row) => row.status === "succeeded")).toHaveLength(1);
  });

  it("an awaiting_customer invoice still unpaid after its end is closed (invalidated) and then invalidated at the provider", async () => {
    const placed = await world.place();
    const { paymentId, invoiceId } = await world.created(placed);
    const end = (await world.payment(paymentId)).expires_at;
    expect((await world.job11(new Date(end.getTime() - 1))).scanned).toBe(0);
    await world.job11(end);
    expect(await world.payment(paymentId)).toMatchObject({
      status: "invalidated",
      redirect_url: null,
    });
    expect((await world.job11(end)).invalidated).toBe(1);
    expect(world.provider().invoice(invoiceId).status).toBe("expired");
    expect((await world.payment(paymentId)).next_check_at).toBeNull();
  });

  it("invalidating an invoice the shopper paid meanwhile reads it and refunds the success as a duplicate", async () => {
    const placed = await world.place([{ quantity: 1, price: 2_000 }]);
    const first = await world.created(placed);
    const second = await world.created(placed);
    world.provider().setStatus(first.invoiceId, "succeeded");
    world.provider().setStatus(second.invoiceId, "succeeded");
    await world.notify(second.invoiceId);
    // The first (invalidated) attempt's webhook is lost: job 11 tries to invalidate it, learns it was paid.
    await world.job11(at(0));
    expect(await world.payment(first.paymentId)).toMatchObject({
      status: "succeeded",
      order_outcome: "reference_conflict",
    });
    expect((await world.refundsOf(first.paymentId))[0]?.reason).toBe("duplicate_payment");
  });

  it("invalidation failures are tried three times, then given up quietly", async () => {
    const placed = await world.place();
    const first = await world.created(placed);
    await world.created(placed);
    world.provider().failNext({ operation: "invalidatePayment", times: 3 });
    for (let minute = 0; minute < 3; minute += 1) {
      await world.job11(at(minute));
    }
    expect(world.provider().calls.invalidatePayment).toBe(3);
    expect(await world.payment(first.paymentId)).toMatchObject({
      status: "invalidated",
      next_check_at: null,
      check_attempts: 3,
    });
  });

  it("a create_unknown attempt without an invoice id is closed failed at its invoice end and never created again", async () => {
    const placed = await world.place();
    world.provider().failNext({ operation: "createPayment" });
    const result = await world.create(placed);
    if (result.kind !== "provider_unavailable") throw new Error(result.kind);
    const end = (await world.payment(result.payment.paymentId)).expires_at;
    expect((await world.job11(new Date(end.getTime() - 1))).closedCreateUnknown).toBe(0);
    expect((await world.job11(end)).closedCreateUnknown).toBe(1);
    expect(await world.payment(result.payment.paymentId)).toMatchObject({
      status: "failed",
      failure_code: "create_unknown",
      next_check_at: null,
    });
    expect(world.provider().calls.createPayment).toBe(1);
  });

  describe("refunds", () => {
    it("sends an automatic refund after commit: succeeded, refunded_amount, event, the order status untouched", async () => {
      const { placed, paymentId, invoiceId, refundId } = await latePayment(2_000);
      const result = await world.job11(at(0));
      expect(result.refundsSent).toBe(1);
      expect(world.provider().refundCalls).toEqual([
        {
          providerPaymentId: invoiceId,
          refundId,
          amount: { amount: 2_000, currency: "UAH" },
          full: true,
        },
      ]);
      expect(await world.refundsOf(paymentId)).toEqual([
        expect.objectContaining({ id: refundId, status: "succeeded" }),
      ]);
      expect(await world.payment(paymentId)).toMatchObject({
        refunded_amount: 2_000,
        next_check_at: null,
      });
      expect(await world.eventTypes(refundId)).toEqual(["payment.refund_status_changed"]);
      expect((await world.orderStatus(placed.id)).status).toBe("cancelled");
    });

    it.each([
      ["the answer is lost after the refund was made", { afterEffect: true }],
      ["the call times out after the refund was made", { afterEffect: true, hang: true }],
      ["the call throws after the refund was made", { afterEffect: true, throws: true }],
    ])(
      "%s: unknown, settled from the provider's list by our refund id, never sent twice",
      async (_label, failure) => {
        const { paymentId, refundId } = await latePayment();
        world.provider().failNext({ operation: "refund", ...failure });
        await world.job11(at(0));
        expect((await world.refundsOf(paymentId))[0]).toMatchObject({ status: "unknown" });
        expect((await world.payment(paymentId)).refunded_amount).toBe(0);
        await world.job11(at(5));
        expect(world.provider().refundCalls).toHaveLength(1);
        expect((await world.refundsOf(paymentId))[0]).toMatchObject({
          id: refundId,
          status: "succeeded",
        });
        expect(await world.payment(paymentId)).toMatchObject({
          refunded_amount: 2_000,
          next_check_at: null,
        });
      },
    );

    it("an unknown refund that never appears is never failed by the system: the schedule ends, attention stays raised, nothing resent", async () => {
      const { paymentId } = await latePayment();
      world.provider().failNext({ operation: "refund" });
      await world.job11(at(0));
      await world.pool.query(
        "update payment set check_attempts = 53, next_check_at = $2 where id = $1",
        [paymentId, at(10)],
      );
      await world.job11(at(10));
      expect((await world.refundsOf(paymentId))[0]?.status).toBe("unknown");
      expect(await world.payment(paymentId)).toMatchObject({
        attention_code: "late_payment",
        needs_attention: true,
        next_check_at: null,
      });
      expect(world.provider().refundCalls).toHaveLength(1);
    });

    it("rate_limited: nothing processed, the refund stays requested, the provider is paused for the run, sent later", async () => {
      const first = await latePayment();
      const second = await latePayment();
      world
        .provider()
        .failNext({ operation: "refund", reason: "rate_limited", retryAfterSeconds: 120 });
      const result = await world.job11(at(0));
      expect(result.rateLimited).toBeGreaterThanOrEqual(1);
      expect(world.provider().refundCalls).toHaveLength(1);
      const statuses = [
        (await world.refundsOf(first.paymentId))[0]?.status,
        (await world.refundsOf(second.paymentId))[0]?.status,
      ];
      expect(statuses).toEqual(["requested", "requested"]);
      await world.job11(at(3));
      expect((await world.refundsOf(first.paymentId))[0]?.status).toBe("succeeded");
      expect((await world.refundsOf(second.paymentId))[0]?.status).toBe("succeeded");
      expect(world.provider().refundCalls).toHaveLength(3);
    });

    it("a refusal (not_cancellable) fails the refund with its code and raises refund_failed; nothing is resent", async () => {
      const { paymentId } = await latePayment();
      world.provider().failNext({
        operation: "refund",
        reason: "not_cancellable",
        providerCodes: ["CANCEL_NOT_AVAILABLE"],
      });
      await world.job11(at(0));
      expect((await world.refundsOf(paymentId))[0]).toMatchObject({
        status: "failed",
        failure_code: "CANCEL_NOT_AVAILABLE",
      });
      await world.job11(at(10));
      expect(world.provider().refundCalls).toHaveLength(1);
    });

    it("a send that died mid-call (a claim without an answer) becomes unknown once stale and is never sent again", async () => {
      const { paymentId, refundId } = await latePayment();
      await world.pool.query(
        `insert into payment_event (payment_id, source, dedupe_key, applied) values ($1, 'system', $2, false)`,
        [paymentId, `system:refund-send:${refundId}:1`],
      );
      await world.pool.query("update payment_refund set updated_at = $2 where id = $1", [
        refundId,
        world.clock.now(),
      ]);
      // Still fresh: maybe in flight elsewhere, so nothing happens.
      expect((await world.refunds.sendRefund(refundId, at(1))).kind).toBe("skipped");
      expect((await world.refunds.sendRefund(refundId, at(3))).kind).toBe("unknown");
      expect(world.provider().refundCalls).toEqual([]);
      expect((await world.refundsOf(paymentId))[0]?.status).toBe("unknown");
    });

    it("a hanging refund call holds no database lock (the claim is committed first)", async () => {
      const { placed, paymentId, refundId } = await latePayment();
      const release = world.provider().hold("refund");
      const sending = world.refunds.sendRefund(refundId, at(0));
      for (let i = 0; i < 200 && world.provider().calls.refund === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const probe = await world.pool.connect();
      try {
        await probe.query("begin");
        await probe.query("select 1 from sales_order where id = $1 for update nowait", [placed.id]);
        await probe.query("select 1 from payment where id = $1 for update nowait", [paymentId]);
        await probe.query("select 1 from payment_refund where id = $1 for update nowait", [
          refundId,
        ]);
        await probe.query("rollback");
      } finally {
        probe.release();
        release();
      }
      expect((await sending).kind).toBe("answered");
    });

    it("two senders of one refund at once: exactly one provider call", async () => {
      const { paymentId, refundId } = await latePayment();
      const release = world.provider().hold("refund");
      const first = world.refunds.sendRefund(refundId, at(0));
      for (let i = 0; i < 200 && world.provider().calls.refund === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const second = await world.refunds.sendRefund(refundId, at(0));
      release();
      expect(second.kind).toBe("skipped");
      expect(await first).toEqual({ kind: "answered", status: "succeeded" });
      expect(world.provider().refundCalls).toHaveLength(1);
      expect((await world.refundsOf(paymentId))[0]?.status).toBe("succeeded");
    });

    it("admin refunds keep the cumulative limit under concurrency; a replay answers the same refund", async () => {
      const placed = await world.place([{ quantity: 1, price: 2_000 }]);
      const { paymentId, invoiceId } = await world.created(placed);
      world.provider().setStatus(invoiceId, "succeeded");
      await world.notify(invoiceId);
      const ask = (amount: number, key = randomUUID()) =>
        world.refunds.requestAdminRefund({
          paymentId,
          adminId: world.orders.ownerId,
          amount: { amount, currency: "UAH" },
          note: "Returned item",
          idempotencyKey: key,
          now: world.clock.now(),
        });
      const results = await Promise.all([ask(1_200), ask(1_200), ask(1_200)]);
      expect(results.map((result) => result.kind).sort()).toEqual([
        "refused",
        "refused",
        "requested",
      ]);
      expect(results.filter((result) => result.kind === "refused")).toEqual([
        { kind: "refused", reason: "refund_exceeds_remaining" },
        { kind: "refused", reason: "refund_exceeds_remaining" },
      ]);
      const key = randomUUID();
      const exact = await ask(800, key);
      expect(exact.kind).toBe("requested");
      expect(await ask(800, key)).toMatchObject({ kind: "requested", replay: true });
      expect(await ask(1)).toEqual({ kind: "refused", reason: "refund_exceeds_remaining" });
      expect(await ask(500, key)).toEqual({ kind: "idempotency_key_reused" });
      await world.job11(at(0));
      expect(await world.payment(paymentId)).toMatchObject({ refunded_amount: 2_000 });
      expect((await world.orderStatus(placed.id)).status).toBe("paid");
    });

    it("refuses a refund of an attempt that did not succeed", async () => {
      const placed = await world.place();
      const { paymentId } = await world.created(placed);
      expect(
        await world.refunds.requestAdminRefund({
          paymentId,
          adminId: null,
          amount: { amount: 1, currency: "UAH" },
          note: "x",
          idempotencyKey: randomUUID(),
          now: world.clock.now(),
        }),
      ).toEqual({ kind: "refused", reason: "refund_not_allowed" });
    });
  });

  describe("bounds", () => {
    it("stops at its time budget and reports truncated; what is left waits for the next run", async () => {
      await processing();
      await processing();
      let ticks = 0;
      const budget = new JobBudget(1, () => (ticks++ < 2 ? 0 : 10));
      const result = await world.job11(at(1), { budget });
      expect(result.truncated).toBe(true);
      expect(result.scanned).toBe(1);
      expect((await world.job11(at(1))).scanned).toBe(1);
    });

    it("pages through more due attempts than one page holds, oldest due first", async () => {
      for (let i = 0; i < 3; i += 1) {
        await processing();
      }
      const result = await world.job11(at(1), { batchSize: 2, maxBatches: 5 });
      expect(result).toMatchObject({ scanned: 3, polled: 3, truncated: false });
    });

    it("logs ids and codes only: no signature, body, card number, token or personal data", async () => {
      const logs = captureLogs();
      try {
        const { invoiceId } = await processing();
        world.provider().failNext({ operation: "getPayment", throws: true });
        await world.job11(at(1));
        world.provider().failNext({ operation: "refund", throws: true, afterEffect: true });
        await latePayment();
        await world.job11(at(1));
        await world.webhook(world.provider().webhookFor(invoiceId), {
          headers: { "x-test-signature": "f".repeat(64) },
        });
      } finally {
        logs.stop();
      }
      const text = logs.text();
      expect(text).toContain("threw error=Error");
      expect(text).not.toMatch(/4242424242424242|tok_secret|f{64}|buyer-|Хрещатик|\+380/);
      expect(text).not.toMatch(/"invoiceId"|cancelList|paymentInfo/);
    });
  });
});
