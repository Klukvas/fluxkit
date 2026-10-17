import { randomUUID } from "node:crypto";
import {
  ORDER_PAYMENTS_PORT,
  type MarkPaidOutcome,
  type MarkPaidRequest,
  type OrderPaymentsPort,
} from "@fluxkit/core";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findPostgresError } from "../common/postgres-errors.js";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import {
  insertAdminUserRow,
  levelOf,
  movementsOf,
  defaultLocationId,
} from "../test/inventory-fixtures.js";
import { ensureMigrated } from "../test/migrate.js";
import { InventoryService } from "../inventory/admin/inventory.service.js";
import { ReservationsService } from "../inventory/reservations/reservations.service.js";
import { PlacedOrders } from "../test/order-fixtures.js";
import {
  changesOf,
  checkoutAs,
  checkoutBody,
  eventsOf,
  orderRow,
  reservationsOfOrder,
} from "../test/order-http.js";
import { Shopper } from "../test/shopper.js";
import { OrdersService } from "./orders.service.js";

const START = new Date("2037-03-01T08:00:00.000Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe("OrdersService: transitions, markPaid, cancels, expiry (real Postgres)", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const placedOrders = new PlacedOrders(pool);
  let running: RunningApp;
  let service: OrdersService;
  let reservations: ReservationsService;
  let inventory: InventoryService;
  let adminId = "";
  let mainId = "";

  interface Placed {
    number: string;
    id: string;
    total: number;
    lines: { variantId: string; productId: string; quantity: number }[];
  }

  /** A guest places an order of the given lines; `price` and tracking come from the line. */
  async function place(
    lines: {
      quantity: number;
      price?: number;
      onHand?: number;
      allowBackorder?: boolean;
      digital?: boolean;
    }[],
  ): Promise<Placed> {
    const who = new Shopper(running.baseUrl);
    const made: Placed["lines"] = [];
    let total = 0;
    for (const line of lines) {
      const { variantId, productId } = await catalog.simple({
        trackInventory: line.digital !== true,
        allowBackorder: line.allowBackorder,
        onHand: line.onHand ?? 50,
        price: line.price ?? 1_000,
        digital: line.digital,
      });
      const added = await who.post("/store/cart/items", { variantId, quantity: line.quantity });
      expect(added.status, JSON.stringify(added.body)).toBe(200);
      total += line.quantity * (line.price ?? 1_000);
      made.push({ variantId, productId, quantity: line.quantity });
    }
    const result = await checkoutAs(who, checkoutBody(total));
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    const number = placedOrders.track(result.body.order?.number ?? "");
    return { number, id: (await orderRow(pool, number)).id, total, lines: made };
  }

  const request = (
    placed: Placed,
    reference = "PAY-1",
    amount = placed.total,
  ): MarkPaidRequest => ({
    amount: { amount, currency: "UAH" },
    providerReference: reference,
    source: "test",
  });

  const level = async (variantId: string) =>
    (await levelOf(pool, variantId, mainId)) ?? { on_hand: -1, reserved: -1 };

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      rateLimits: { checkout: { maxAttempts: 100_000, windowMinutes: 10 } },
    });
    service = running.app.get(OrdersService);
    reservations = running.app.get(ReservationsService, { strict: false });
    inventory = running.app.get(InventoryService, { strict: false });
    adminId = await insertAdminUserRow(pool);
    mainId = await defaultLocationId(pool);
    await catalog.init();
  });

  beforeEach(() => {
    clock.advanceMinutes(11);
  });

  afterEach(async () => {
    await placedOrders.cleanup();
  });

  afterAll(async () => {
    await running.app.close();
    await catalog.cleanup();
    await pool.query("delete from admin_user where id = $1", [adminId]);
    await pool.end();
  });

  describe("markPaid", () => {
    it("pays an awaiting order: commits the stock, records the sale, the journal, the reference and the event", async () => {
      const placed = await place([{ quantity: 2 }, { quantity: 3, price: 700 }]);
      const paidAt = clock.now();
      const outcome = await service.markPaid(placed.id, request(placed, "BANK-42"), {
        type: "admin",
        adminId,
      });
      expect(outcome).toEqual({ ok: true, orderId: placed.id, alreadyPaid: false });

      const row = await orderRow(pool, placed.number);
      expect(row).toMatchObject({ status: "paid", payment_reference: "BANK-42" });
      expect(row.paid_at).toEqual(paidAt);
      for (const line of placed.lines) {
        expect(await level(line.variantId)).toEqual({ on_hand: 50 - line.quantity, reserved: 0 });
        const sales = (await movementsOf(pool, line.variantId)).filter((m) => m.kind === "sale");
        expect(sales).toEqual([
          expect.objectContaining({
            delta: -line.quantity,
            on_hand_after: 50 - line.quantity,
            reference: placed.number,
            actor_id: adminId,
          }),
        ]);
      }
      expect((await reservationsOfOrder(pool, row.id)).map((entry) => entry.status)).toEqual([
        "committed",
        "committed",
      ]);
      expect(await changesOf(pool, row.id)).toEqual([
        expect.objectContaining({ from_status: null, to_status: "awaiting_payment" }),
        {
          from_status: "awaiting_payment",
          to_status: "paid",
          actor_type: "admin",
          actor_admin_id: adminId,
          reason: null,
        },
      ]);
      const events = await eventsOf(pool, row.id);
      expect(events.map((event) => event.type)).toEqual(["order.placed", "order.paid"]);
      expect(events[1]?.payload).toEqual({
        orderId: row.id,
        orderNumber: row.number,
        status: "paid",
      });
    });

    it("records a payment made by the system (a plugin) without an acting admin", async () => {
      const placed = await place([{ quantity: 1 }]);
      const port = running.app.get<OrderPaymentsPort>(ORDER_PAYMENTS_PORT);
      expect(port).toBe(service);
      const outcome: MarkPaidOutcome = await port.markPaid(placed.id, request(placed));
      expect(outcome).toMatchObject({ ok: true, alreadyPaid: false });
      const row = await orderRow(pool, placed.number);
      expect((await changesOf(pool, row.id))[1]).toMatchObject({
        actor_type: "system",
        actor_admin_id: null,
      });
      const [sale] = (await movementsOf(pool, placed.lines[0]?.variantId ?? "")).filter(
        (m) => m.kind === "sale",
      );
      expect(sale?.actor_id).toBeNull();
    });

    it("an order of digital goods has nothing to commit and is paid all the same", async () => {
      const placed = await place([{ quantity: 2, digital: true }]);
      expect(await service.markPaid(placed.id, request(placed))).toMatchObject({ ok: true });
      expect((await orderRow(pool, placed.number)).status).toBe("paid");
    });

    it("is idempotent: the same reference again is ok and changes nothing, also once fulfilled", async () => {
      const placed = await place([{ quantity: 2 }]);
      await service.markPaid(placed.id, request(placed, "REF-A"));
      const row = await orderRow(pool, placed.number);
      const again = await service.markPaid(placed.id, request(placed, "REF-A"));
      expect(again).toEqual({ ok: true, orderId: placed.id, alreadyPaid: true });
      expect(await changesOf(pool, row.id)).toHaveLength(2);
      expect(await eventsOf(pool, row.id)).toHaveLength(2);
      const variantId = placed.lines[0]?.variantId ?? "";
      expect((await movementsOf(pool, variantId)).filter((m) => m.kind === "sale")).toHaveLength(1);
      expect(await level(variantId)).toEqual({ on_hand: 48, reserved: 0 });

      expect(await service.markFulfilled(placed.id, { type: "admin", adminId })).toMatchObject({
        ok: true,
      });
      expect(await service.markPaid(placed.id, request(placed, "REF-A"))).toMatchObject({
        ok: true,
        alreadyPaid: true,
      });
    });

    it("another reference on a paid order is payment_reference_conflict", async () => {
      const placed = await place([{ quantity: 1 }]);
      await service.markPaid(placed.id, request(placed, "REF-A"));
      expect(await service.markPaid(placed.id, request(placed, "REF-B"))).toEqual({
        ok: false,
        reason: "payment_reference_conflict",
      });
      expect((await orderRow(pool, placed.number)).payment_reference).toBe("REF-A");
    });

    it.each([
      ["less", -1],
      ["more", 1],
      ["zero", 0],
    ])(
      "refuses an amount that is %s than the total: amount_mismatch, nothing changes",
      async (name, delta) => {
        const placed = await place([{ quantity: 2 }]);
        const amount = name === "zero" ? 0 : placed.total + delta;
        expect(await service.markPaid(placed.id, request(placed, "PAY-X", amount))).toEqual({
          ok: false,
          reason: "amount_mismatch",
        });
        const row = await orderRow(pool, placed.number);
        expect(row.status).toBe("awaiting_payment");
        expect(row.payment_reference).toBeNull();
        expect(await level(placed.lines[0]?.variantId ?? "")).toEqual({ on_hand: 50, reserved: 2 });
        expect(await changesOf(pool, row.id)).toHaveLength(1);
      },
    );

    it("refuses the right amount in another currency, and a wrong amount on an already paid order", async () => {
      const placed = await place([{ quantity: 1 }]);
      expect(
        await service.markPaid(placed.id, {
          amount: { amount: placed.total, currency: "USD" },
          providerReference: "P",
          source: "test",
        }),
      ).toEqual({ ok: false, reason: "amount_mismatch" });
      await service.markPaid(placed.id, request(placed, "P"));
      expect(await service.markPaid(placed.id, request(placed, "P", placed.total + 5))).toEqual({
        ok: false,
        reason: "amount_mismatch",
      });
    });

    it("refuses a cancelled or an expired order with order_not_payable and changes nothing", async () => {
      const cancelled = await place([{ quantity: 1 }]);
      await service.cancelAsAdmin(cancelled.id, adminId, "customer asked");
      expect(await service.markPaid(cancelled.id, request(cancelled))).toEqual({
        ok: false,
        reason: "order_not_payable",
      });
      const expired = await place([{ quantity: 1 }]);
      const row = await orderRow(pool, expired.number);
      await service.expireOne(row.id, new Date(row.expires_at.getTime() + 1));
      expect(await service.markPaid(expired.id, request(expired))).toEqual({
        ok: false,
        reason: "order_not_payable",
      });
      for (const placed of [cancelled, expired]) {
        const after = await orderRow(pool, placed.number);
        expect(after.paid_at).toBeNull();
        expect(after.payment_reference).toBeNull();
        expect(await level(placed.lines[0]?.variantId ?? "")).toEqual({ on_hand: 50, reserved: 0 });
      }
    });

    it("answers order_not_found for an unknown id, and throws for an unusable reference", async () => {
      const placed = await place([{ quantity: 1 }]);
      expect(await service.markPaid(randomUUID(), request(placed))).toEqual({
        ok: false,
        reason: "order_not_found",
      });
      await expect(service.markPaid(placed.id, request(placed, ""))).rejects.toThrow(RangeError);
      await expect(service.markPaid(placed.id, request(placed, "x".repeat(256)))).rejects.toThrow(
        RangeError,
      );
      expect((await orderRow(pool, placed.number)).status).toBe("awaiting_payment");
    });

    it("still pays an order past its expiry that the job has not expired yet (the stock is still held)", async () => {
      const placed = await place([{ quantity: 1 }]);
      const row = await orderRow(pool, placed.number);
      clock.set(new Date(row.expires_at.getTime() + 2 * MINUTE));
      expect(await service.markPaid(placed.id, request(placed))).toMatchObject({ ok: true });
    });

    it("when the generic sweep already expired a reservation the order is not payable and nothing is committed", async () => {
      const placed = await place([{ quantity: 1 }, { quantity: 2 }]);
      const row = await orderRow(pool, placed.number);
      const held = await reservationsOfOrder(pool, row.id);
      await pool.query("update reservation set expires_at = '2000-01-01' where id = $1", [
        held[0]?.id,
      ]);
      await reservations.expireDue(new Date("2001-01-01"));
      expect(await service.markPaid(placed.id, request(placed))).toEqual({
        ok: false,
        reason: "order_not_payable",
      });
      expect((await orderRow(pool, placed.number)).status).toBe("awaiting_payment");
      for (const line of placed.lines) {
        expect((await movementsOf(pool, line.variantId)).filter((m) => m.kind === "sale")).toEqual(
          [],
        );
      }
    });
  });

  describe("backorder lines of a paid order (owner quiz 2026-10-17)", () => {
    it("commits what is on hand, holds the rest for 365 days, and fulfilment waits for the stock", async () => {
      const placed = await place([
        { quantity: 2 },
        { quantity: 3, onHand: 1, allowBackorder: true },
      ]);
      const paidAt = clock.now();
      expect(
        await service.markPaid(placed.id, request(placed, "PAY"), { type: "system" }),
      ).toMatchObject({
        ok: true,
      });
      const [onHandLine, backorderLine] = placed.lines;
      expect(await level(onHandLine?.variantId ?? "")).toEqual({ on_hand: 48, reserved: 0 });
      expect(await level(backorderLine?.variantId ?? "")).toEqual({ on_hand: 1, reserved: 3 });
      const row = await orderRow(pool, placed.number);
      const held = await reservationsOfOrder(pool, row.id);
      expect(held.map((entry) => entry.status)).toEqual(["committed", "active"]);
      expect(held[1]?.expires_at).toEqual(new Date(paidAt.getTime() + 365 * DAY));
      expect(row.status).toBe("paid");

      // Fulfilment is refused until the stock arrives; the order and the stock stay as they are.
      expect(await service.markFulfilled(placed.id, { type: "admin", adminId })).toEqual({
        ok: false,
        reason: "awaiting_stock",
      });
      expect((await orderRow(pool, placed.number)).status).toBe("paid");
      expect(await level(backorderLine?.variantId ?? "")).toEqual({ on_hand: 1, reserved: 3 });

      await inventory.adjust(
        backorderLine?.productId ?? "",
        backorderLine?.variantId ?? "",
        { kind: "receipt", delta: 5 },
        null,
      );
      const fulfilled = await service.markFulfilled(placed.id, { type: "admin", adminId });
      expect(fulfilled).toMatchObject({ ok: true });
      expect(await level(backorderLine?.variantId ?? "")).toEqual({ on_hand: 3, reserved: 0 });
      const after = await orderRow(pool, placed.number);
      expect(after.status).toBe("fulfilled");
      expect(after.fulfilled_at).not.toBeNull();
      expect((await reservationsOfOrder(pool, row.id)).map((entry) => entry.status)).toEqual([
        "committed",
        "committed",
      ]);
      expect((await eventsOf(pool, row.id)).map((event) => event.type)).toEqual([
        "order.placed",
        "order.paid",
        "order.fulfilled",
      ]);
      expect(
        (await movementsOf(pool, backorderLine?.variantId ?? "")).filter((m) => m.kind === "sale"),
      ).toEqual([
        expect.objectContaining({ delta: -3, reference: placed.number, actor_id: adminId }),
      ]);
      // Terminal: nothing leaves fulfilled.
      expect(await service.markFulfilled(placed.id, { type: "admin", adminId })).toEqual({
        ok: false,
        reason: "invalid_transition",
      });
    });

    it("fulfils an order that was fully on hand at payment without touching the stock again", async () => {
      const placed = await place([{ quantity: 2 }]);
      await service.markPaid(placed.id, request(placed));
      const before = await level(placed.lines[0]?.variantId ?? "");
      expect(await service.markFulfilled(placed.id, { type: "system" })).toMatchObject({
        ok: true,
      });
      expect(await level(placed.lines[0]?.variantId ?? "")).toEqual(before);
    });

    it("an order that is not paid can not be fulfilled", async () => {
      const placed = await place([{ quantity: 1 }]);
      expect(await service.markFulfilled(placed.id, { type: "admin", adminId })).toEqual({
        ok: false,
        reason: "invalid_transition",
      });
      expect(await service.markFulfilled(randomUUID(), { type: "admin", adminId })).toEqual({
        ok: false,
        reason: "not_found",
      });
    });
  });

  describe("cancellation by an admin", () => {
    it("cancels an unpaid order with a reason: stock is released, the reason is stored and journaled", async () => {
      const placed = await place([{ quantity: 4 }]);
      const result = await service.cancelAsAdmin(placed.id, adminId, "  out of the shop's range  ");
      expect(result).toMatchObject({ ok: true });
      const row = await orderRow(pool, placed.number);
      expect(row).toMatchObject({
        status: "cancelled",
        cancellation_reason: "out of the shop's range",
      });
      expect(await level(placed.lines[0]?.variantId ?? "")).toEqual({ on_hand: 50, reserved: 0 });
      expect((await changesOf(pool, row.id))[1]).toEqual({
        from_status: "awaiting_payment",
        to_status: "cancelled",
        actor_type: "admin",
        actor_admin_id: adminId,
        reason: "out of the shop's range",
      });
    });

    it("cancels a PAID order too, but sold units stay sold (no automatic restock)", async () => {
      const placed = await place([{ quantity: 4 }]);
      await service.markPaid(placed.id, request(placed));
      expect(await service.cancelAsAdmin(placed.id, adminId, "refunded by hand")).toMatchObject({
        ok: true,
      });
      expect((await orderRow(pool, placed.number)).status).toBe("cancelled");
      expect(await level(placed.lines[0]?.variantId ?? "")).toEqual({ on_hand: 46, reserved: 0 });
      expect(
        (await movementsOf(pool, placed.lines[0]?.variantId ?? "")).filter(
          (m) => m.kind === "return",
        ),
      ).toEqual([]);
    });

    it("refuses a terminal order, an unknown order and an empty or oversized reason", async () => {
      const placed = await place([{ quantity: 1 }]);
      await service.cancelAsAdmin(placed.id, adminId, "once");
      expect(await service.cancelAsAdmin(placed.id, adminId, "twice")).toEqual({
        ok: false,
        reason: "invalid_transition",
      });
      expect(await service.cancelAsAdmin(randomUUID(), adminId, "x")).toEqual({
        ok: false,
        reason: "not_found",
      });
      await expect(service.cancelAsAdmin(placed.id, adminId, "  ")).rejects.toThrow(RangeError);
      await expect(service.cancelAsAdmin(placed.id, adminId, "x".repeat(501))).rejects.toThrow(
        RangeError,
      );
    });
  });

  describe("expireOne", () => {
    it("expires a due order, releases the stock and records the system as the actor", async () => {
      const placed = await place([{ quantity: 3 }]);
      const row = await orderRow(pool, placed.number);
      expect(await service.expireOne(row.id, new Date(row.expires_at.getTime() - 1))).toBe(
        "not_due",
      );
      expect(await service.expireOne(row.id, row.expires_at)).toBe("expired");
      const after = await orderRow(pool, placed.number);
      expect(after.status).toBe("expired");
      expect(after.expired_at).not.toBeNull();
      expect(await level(placed.lines[0]?.variantId ?? "")).toEqual({ on_hand: 50, reserved: 0 });
      expect((await changesOf(pool, row.id))[1]).toMatchObject({
        to_status: "expired",
        actor_type: "system",
      });
      expect((await eventsOf(pool, row.id)).map((event) => event.type)).toEqual([
        "order.placed",
        "order.expired",
      ]);
      expect(await service.expireOne(row.id, row.expires_at)).toBe("not_due");
      expect(await service.expireOne(randomUUID(), row.expires_at)).toBe("not_found");
    });

    it("leaves a paid or cancelled order alone", async () => {
      const paid = await place([{ quantity: 1 }]);
      await service.markPaid(paid.id, request(paid));
      const row = await orderRow(pool, paid.number);
      expect(await service.expireOne(paid.id, new Date(row.expires_at.getTime() + DAY))).toBe(
        "not_due",
      );
      expect((await orderRow(pool, paid.number)).status).toBe("paid");
    });

    it("an order whose reservation the sweep already released can still be expired (nothing left to give back)", async () => {
      const placed = await place([{ quantity: 2 }]);
      const row = await orderRow(pool, placed.number);
      const [held] = await reservationsOfOrder(pool, row.id);
      await pool.query("update reservation set expires_at = '2000-01-01' where id = $1", [
        held?.id,
      ]);
      await reservations.expireDue(new Date("2001-01-01"));
      expect(await service.expireOne(row.id, row.expires_at)).toBe("expired");
      expect(await level(placed.lines[0]?.variantId ?? "")).toEqual({ on_hand: 50, reserved: 0 });
    });
  });

  describe("races on one order: exactly one winner, stock consistent", () => {
    it("markPaid against cancel, many rounds", async () => {
      const outcomes = { paid: 0, cancelled: 0 };
      for (let round = 0; round < 12; round += 1) {
        const placed = await place([{ quantity: 2 }, { quantity: 1 }]);
        const [paid, cancelled] = await Promise.all([
          service.markPaid(placed.id, request(placed, `R-${String(round)}`)),
          service.cancelAsAdmin(placed.id, adminId, "race"),
        ]);
        const row = await orderRow(pool, placed.number);
        if (row.status === "paid") {
          outcomes.paid += 1;
          expect(paid).toMatchObject({ ok: true });
          // The cancel came second and was allowed by the table (paid -> cancelled is admin only).
          expect(cancelled).toMatchObject({ ok: true });
        }
        expect(["paid", "cancelled"]).toContain(row.status);
        if (row.status === "cancelled") {
          outcomes.cancelled += 1;
        }
        for (const line of placed.lines) {
          const now = await level(line.variantId);
          expect(now.reserved).toBe(0);
          expect(now.on_hand).toBeLessThanOrEqual(50);
        }
      }
      expect(outcomes.paid + outcomes.cancelled).toBe(12);
    });

    it("markPaid against the expiry job: one decides, the other sees it", async () => {
      for (let round = 0; round < 12; round += 1) {
        const placed = await place([{ quantity: 2 }]);
        const row = await orderRow(pool, placed.number);
        const [paid, expired] = await Promise.all([
          service.markPaid(placed.id, request(placed, `E-${String(round)}`)),
          service.expireOne(placed.id, new Date(row.expires_at.getTime() + 1)),
        ]);
        const after = await orderRow(pool, placed.number);
        const variantId = placed.lines[0]?.variantId ?? "";
        if (after.status === "paid") {
          expect(paid).toMatchObject({ ok: true });
          expect(expired).toBe("not_due");
          expect(await level(variantId)).toEqual({ on_hand: 48, reserved: 0 });
        } else {
          expect(after.status).toBe("expired");
          expect(paid).toEqual({ ok: false, reason: "order_not_payable" });
          expect(expired).toBe("expired");
          expect(await level(variantId)).toEqual({ on_hand: 50, reserved: 0 });
        }
        expect(await changesOf(pool, row.id)).toHaveLength(2);
        expect(await eventsOf(pool, row.id)).toHaveLength(2);
      }
    });

    it("two payments with the same reference commit once; with different references one wins and one conflicts", async () => {
      const placed = await place([{ quantity: 2 }]);
      const same = await Promise.all(
        Array.from({ length: 6 }, () => service.markPaid(placed.id, request(placed, "SAME"))),
      );
      expect(same.filter((outcome) => outcome.ok && !outcome.alreadyPaid)).toHaveLength(1);
      expect(same.every((outcome) => outcome.ok)).toBe(true);
      const variantId = placed.lines[0]?.variantId ?? "";
      expect((await movementsOf(pool, variantId)).filter((m) => m.kind === "sale")).toHaveLength(1);
      expect(await level(variantId)).toEqual({ on_hand: 48, reserved: 0 });

      const other = await place([{ quantity: 1 }]);
      const [one, two] = await Promise.all([
        service.markPaid(other.id, request(other, "ONE")),
        service.markPaid(other.id, request(other, "TWO")),
      ]);
      expect([one.ok, two.ok].sort()).toEqual([false, true]);
      expect([one, two].find((outcome) => !outcome.ok)).toEqual({
        ok: false,
        reason: "payment_reference_conflict",
      });
    });

    it("two orders with crossing lines are cancelled and paid in parallel without a deadlock", async () => {
      const a = await catalog.simple({ trackInventory: true, onHand: 1000, price: 100 });
      const b = await catalog.simple({ trackInventory: true, onHand: 1000, price: 100 });
      const failures: unknown[] = [];
      for (let round = 0; round < 15; round += 1) {
        const first = new Shopper(running.baseUrl);
        const second = new Shopper(running.baseUrl);
        await first.post("/store/cart/items", { variantId: a.variantId, quantity: 1 });
        await first.post("/store/cart/items", { variantId: b.variantId, quantity: 1 });
        await second.post("/store/cart/items", { variantId: b.variantId, quantity: 1 });
        await second.post("/store/cart/items", { variantId: a.variantId, quantity: 1 });
        const one = await checkoutAs(first, checkoutBody(200));
        const two = await checkoutAs(second, checkoutBody(200));
        const ids = [one, two].map((result) => placedOrders.track(result.body.order?.number ?? ""));
        const rows = await Promise.all(ids.map((number) => orderRow(pool, number)));
        const settled = await Promise.allSettled([
          round % 2 === 0
            ? service.cancelAsAdmin(rows[0]?.id ?? "", adminId, "x")
            : service.markPaid(rows[0]?.id ?? "", {
                amount: { amount: 200, currency: "UAH" },
                providerReference: `D-${String(round)}-1`,
                source: "t",
              }),
          round % 2 === 0
            ? service.cancelAsAdmin(rows[1]?.id ?? "", adminId, "x")
            : service.markPaid(rows[1]?.id ?? "", {
                amount: { amount: 200, currency: "UAH" },
                providerReference: `D-${String(round)}-2`,
                source: "t",
              }),
        ]);
        for (const outcome of settled) {
          if (outcome.status === "rejected") {
            failures.push(findPostgresError(outcome.reason)?.code ?? outcome.reason);
          }
        }
      }
      expect(failures).toEqual([]);
      expect((await level(a.variantId)).reserved).toBe(0);
      expect((await level(b.variantId)).reserved).toBe(0);
    });
  });
});
