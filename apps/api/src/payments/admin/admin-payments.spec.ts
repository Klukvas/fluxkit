import { randomUUID } from "node:crypto";
import { permissionsOf } from "@fluxkit/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startApp, type RunningApp } from "../../test/app.js";
import { deepKeys } from "../../test/cart-helpers.js";
import { http, type HttpResult } from "../../test/http.js";
import { PaymentWorld } from "../../test/payment-world.js";
import { captureLogs } from "../../test/shipping-fixtures.js";
import {
  TEST_PAYMENT_PROVIDER_CODE,
  TestPaymentProvider,
} from "../../test/test-payment-provider.js";
import type { ProblemBody } from "../../common/problem.filter.js";
import { PaymentCreateService } from "../payment-create.service.js";
import { PaymentProviderRegistry } from "../registry/index.js";
import type {
  AdminPayment,
  AdminPaymentList,
  AdminPaymentPage,
  AdminRefundResult,
} from "./admin-payments.schemas.js";

/** The problem members a spec reads next to a success shape. */
type Problem = Partial<Pick<ProblemBody, "code" | "detail" | "errors" | "rule">>;

const HIGH = { maxAttempts: 100_000, windowMinutes: 10 };

/** Keys that must never appear in an admin payment answer, at any depth (ADR 0032 decisions 1, 5 and 14). */
const FORBIDDEN_KEYS = [
  "redirectUrl",
  "redirect_url",
  "idempotencyKey",
  "idempotency_key",
  "dedupeKey",
  "dedupe_key",
  "checkAttempts",
  "maskedPan",
  "pan",
  "token",
];

/**
 * The admin payment routes (ADR 0032 decisions 11, 13 and 18; plan step 8): the permission walk of every route, refunds
 * (limits under concurrency, idempotency, lost answers, the order status untouched), resync, the attention list and its
 * clear, redaction and logs. Real Postgres and the in-repo test provider (one instance per app).
 */
