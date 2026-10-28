import type { MarkPaidRequest } from "@fluxkit/core";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { withTransaction } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
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

/** A marker error that rolls the caller's transaction back. */
class RollBack extends Error {}

/**
 * `markPaidIn` (ADR 0032 decision 7): the in-transaction part of `markPaid`, so a payment attempt and its order commit or
 * roll back TOGETHER. The rules themselves are `markPaid`'s (orders-service.spec.ts covers them through `markPaid`, which
 * now delegates to `markPaidIn`); this file proves that the caller's transaction is used and the order row is locked.
 */
describe("OrdersService.markPaidIn: the caller's transaction (real Postgres)", () => {
  const clock = new FakeClock(new Date("2037-04-01T08:00:00.000Z"));
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const placedOrders = new PlacedOrders(pool);
  let running: RunningApp;
  let service: OrdersService;
  let database: Database;

  async function place(): Promise<{ id: string; number: string; total: number }> {
    const who = new Shopper(running.baseUrl);
    const { variantId } = await catalog.simple({ trackInventory: true, onHand: 10, price: 2_500 });
    const added = await who.post("/store/cart/items", { variantId, quantity: 2 });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    const result = await checkoutAs(who, checkoutBody(5_000));
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    const number = placedOrders.track(result.body.order?.number ?? "");
    return { id: (await orderRow(pool, number)).id, number, total: 5_000 };
  }

  const request = (total: number, reference = "fake:inv-1"): MarkPaidRequest => ({
    amount: { amount: total, currency: "UAH" },
    providerReference: reference,
    source: "fake",
  });

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      clock,
      rateLimits: { checkout: { maxAttempts: 100_000, windowMinutes: 10 } },
    });
    service = running.app.get(OrdersService);
    database = running.app.get<Database>(DRIZZLE);
    await catalog.init();
  });

  afterEach(async () => {
    await placedOrders.cleanup();
  });

  afterAll(async () => {
    await running.app.close();
    await catalog.cleanup();
    await pool.end();
  });

  it("pays inside the caller's transaction: a rollback of the caller leaves the order, its stock and its outbox untouched", async () => {
    const placed = await place();
    await expect(
      withTransaction(database, async (tx) => {
        const outcome = await service.markPaidIn(tx, placed.id, request(placed.total), {
          type: "system",
        });
        expect(outcome).toEqual({ ok: true, orderId: placed.id, alreadyPaid: false });
        throw new RollBack("the caller fails after markPaidIn answered");
      }),
    ).rejects.toBeInstanceOf(RollBack);
    expect((await orderRow(pool, placed.number)).status).toBe("awaiting_payment");
    expect((await reservationsOfOrder(pool, placed.id)).map((entry) => entry.status)).toEqual([
      "active",
    ]);
    expect((await eventsOf(pool, placed.id)).map((event) => event.type)).toEqual(["order.placed"]);
    expect(await changesOf(pool, placed.id)).toHaveLength(1);
  });

  it("commits with the caller: the order is paid with the reference, its stock committed and order.paid written", async () => {
    const placed = await place();
    const outcome = await withTransaction(database, (tx) =>
      service.markPaidIn(tx, placed.id, request(placed.total, "fake:inv-2"), { type: "system" }),
    );
    expect(outcome).toEqual({ ok: true, orderId: placed.id, alreadyPaid: false });
    expect(await orderRow(pool, placed.number)).toMatchObject({
      status: "paid",
      payment_reference: "fake:inv-2",
    });
    expect((await reservationsOfOrder(pool, placed.id)).map((entry) => entry.status)).toEqual([
      "committed",
    ]);
    expect((await eventsOf(pool, placed.id)).map((event) => event.type)).toEqual([
      "order.placed",
      "order.paid",
    ]);
    // The same reference again inside another transaction is idempotent; another one is a conflict.
    await expect(
      withTransaction(database, (tx) =>
        service.markPaidIn(tx, placed.id, request(placed.total, "fake:inv-2"), { type: "system" }),
      ),
    ).resolves.toEqual({ ok: true, orderId: placed.id, alreadyPaid: true });
    await expect(
      withTransaction(database, (tx) =>
        service.markPaidIn(tx, placed.id, request(placed.total, "fake:inv-3"), { type: "system" }),
      ),
    ).resolves.toEqual({ ok: false, reason: "payment_reference_conflict" });
  });

  it("holds the order row lock until the caller's transaction ends", async () => {
    const placed = await place();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let answered: () => void = () => undefined;
    const paid = new Promise<void>((resolve) => {
      answered = resolve;
    });
    const transaction = withTransaction(database, async (tx) => {
      await service.markPaidIn(tx, placed.id, request(placed.total), { type: "system" });
      answered();
      await held;
    });
    await paid;
    const probe = await pool.connect();
    try {
      await probe.query("begin");
      await expect(
        probe.query("select 1 from sales_order where id = $1 for update nowait", [placed.id]),
      ).rejects.toMatchObject({ code: "55P03" });
      await probe.query("rollback");
    } finally {
      probe.release();
      release();
    }
    await transaction;
    expect((await orderRow(pool, placed.number)).status).toBe("paid");
  });

  it("answers the refusals of markPaid: an amount that is not the total changes nothing", async () => {
    const placed = await place();
    await expect(
      withTransaction(database, (tx) =>
        service.markPaidIn(tx, placed.id, request(placed.total - 1), { type: "system" }),
      ),
    ).resolves.toEqual({ ok: false, reason: "amount_mismatch" });
    expect((await orderRow(pool, placed.number)).status).toBe("awaiting_payment");
  });
});
