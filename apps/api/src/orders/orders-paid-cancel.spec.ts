import { randomUUID } from "node:crypto";
import type { MarkPaidRequest } from "@fluxkit/core";
import { Logger } from "@nestjs/common";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findPostgresError } from "../common/postgres-errors.js";
import { InventoryService } from "../inventory/admin/inventory.service.js";
import { ReservationsService } from "../inventory/reservations/reservations.service.js";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import {
  defaultLocationId,
  insertAdminUserRow,
  levelOf,
  movementsOf,
} from "../test/inventory-fixtures.js";
import { ensureMigrated } from "../test/migrate.js";
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
const PRICE = 1_000;

/*
 * ADR 0022: cancelling a PAID order releases the reservations that are still `active` (the held remainder of a
 * backordered line) and leaves the `committed` ones alone: sold units stay sold, no restock, no `return` movement.
 */
describe("cancelling a paid order releases the unsold, still active reservations (real Postgres)", () => {
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

  interface Line {
    variantId: string;
    productId: string;
    quantity: number;
  }
  interface Placed {
    number: string;
    id: string;
    total: number;
    lines: Line[];
  }

  /** A guest places an order of existing variants, in the given line order. */
  async function placeOn(lines: readonly Line[]): Promise<Placed> {
    const who = new Shopper(running.baseUrl);
    let total = 0;
    for (const line of lines) {
      const added = await who.post("/store/cart/items", {
        variantId: line.variantId,
        quantity: line.quantity,
      });
      expect(added.status, JSON.stringify(added.body)).toBe(200);
      total += line.quantity * PRICE;
    }
    const result = await checkoutAs(who, checkoutBody(total));
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    const number = placedOrders.track(result.body.order?.number ?? "");
    return { number, id: (await orderRow(pool, number)).id, total, lines: [...lines] };
  }

  interface Spec {
    quantity: number;
    onHand?: number;
    allowBackorder?: boolean;
    digital?: boolean;
  }

  async function place(specs: readonly Spec[]): Promise<Placed> {
    const lines: Line[] = [];
    for (const spec of specs) {
      const { variantId, productId } = await catalog.simple({
        trackInventory: spec.digital !== true,
        allowBackorder: spec.allowBackorder,
        onHand: spec.onHand ?? 50,
        price: PRICE,
        digital: spec.digital,
      });
      lines.push({ variantId, productId, quantity: spec.quantity });
    }
    return placeOn(lines);
  }

  const pay = (placed: Placed, reference = "PAY-1") =>
    service.markPaid(placed.id, {
      amount: { amount: placed.total, currency: "UAH" },
      providerReference: reference,
      source: "test",
    } satisfies MarkPaidRequest);

  const level = async (variantId: string) =>
    (await levelOf(pool, variantId, mainId)) ?? { on_hand: -1, reserved: -1 };

  const statusesOf = async (placed: Placed) =>
    (await reservationsOfOrder(pool, placed.id)).map((entry) => entry.status);

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

  it("a backordered remainder is released: reserved goes back, the sold unit stays sold, no extra movement", async () => {
    const placed = await place([{ quantity: 3, onHand: 1, allowBackorder: true }]);
    const variantId = placed.lines[0]?.variantId ?? "";
    expect(await pay(placed)).toMatchObject({ ok: true });
    expect(await level(variantId)).toEqual({ on_hand: 1, reserved: 3 });
    expect(await statusesOf(placed)).toEqual(["active"]);
    const movementsBefore = await movementsOf(pool, variantId);

    expect(await service.cancelAsAdmin(placed.id, adminId, "customer left")).toMatchObject({
      ok: true,
    });

    expect(await statusesOf(placed)).toEqual(["released"]);
    expect(await level(variantId)).toEqual({ on_hand: 1, reserved: 0 });
    const movementsAfter = await movementsOf(pool, variantId);
    expect(movementsAfter.filter((m) => m.kind === "return")).toEqual([]);
    expect(movementsAfter).toEqual(movementsBefore);
    expect(await changesOf(pool, placed.id)).toEqual([
      expect.objectContaining({ to_status: "awaiting_payment" }),
      expect.objectContaining({ to_status: "paid" }),
      {
        from_status: "paid",
        to_status: "cancelled",
        actor_type: "admin",
        actor_admin_id: adminId,
        reason: "customer left",
      },
    ]);
    expect(
      (await eventsOf(pool, placed.id)).filter((e) => e.type === "order.cancelled"),
    ).toHaveLength(1);
    expect(await service.cancelAsAdmin(placed.id, adminId, "twice")).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
  });

  it("a fully committed paid order: cancelling changes no stock at all", async () => {
    const placed = await place([{ quantity: 4 }, { quantity: 2 }]);
    expect(await pay(placed)).toMatchObject({ ok: true });
    const before = await Promise.all(
      placed.lines.map(async (line) => ({
        level: await level(line.variantId),
        movements: await movementsOf(pool, line.variantId),
      })),
    );
    expect(await statusesOf(placed)).toEqual(["committed", "committed"]);

    expect(await service.cancelAsAdmin(placed.id, adminId, "refunded by hand")).toMatchObject({
      ok: true,
    });

    expect(await statusesOf(placed)).toEqual(["committed", "committed"]);
    const after = await Promise.all(
      placed.lines.map(async (line) => ({
        level: await level(line.variantId),
        movements: await movementsOf(pool, line.variantId),
      })),
    );
    expect(after).toEqual(before);
    expect(after.map((entry) => entry.level)).toEqual([
      { on_hand: 46, reserved: 0 },
      { on_hand: 48, reserved: 0 },
    ]);
  });

  it("a mixed order: the committed line stays sold, the backordered remainder is released, the untracked line is untouched", async () => {
    const placed = await place([
      { quantity: 2 },
      { quantity: 3, onHand: 1, allowBackorder: true },
      { quantity: 1, digital: true },
    ]);
    expect(await pay(placed)).toMatchObject({ ok: true });
    const [soldLine, backorderLine] = placed.lines;
    const soldBefore = {
      level: await level(soldLine?.variantId ?? ""),
      movements: await movementsOf(pool, soldLine?.variantId ?? ""),
    };
    expect(await level(backorderLine?.variantId ?? "")).toEqual({ on_hand: 1, reserved: 3 });
    const held = await reservationsOfOrder(pool, placed.id);
    expect(held.map((entry) => entry.status).sort()).toEqual(["active", "committed"]);

    expect(await service.cancelAsAdmin(placed.id, adminId, "mixed")).toMatchObject({ ok: true });

    const statusByVariant = Object.fromEntries(
      (await reservationsOfOrder(pool, placed.id)).map((entry) => [entry.variant_id, entry.status]),
    );
    expect(statusByVariant).toEqual({
      [soldLine?.variantId ?? ""]: "committed",
      [backorderLine?.variantId ?? ""]: "released",
    });
    expect({
      level: await level(soldLine?.variantId ?? ""),
      movements: await movementsOf(pool, soldLine?.variantId ?? ""),
    }).toEqual(soldBefore);
    expect(await level(backorderLine?.variantId ?? "")).toEqual({ on_hand: 1, reserved: 0 });
    expect(
      (await movementsOf(pool, backorderLine?.variantId ?? "")).filter((m) => m.kind === "return"),
    ).toEqual([]);
  });

  it("a remainder that the sweep already expired is ignored, the cancel still succeeds", async () => {
    const placed = await place([{ quantity: 3, onHand: 1, allowBackorder: true }]);
    const variantId = placed.lines[0]?.variantId ?? "";
    await pay(placed);
    const swept = await reservations.expireDue(new Date(clock.now().getTime() + 400 * DAY));
    expect(swept.failures).toEqual([]);
    expect(await statusesOf(placed)).toEqual(["expired"]);
    const movementsBefore = await movementsOf(pool, variantId);
    expect(await level(variantId)).toEqual({ on_hand: 1, reserved: 0 });

    expect(await service.cancelAsAdmin(placed.id, adminId, "late")).toMatchObject({ ok: true });

    expect(await statusesOf(placed)).toEqual(["expired"]);
    expect(await level(variantId)).toEqual({ on_hand: 1, reserved: 0 });
    expect(await movementsOf(pool, variantId)).toEqual(movementsBefore);
  });

  it("orders with several backordered lines in crossing variant order, cancelled in parallel, never deadlock", async () => {
    const variants: Line[] = [];
    for (let index = 0; index < 4; index += 1) {
      const { variantId, productId } = await catalog.simple({
        trackInventory: true,
        allowBackorder: true,
        onHand: 1,
        price: PRICE,
      });
      variants.push({ variantId, productId, quantity: 2 });
    }
    const failures: unknown[] = [];
    // The service retries a deadlock once, which would hide an unsorted release: the retry is logged, so watch the log.
    const warnings = vi.spyOn(Logger.prototype, "warn");
    for (let round = 0; round < 15; round += 1) {
      const one = await placeOn(variants);
      const two = await placeOn([...variants].reverse());
      await pay(one, `X-${String(round)}-1`);
      await pay(two, `X-${String(round)}-2`);
      for (const variant of variants) {
        expect((await level(variant.variantId)).reserved).toBe(4);
      }
      const settled = await Promise.allSettled([
        service.cancelAsAdmin(one.id, adminId, "x"),
        service.cancelAsAdmin(two.id, adminId, "x"),
      ]);
      for (const outcome of settled) {
        if (outcome.status === "rejected") {
          failures.push(findPostgresError(outcome.reason)?.code ?? outcome.reason);
        } else {
          expect(outcome.value).toMatchObject({ ok: true });
        }
      }
      for (const variant of variants) {
        expect(await level(variant.variantId)).toEqual({ on_hand: 1, reserved: 0 });
      }
    }
    const deadlocks = warnings.mock.calls.filter((call) => String(call[0]).includes("40P01"));
    warnings.mockRestore();
    expect(deadlocks).toEqual([]);
    expect(failures).toEqual([]);
  });

  describe("races on a paid order with a backordered remainder", () => {
    /** Pays an order whose backordered line can be fulfilled once the stock is received. */
    async function paidAndStocked(round: number): Promise<Placed> {
      const placed = await place([{ quantity: 3, onHand: 1, allowBackorder: true }]);
      await pay(placed, `R-${String(round)}`);
      const line = placed.lines[0];
      await inventory.adjust(
        line?.productId ?? "",
        line?.variantId ?? "",
        { kind: "receipt", delta: 5 },
        null,
      );
      return placed;
    }

    it("admin cancel against fulfilment against the scheduler's expiry: exactly one winner, nothing committed late", async () => {
      const outcomes = new Set<string>();
      for (let round = 0; round < 14; round += 1) {
        const placed = await paidAndStocked(round);
        const variantId = placed.lines[0]?.variantId ?? "";
        const row = await orderRow(pool, placed.number);
        const [cancelled, fulfilled, expired] = await Promise.all([
          service.cancelAsAdmin(placed.id, adminId, "race"),
          service.markFulfilled(placed.id, { type: "admin", adminId }),
          service.expireOne(placed.id, new Date(row.expires_at.getTime() + MINUTE)),
        ]);
        expect(expired).toBe("not_due");
        expect([cancelled.ok, fulfilled.ok].sort()).toEqual([false, true]);
        const after = await orderRow(pool, placed.number);
        const sales = (await movementsOf(pool, variantId)).filter((m) => m.kind === "sale");
        if (cancelled.ok) {
          outcomes.add("cancelled");
          expect(fulfilled).toEqual({ ok: false, reason: "invalid_transition" });
          expect(after.status).toBe("cancelled");
          expect(await statusesOf(placed)).toEqual(["released"]);
          expect(await level(variantId)).toEqual({ on_hand: 6, reserved: 0 });
          expect(sales).toEqual([]);
        } else {
          outcomes.add("fulfilled");
          expect(cancelled).toEqual({ ok: false, reason: "invalid_transition" });
          expect(after.status).toBe("fulfilled");
          expect(await statusesOf(placed)).toEqual(["committed"]);
          expect(await level(variantId)).toEqual({ on_hand: 3, reserved: 0 });
          expect(sales).toHaveLength(1);
        }
        const events = (await eventsOf(pool, placed.id)).map((event) => event.type);
        expect(events).toEqual(["order.placed", "order.paid", `order.${after.status}`]);
      }
      expect(outcomes.size).toBeGreaterThan(0);
    });

    it("after fulfilment a cancel is invalid_transition and releases nothing; after a cancel a fulfilment is invalid_transition and commits nothing", async () => {
      const first = await paidAndStocked(100);
      const firstVariant = first.lines[0]?.variantId ?? "";
      expect(await service.markFulfilled(first.id, { type: "admin", adminId })).toMatchObject({
        ok: true,
      });
      expect(await service.cancelAsAdmin(first.id, adminId, "too late")).toEqual({
        ok: false,
        reason: "invalid_transition",
      });
      expect(await statusesOf(first)).toEqual(["committed"]);
      expect(await level(firstVariant)).toEqual({ on_hand: 3, reserved: 0 });

      const second = await paidAndStocked(101);
      const secondVariant = second.lines[0]?.variantId ?? "";
      expect(await service.cancelAsAdmin(second.id, adminId, "first")).toMatchObject({ ok: true });
      expect(await service.markFulfilled(second.id, { type: "admin", adminId })).toEqual({
        ok: false,
        reason: "invalid_transition",
      });
      expect(await statusesOf(second)).toEqual(["released"]);
      expect(await level(secondVariant)).toEqual({ on_hand: 6, reserved: 0 });
      expect((await movementsOf(pool, secondVariant)).filter((m) => m.kind === "sale")).toEqual([]);
      expect(await service.cancelAsAdmin(randomUUID(), adminId, "x")).toEqual({
        ok: false,
        reason: "not_found",
      });
    });
  });
});