describe("payments: admin routes (real Postgres)", () => {
  let world: PaymentWorld;

  beforeAll(async () => {
    world = await PaymentWorld.start({
      rateLimits: {
        checkout: HIGH,
        paymentCreate: HIGH,
        paymentStatus: HIGH,
        paymentRefund: HIGH,
        paymentResync: HIGH,
      },
    });
  });

  beforeEach(() => {
    world.resetProvider();
    world.clock.advanceMinutes(1);
  });

  afterAll(async () => {
    await world.stop();
  });

  const providerOf = (running: RunningApp): TestPaymentProvider =>
    running.app.get(PaymentProviderRegistry).get(TEST_PAYMENT_PROVIDER_CODE) as TestPaymentProvider;

  /** An order and an attempt made through `running` (its own provider instance), optionally paid by a signed webhook. */
  async function attempt(
    running: RunningApp,
    options: { pay?: boolean; price?: number } = {},
  ): Promise<{ orderId: string; paymentId: string; invoiceId: string; total: number }> {
    const placed = await world.place([{ quantity: 1, price: options.price ?? 2_000 }]);
    const result = await running.app.get(PaymentCreateService).createPaymentForOrder({
      orderId: placed.id,
      idempotencyKey: randomUUID(),
      createdBy: "guest",
    });
    if (result.kind !== "created") {
      throw new Error(`no attempt: ${JSON.stringify(result)}`);
    }
    const row = await world.payment(result.payment.paymentId);
    const invoiceId = row.provider_payment_id ?? "";
    if (options.pay === true) {
      providerOf(running).setStatus(invoiceId, "succeeded");
      const answer = await world.webhook(providerOf(running).webhookFor(invoiceId), { running });
      expect(answer.status, answer.text).toBe(200);
    }
    return { orderId: placed.id, paymentId: row.id, invoiceId, total: placed.total };
  }

  function refund(
    running: RunningApp,
    target: { orderId: string; paymentId: string },
    body: unknown,
    options: { key?: string | null; csrf?: boolean } = {},
  ): Promise<HttpResult<AdminRefundResult & Problem>> {
    const key = options.key === undefined ? randomUUID() : options.key;
    return http(
      running.baseUrl,
      "POST",
      `/admin/orders/${target.orderId}/payments/${target.paymentId}/refunds`,
      { body, csrf: options.csrf, headers: key === null ? {} : { "idempotency-key": key } },
    );
  }

  const uah = (amount: number) => ({ amount, currency: "UAH" as const });

  describe("permissions", () => {
    it("payments.refund belongs to owner and manager, never to the viewer; the viewer holds no order permission either", () => {
      expect(permissionsOf("owner")).toContain("payments.refund");
      expect(permissionsOf("manager")).toContain("payments.refund");
      expect(permissionsOf("viewer")).not.toContain("payments.refund");
      expect(permissionsOf("viewer")).not.toContain("orders.read");
    });

    interface Route {
      name: string;
      write: boolean;
      success: number;
      call: (running: RunningApp, csrf?: boolean) => Promise<HttpResult<unknown>>;
    }

    /** The app whose provider makes the attempt: the one under test when it may act, else the owner's. */
    const maker = (running: RunningApp) =>
      running === world.orders.viewer || running === world.orders.anonymous
        ? world.orders.owner
        : running;

    const routes: Route[] = [
      {
        name: "GET /admin/orders/:id/payments (orders.read)",
        write: false,
        success: 200,
        call: async (running, csrf) => {
          const made = await attempt(maker(running));
          return http(running.baseUrl, "GET", `/admin/orders/${made.orderId}/payments`, { csrf });
        },
      },
      {
        name: "POST /admin/orders/:id/payments/:paymentId/refunds (payments.refund)",
        write: true,
        success: 202,
        call: async (running, csrf) => {
          const made = await attempt(maker(running), { pay: true });
          return refund(running, made, { amount: uah(500), note: "Returned" }, { csrf });
        },
      },
      {
        name: "POST /admin/orders/:id/payments/:paymentId/resync (orders.write)",
        write: true,
        success: 200,
        call: async (running, csrf) => {
          const made = await attempt(maker(running));
          return http(
            running.baseUrl,
            "POST",
            `/admin/orders/${made.orderId}/payments/${made.paymentId}/resync`,
            { csrf },
          );
        },
      },
      {
        name: "GET /admin/payments (orders.read)",
        write: false,
        success: 200,
        call: (running, csrf) =>
          http(running.baseUrl, "GET", "/admin/payments?needsAttention=true", { csrf }),
      },
      {
        name: "POST /admin/payments/:paymentId/attention/clear (payments.refund)",
        write: true,
        success: 200,
        call: async (running, csrf) => {
          const made = await attempt(maker(running));
          return http(
            running.baseUrl,
            "POST",
            `/admin/payments/${made.paymentId}/attention/clear`,
            { csrf },
          );
        },
      },
    ];

    it.each(routes)(
      "$name: 401 anonymous, 403 viewer, 403 without the CSRF header on a write, success for manager and owner",
      async (route) => {
        expect((await route.call(world.orders.anonymous)).status, "anonymous").toBe(401);
        const viewer = await route.call(world.orders.viewer);
        expect(viewer.status, "viewer").toBe(403);
        expect(viewer.body).toMatchObject({ code: "forbidden" });
        if (route.write) {
          expect((await route.call(world.orders.manager, false)).status, "no CSRF header").toBe(
            403,
          );
        }
        const manager = await route.call(world.orders.manager);
        expect(manager.status, `manager ${JSON.stringify(manager.body)}`).toBe(route.success);
        const owner = await route.call(world.orders.owner);
        expect(owner.status, `owner ${JSON.stringify(owner.body)}`).toBe(route.success);
      },
    );

    it("a refused refund (viewer, no CSRF header) stores nothing and calls no provider", async () => {
      const made = await attempt(world.orders.owner, { pay: true });
      expect(
        (await refund(world.orders.viewer, made, { amount: uah(500), note: "x" })).status,
      ).toBe(403);
      expect(
        (await refund(world.orders.owner, made, { amount: uah(500), note: "x" }, { csrf: false }))
          .status,
      ).toBe(403);
      expect(await world.refundsOf(made.paymentId)).toEqual([]);
      expect(world.provider().refundCalls).toHaveLength(0);
    });
  });

  describe("refunds", () => {
    it("a full refund: 202 with the succeeded refund and the payment; the order stays paid; the event is written", async () => {
      const made = await attempt(world.app, { pay: true });
      expect((await world.orderStatus(made.orderId)).status).toBe("paid");
      const answer = await refund(world.orders.owner, made, {
        amount: uah(2_000),
        note: "  Customer returned the parcel  ",
      });
      expect(answer.status, JSON.stringify(answer.body)).toBe(202);
      expect(answer.headers.get("cache-control")).toBe("no-store");
      expect(answer.body.refund).toMatchObject({
        amount: uah(2_000),
        status: "succeeded",
        reason: "admin",
        note: "Customer returned the parcel",
        actorAdminId: world.orders.ownerId,
        failureCode: null,
      });
      expect(answer.body.payment).toMatchObject({
        id: made.paymentId,
        status: "succeeded",
        refundedAmount: uah(2_000),
        refundableAmount: uah(0),
      });
      expect(world.provider().refundCalls).toEqual([
        expect.objectContaining({
          providerPaymentId: made.invoiceId,
          refundId: answer.body.refund.id,
          amount: uah(2_000),
          full: true,
        }),
      ]);
      // A refund never changes the order status (owner answer 3).
      expect((await world.orderStatus(made.orderId)).status).toBe("paid");
      expect(await world.eventTypes(answer.body.refund.id)).toEqual([
        "payment.refund_status_changed",
      ]);
    });

    it("partial refunds up to exactly the paid amount; one minor unit more is 409 refund_exceeds_remaining", async () => {
      const made = await attempt(world.app, { pay: true });
      expect((await refund(world.orders.owner, made, { amount: uah(700), note: "a" })).status).toBe(
        202,
      );
      const over = await refund(world.orders.owner, made, { amount: uah(1_301), note: "b" });
      expect(over.status).toBe(409);
      expect(over.body).toMatchObject({ code: "rule_violation", rule: "refund_exceeds_remaining" });
      const rest = await refund(world.orders.owner, made, { amount: uah(1_300), note: "c" });
      expect(rest.status).toBe(202);
      expect(rest.body.payment).toMatchObject({
        refundedAmount: uah(2_000),
        refundableAmount: uah(0),
      });
      const after = await refund(world.orders.owner, made, { amount: uah(1), note: "d" });
      expect(after.body).toMatchObject({ rule: "refund_exceeds_remaining" });
      expect(world.provider().refundCalls).toHaveLength(2);
    });

    it("refuses a payment that did not succeed (409 refund_not_allowed), another order's payment (404) and bad input (400)", async () => {
      const open = await attempt(world.app);
      const notAllowed = await refund(world.orders.owner, open, { amount: uah(1), note: "x" });
      expect(notAllowed.status).toBe(409);
      expect(notAllowed.body).toMatchObject({ rule: "refund_not_allowed" });

      const paid = await attempt(world.app, { pay: true });
      const other = await attempt(world.app);
      expect(
        (
          await refund(
            world.orders.owner,
            { orderId: other.orderId, paymentId: paid.paymentId },
            {
              amount: uah(1),
              note: "x",
            },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await refund(
            world.orders.owner,
            { orderId: paid.orderId, paymentId: randomUUID() },
            {
              amount: uah(1),
              note: "x",
            },
          )
        ).status,
      ).toBe(404);

      const bad = async (body: unknown, key?: string | null) =>
        (await refund(world.orders.owner, paid, body, { key })).body;
      expect(await bad({ amount: uah(1), note: "x" }, null)).toMatchObject({
        code: "validation_failed",
        errors: [{ path: "Idempotency-Key", code: "idempotency_key_required" }],
      });
      expect(await bad({ amount: uah(1), note: "x" }, "not-a-uuid")).toMatchObject({
        code: "validation_failed",
      });
      expect(await bad({ amount: uah(0), note: "x" })).toMatchObject({ code: "validation_failed" });
      expect(await bad({ amount: uah(-5), note: "x" })).toMatchObject({
        code: "validation_failed",
      });
      expect(await bad({ amount: { amount: 1.5, currency: "UAH" }, note: "x" })).toMatchObject({
        code: "validation_failed",
      });
      expect(await bad({ amount: { amount: 1, currency: "EUR" }, note: "x" })).toMatchObject({
        code: "validation_failed",
        errors: [{ path: "amount.currency", code: "currency_mismatch" }],
      });
      expect(await bad({ amount: uah(1), note: "   " })).toMatchObject({
        code: "validation_failed",
      });
      expect(await bad({ amount: uah(1), note: "x".repeat(501) })).toMatchObject({
        code: "validation_failed",
      });
      expect(await bad({ amount: uah(1), note: "x", reason: "late_payment" })).toMatchObject({
        code: "validation_failed",
      });
      expect(await world.refundsOf(paid.paymentId)).toEqual([]);
      expect(world.provider().refundCalls).toHaveLength(0);
    });

    it("the same Idempotency-Key and body answers the same refund (200) without a second call; another body is 409 idempotency_key_reused", async () => {
      const made = await attempt(world.app, { pay: true });
      const key = randomUUID();
      const first = await refund(
        world.orders.owner,
        made,
        { amount: uah(600), note: "same" },
        { key },
      );
      expect(first.status).toBe(202);
      const again = await refund(
        world.orders.manager,
        made,
        { amount: uah(600), note: "same" },
        {
          key: key.toUpperCase(),
        },
      );
      expect(again.status).toBe(200);
      expect(again.body.refund.id).toBe(first.body.refund.id);
      const changed = await refund(
        world.orders.owner,
        made,
        { amount: uah(601), note: "same" },
        { key },
      );
      expect(changed.status).toBe(409);
      expect(changed.body).toMatchObject({ code: "idempotency_key_reused" });
      const otherNote = await refund(
        world.orders.owner,
        made,
        { amount: uah(600), note: "other" },
        {
          key,
        },
      );
      expect(otherNote.body).toMatchObject({ code: "idempotency_key_reused" });
      expect(await world.refundsOf(made.paymentId)).toHaveLength(1);
      expect(
        world.provider(world.orders.owner).refundCalls.length +
          world.provider(world.orders.manager).refundCalls.length,
      ).toBe(1);
    });

    it("refunds at once that together exceed what was paid: exactly one refund is accepted and sent", async () => {
      const made = await attempt(world.app, { pay: true });
      const answers = await Promise.all([
        refund(world.orders.owner, made, { amount: uah(1_200), note: "owner" }),
        refund(world.orders.owner, made, { amount: uah(1_200), note: "owner too" }),
        refund(world.orders.owner, made, { amount: uah(1_200), note: "owner again" }),
      ]);
      expect(answers.map((answer) => answer.status).sort()).toEqual([202, 409, 409]);
      for (const refused of answers.filter((answer) => answer.status === 409)) {
        expect(refused.body).toMatchObject({ rule: "refund_exceeds_remaining" });
      }
      const rows = await world.refundsOf(made.paymentId);
      expect(rows).toHaveLength(1);
      expect(await world.payment(made.paymentId)).toMatchObject({ refunded_amount: 1_200 });
    });

    it("a lost answer leaves the refund unknown (202), raises attention and is never sent again, also on a replay", async () => {
      const made = await attempt(world.app, { pay: true });
      world.provider().failNext({ operation: "refund", reason: "unavailable", afterEffect: true });
      const key = randomUUID();
      const lost = await refund(
        world.orders.owner,
        made,
        { amount: uah(2_000), note: "x" },
        { key },
      );
      expect(lost.status, JSON.stringify(lost.body)).toBe(202);
      expect(lost.body.refund.status).toBe("unknown");
      expect(lost.body.payment).toMatchObject({ refundableAmount: uah(0), refundedAmount: uah(0) });
      const replay = await refund(
        world.orders.owner,
        made,
        { amount: uah(2_000), note: "x" },
        { key },
      );
      expect(replay.status).toBe(200);
      expect(replay.body.refund).toMatchObject({ id: lost.body.refund.id, status: "unknown" });
      // Nothing more can be refunded while the unknown refund is open.
      expect(
        (await refund(world.orders.owner, made, { amount: uah(1), note: "y" })).body,
      ).toMatchObject({ rule: "refund_exceeds_remaining" });
      expect(world.provider().refundCalls).toHaveLength(1);
      // The provider shows it in its refund list: a status read settles it, no call.
      await world.job11(new Date(world.clock.now().getTime() + 60 * 60_000));
      expect((await world.refundsOf(made.paymentId))[0]?.status).toBe("succeeded");
      expect(world.provider().refundCalls).toHaveLength(1);
    });

    it("a throttled provider leaves the refund requested for job 11; a refused one fails with its code", async () => {
      const throttled = await attempt(world.app, { pay: true });
      world
        .provider()
        .failNext({ operation: "refund", reason: "rate_limited", retryAfterSeconds: 5 });
      const waiting = await refund(world.orders.owner, throttled, { amount: uah(300), note: "x" });
      expect(waiting.status).toBe(202);
      expect(waiting.body.refund.status).toBe("requested");

      const refused = await attempt(world.app, { pay: true });
      world.provider().failNext({
        operation: "refund",
        reason: "not_cancellable",
        providerCodes: ["CANCEL_NOT_AVAILABLE"],
      });
      const failed = await refund(world.orders.owner, refused, { amount: uah(300), note: "x" });
      expect(failed.status).toBe(202);
      expect(failed.body.refund).toMatchObject({ status: "failed" });
      expect(failed.body.payment).toMatchObject({ needsAttention: true });
      // A failed refund frees its amount again.
      expect(failed.body.payment.refundableAmount).toEqual(uah(2_000));
    });
  });

  describe("resync", () => {
    const resync = (running: RunningApp, made: { orderId: string; paymentId: string }) =>
      http<AdminPayment & Problem>(
        running.baseUrl,
        "POST",
        `/admin/orders/${made.orderId}/payments/${made.paymentId}/resync`,
      );

    it("reads the provider once and applies the fact: a success pays the order; job 11's schedule is left alone", async () => {
      const made = await attempt(world.app);
      const before = await world.payment(made.paymentId);
      world.provider().setStatus(made.invoiceId, "processing");
      const processing = await resync(world.orders.owner, made);
      expect(processing.status).toBe(200);
      expect(processing.body).toMatchObject({ id: made.paymentId, status: "processing" });
      world.provider().setStatus(made.invoiceId, "succeeded");
      const paid = await resync(world.orders.owner, made);
      expect(paid.body).toMatchObject({ status: "succeeded", orderOutcome: "applied" });
      expect((await world.orderStatus(made.orderId)).status).toBe("paid");
      expect(world.provider().calls.getPayment).toBe(2);
      expect(before.check_attempts).toBe(0);
      expect((await world.payment(made.paymentId)).check_attempts).toBe(0);
    });

    it("a provider failure is 503 payment_provider_unavailable with Retry-After and changes nothing", async () => {
      const made = await attempt(world.app);
      world.provider().failNext({ operation: "getPayment", reason: "unavailable" });
      const failed = await resync(world.orders.owner, made);
      expect(failed.status).toBe(503);
      expect(failed.body).toMatchObject({ code: "payment_provider_unavailable" });
      expect(Number(failed.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
      world
        .provider()
        .failNext({ operation: "getPayment", reason: "rate_limited", retryAfterSeconds: 7 });
      const throttled = await resync(world.orders.owner, made);
      expect(throttled.headers.get("retry-after")).toBe("7");
      expect(await world.payment(made.paymentId)).toMatchObject({ status: "awaiting_customer" });
    });

    it("an attempt without a provider id has nothing to read (200 as stored, no call); another order's attempt is 404", async () => {
      const placed = await world.place();
      world.provider().failNext({ operation: "createPayment", reason: "unavailable" });
      const lost = await world.create(placed);
      expect(lost.kind).toBe("provider_unavailable");
      if (lost.kind !== "provider_unavailable") return;
      const answer = await resync(world.orders.owner, {
        orderId: placed.id,
        paymentId: lost.payment.paymentId,
      });
      expect(answer.status).toBe(200);
      expect(answer.body).toMatchObject({ status: "create_unknown", providerPaymentId: null });
      expect(world.provider().calls.getPayment).toBe(0);
      const other = await attempt(world.app);
      expect(
        (
          await resync(world.orders.owner, {
            orderId: other.orderId,
            paymentId: lost.payment.paymentId,
          })
        ).status,
      ).toBe(404);
    });
  });

  describe("attention list and clear", () => {
    /** A success the order could not take because the amounts disagree: attention, no automatic refund. */
    async function mismatch(): Promise<{ orderId: string; paymentId: string }> {
      const made = await attempt(world.app);
      world.provider().override(made.invoiceId, { amount: uah(1) });
      world.provider().setStatus(made.invoiceId, "succeeded");
      await world.notify(made.invoiceId);
      expect(await world.payment(made.paymentId)).toMatchObject({ needs_attention: true });
      return made;
    }

    it("lists open items newest first with keyset paging, and clearing one journals the admin and keeps the code", async () => {
      const first = await mismatch();
      // Attempts are stamped with the (fake) clock: a later one is newer.
      world.clock.advanceMinutes(1);
      const second = await mismatch();
      const page1 = await http<AdminPaymentPage & Problem>(
        world.orders.owner.baseUrl,
        "GET",
        "/admin/payments?needsAttention=true&limit=1",
      );
      expect(page1.status).toBe(200);
      expect(page1.body.items).toHaveLength(1);
      expect(page1.body.items[0]).toMatchObject({
        orderId: second.orderId,
        payment: { id: second.paymentId, needsAttention: true },
      });
      expect(typeof page1.body.items[0]?.orderNumber).toBe("string");
      expect(page1.body.nextCursor).toEqual(expect.any(String));
      const page2 = await http<AdminPaymentPage & Problem>(
        world.orders.owner.baseUrl,
        "GET",
        `/admin/payments?needsAttention=true&limit=1&cursor=${encodeURIComponent(page1.body.nextCursor ?? "")}`,
      );
      expect(page2.body.items[0]).toMatchObject({ payment: { id: first.paymentId } });

      const cleared = await http<AdminPayment & Problem>(
        world.orders.manager.baseUrl,
        "POST",
        `/admin/payments/${second.paymentId}/attention/clear`,
      );
      expect(cleared.status).toBe(200);
      expect(cleared.body).toMatchObject({
        needsAttention: false,
        attentionCode: "amount_mismatch",
      });
      expect(cleared.body.history.at(-1)).toMatchObject({
        source: "admin",
        action: "attention_cleared",
        actorAdminId: world.orders.managerId,
        fromStatus: null,
        toStatus: null,
      });
      const events = await world.eventsOf(second.paymentId);
      expect(events.filter((event) => event.source === "admin")).toHaveLength(1);
      const again = await http<AdminPayment & Problem>(
        world.orders.owner.baseUrl,
        "POST",
        `/admin/payments/${second.paymentId}/attention/clear`,
        { body: {} },
      );
      expect(again.status).toBe(200);
      expect(
        (await world.eventsOf(second.paymentId)).filter((event) => event.source === "admin"),
      ).toHaveLength(1);
      const open = await http<AdminPaymentPage>(
        world.orders.owner.baseUrl,
        "GET",
        "/admin/payments?needsAttention=true&limit=100",
      );
      expect(open.body.items.map((item) => item.payment.id)).not.toContain(second.paymentId);
    });

    it("refuses a misspelt filter, a damaged cursor, a body on the clear and an unknown payment", async () => {
      const get = (query: string) =>
        http<Problem>(world.orders.owner.baseUrl, "GET", `/admin/payments${query}`);
      expect((await get("?needsattention=true")).status).toBe(400);
      expect((await get("?needsAttention=yes")).status).toBe(400);
      expect((await get("?limit=0")).status).toBe(400);
      const damaged = await get("?cursor=not-a-cursor");
      expect(damaged.status).toBe(400);
      expect(damaged.body).toMatchObject({ errors: [{ path: "cursor", code: "invalid_cursor" }] });
      const made = await attempt(world.app);
      expect(
        (
          await http(
            world.orders.owner.baseUrl,
            "POST",
            `/admin/payments/${made.paymentId}/attention/clear`,
            {
              body: { note: "x" },
            },
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await http(
            world.orders.owner.baseUrl,
            "POST",
            `/admin/payments/${randomUUID()}/attention/clear`,
          )
        ).status,
      ).toBe(404);
    });
  });

  describe("views", () => {
    it("the order's payments and GET /admin/orders/:id show the same redacted view: card system and last 4 only, no page URL, keys or counters", async () => {
      const open = await attempt(world.app);
      const paid = await attempt(world.app, { pay: true });
      for (const made of [open, paid]) {
        const list = await http<AdminPaymentList>(
          world.orders.owner.baseUrl,
          "GET",
          `/admin/orders/${made.orderId}/payments`,
        );
        expect(list.status).toBe(200);
        expect(list.headers.get("cache-control")).toBe("no-store");
        const detail = await world.orders.detail(made.orderId);
        expect(detail.body.payments).toEqual(list.body.items);
        const keys = [...deepKeys(list.body)];
        for (const forbidden of FORBIDDEN_KEYS) {
          expect(keys, forbidden).not.toContain(forbidden);
        }
        const text = JSON.stringify(list.body);
        expect(text).not.toContain("pay.test.invalid");
      }
      const view = (
        await http<AdminPaymentList>(
          world.orders.owner.baseUrl,
          "GET",
          `/admin/orders/${paid.orderId}/payments`,
        )
      ).body.items[0];
      expect(view?.card).toEqual({ system: "visa", last4: "4242" });
      expect(view).toMatchObject({ providerCode: "fake", providerPaymentId: paid.invoiceId });
      expect(
        (await http(world.orders.owner.baseUrl, "GET", `/admin/orders/${randomUUID()}/payments`))
          .status,
      ).toBe(404);
    });

    it("logs no card data, tokens or provider text when the provider throws during a refund or a resync", async () => {
      const made = await attempt(world.app, { pay: true });
      const logs = captureLogs();
      try {
        world.provider().failNext({ operation: "refund", throws: true });
        expect(
          (await refund(world.orders.owner, made, { amount: uah(100), note: "x" })).status,
        ).toBe(202);
        world.provider().failNext({ operation: "getPayment", throws: true });
        expect(
          (
            await http(
              world.orders.owner.baseUrl,
              "POST",
              `/admin/orders/${made.orderId}/payments/${made.paymentId}/resync`,
            )
          ).status,
        ).toBe(503);
      } finally {
        logs.stop();
      }
      expect(logs.text()).not.toMatch(/4242424242424242|tok_secret/);
    });
  });
});

describe("payments: admin routes with no payment provider (real Postgres)", () => {
  let running: RunningApp;
  let world: PaymentWorld;

  beforeAll(async () => {
    world = await PaymentWorld.start();
    running = await startApp({});
  });

  afterAll(async () => {
    await running.app.close();
    await world.stop();
  });

  it("the admin reads still work: the order's payments (with the attempts made earlier) and the attention list", async () => {
    const placed = await world.place();
    const { paymentId } = await world.created(placed);
    const list = await http<AdminPaymentList>(
      running.baseUrl,
      "GET",
      `/admin/orders/${placed.id}/payments`,
    );
    expect(list.status).toBe(200);
    expect(list.body.items.map((item) => item.id)).toEqual([paymentId]);
    expect((await http(running.baseUrl, "GET", "/admin/payments")).status).toBe(200);
    const resync = await http<Problem>(
      running.baseUrl,
      "POST",
      `/admin/orders/${placed.id}/payments/${paymentId}/resync`,
    );
    expect(resync.status).toBe(409);
    expect(resync.body).toMatchObject({ rule: "payment_not_available" });
  });
});

describe("payments: admin rate limits (real Postgres)", () => {
  let running: RunningApp;

  beforeAll(async () => {
    running = await startApp({
      rateLimits: {
        paymentRefund: { maxAttempts: 2, windowMinutes: 10 },
        paymentResync: { maxAttempts: 2, windowMinutes: 10 },
      },
    });
  });

  afterAll(async () => {
    await running.app.close();
  });

  it("limits refunds and resyncs per admin user (429 with Retry-After), counted before anything is looked up", async () => {
    const order = randomUUID();
    const payment = randomUUID();
    for (const action of ["refunds", "resync"]) {
      const statuses: number[] = [];
      let last: HttpResult<unknown> | undefined;
      for (let index = 0; index < 3; index += 1) {
        last = await http(
          running.baseUrl,
          "POST",
          `/admin/orders/${order}/payments/${payment}/${action}`,
          {
            body:
              action === "refunds"
                ? { amount: { amount: 1, currency: "UAH" }, note: "x" }
                : undefined,
            headers: { "idempotency-key": randomUUID() },
          },
        );
        statuses.push(last.status);
      }
      expect(statuses, action).toEqual([404, 404, 429]);
      expect(Number(last?.headers.get("retry-after"))).toBeGreaterThan(0);
    }
  });
});
