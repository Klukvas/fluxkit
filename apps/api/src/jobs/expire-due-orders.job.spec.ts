import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { defaultLocationId, levelOf } from "../test/inventory-fixtures.js";
import { ensureMigrated } from "../test/migrate.js";
import { OrderMaker, type MadeOrder } from "../test/order-maker.js";
import { PlacedOrders } from "../test/order-fixtures.js";
import { changesOf, eventsOf, orderRow, reservationsOfOrder } from "../test/order-http.js";
import { OrdersService } from "../orders/orders.service.js";
import { expireDueOrders, type ExpireOrdersDeps } from "./expire-due-orders.job.js";
import { JobBudget } from "./job-budget.js";
import { JobsRepository } from "./jobs.repository.js";

// 2025 is before every timestamp other specs leave behind, so this spec's jobs only ever see its own rows.
const START = new Date("2025-03-01T08:00:00.000Z");
const MINUTE = 60_000;

describe("expireDueOrders (real Postgres, injected time)", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const placedOrders = new PlacedOrders(pool);
  let running: RunningApp;
  let maker: OrderMaker;
  let deps: ExpireOrdersDeps;
  let orders: OrdersService;
  let mainId = "";

  const level = async (variantId: string) =>
    (await levelOf(pool, variantId, mainId)) ?? { on_hand: -1, reserved: -1 };

  /** The instant by which every given order is due. */
  async function dueAt(made: MadeOrder[]): Promise<Date> {
    const rows = await Promise.all(made.map((order) => orderRow(pool, order.number)));
    return new Date(Math.max(...rows.map((row) => row.expires_at.getTime())));
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      rateLimits: { checkout: { maxAttempts: 100_000, windowMinutes: 10 } },
    });
    maker = new OrderMaker(catalog, placedOrders, pool, () => running.baseUrl);
    orders = running.app.get(OrdersService);
    deps = {
      database: running.app.get<Database>(DRIZZLE),
      repository: running.app.get(JobsRepository),
      orders,
    };
    mainId = await defaultLocationId(pool);
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

  it("does nothing when no order is due", async () => {
    expect(await expireDueOrders(deps, START)).toEqual({
      scanned: 0,
      expired: 0,
      deferred: 0,
      notDue: 0,
      failures: [],
      truncated: false,
    });
  });

  it("expires an order at exactly its expiry (not a millisecond before), gives the stock back and records history and the event", async () => {
    const order = await maker.place([{ quantity: 3 }, { quantity: 2 }]);
    const row = await orderRow(pool, order.number);
    expect(await expireDueOrders(deps, new Date(row.expires_at.getTime() - 1))).toMatchObject({
      scanned: 0,
      expired: 0,
    });
    expect((await orderRow(pool, order.number)).status).toBe("awaiting_payment");
    for (const line of order.lines) {
      expect((await level(line.variantId)).reserved).toBe(line.quantity);
    }

    const result = await expireDueOrders(deps, row.expires_at);
    expect(result).toEqual({
      scanned: 1,
      expired: 1,
      deferred: 0,
      notDue: 0,
      failures: [],
      truncated: false,
    });

    const after = await orderRow(pool, order.number);
    expect(after.status).toBe("expired");
    expect(after.expired_at?.toISOString()).toBe(row.expires_at.toISOString());
    for (const line of order.lines) {
      expect(await level(line.variantId)).toEqual({ on_hand: 50, reserved: 0 });
    }
    expect((await reservationsOfOrder(pool, order.id)).map((held) => held.status)).toEqual([
      "released",
      "released",
    ]);
    expect((await changesOf(pool, order.id)).map((change) => change.to_status)).toEqual([
      "awaiting_payment",
      "expired",
    ]);
    expect((await changesOf(pool, order.id))[1]).toMatchObject({ actor_type: "system" });
    expect((await eventsOf(pool, order.id)).map((event) => event.type)).toEqual([
      "order.placed",
      "order.expired",
    ]);
  });

  it("is idempotent: a second run finds nothing and changes nothing", async () => {
    const order = await maker.place([{ quantity: 1 }]);
    const due = await dueAt([order]);
    await expireDueOrders(deps, due);
    const events = await eventsOf(pool, order.id);
    expect(await expireDueOrders(deps, due)).toMatchObject({ scanned: 0, expired: 0 });
    expect(await eventsOf(pool, order.id)).toEqual(events);
    expect(await changesOf(pool, order.id)).toHaveLength(2);
  });

  it("leaves paid and cancelled orders alone", async () => {
    const paid = await maker.place([{ quantity: 1 }]);
    const cancelled = await maker.place([{ quantity: 1 }]);
    await orders.markPaid(paid.id, {
      amount: { amount: paid.total, currency: "UAH" },
      providerReference: "PAY-1",
      source: "test",
    });
    await orders.cancelAsGuest(cancelled.number, cancelled.accessToken);
    const result = await expireDueOrders(deps, await dueAt([paid, cancelled]));
    expect(result).toMatchObject({ scanned: 0, expired: 0 });
    expect((await orderRow(pool, paid.number)).status).toBe("paid");
    expect((await orderRow(pool, cancelled.number)).status).toBe("cancelled");
  });

  it("expires many orders across pages, also when the count is an exact multiple of the page size", async () => {
    const four: MadeOrder[] = [];
    for (let index = 0; index < 4; index += 1) {
      clock.advanceMinutes(1);
      four.push(await maker.place([{ quantity: 1 }]));
    }
    const result = await expireDueOrders(deps, await dueAt(four), { batchSize: 2 });
    expect(result).toEqual({
      scanned: 4,
      expired: 4,
      deferred: 0,
      notDue: 0,
      failures: [],
      truncated: false,
    });
    for (const order of four) {
      expect((await orderRow(pool, order.number)).status).toBe("expired");
      expect(await level(order.lines[0]?.variantId ?? "")).toEqual({ on_hand: 50, reserved: 0 });
    }
  });

  it("stops at the page limit, says so, and the next run finishes the rest", async () => {
    const five: MadeOrder[] = [];
    for (let index = 0; index < 5; index += 1) {
      clock.advanceMinutes(1);
      five.push(await maker.place([{ quantity: 1 }]));
    }
    const due = await dueAt(five);
    const first = await expireDueOrders(deps, due, { batchSize: 2, maxBatches: 2 });
    expect(first).toMatchObject({ scanned: 4, expired: 4, truncated: true });
    const second = await expireDueOrders(deps, due, { batchSize: 2, maxBatches: 2 });
    expect(second).toMatchObject({ scanned: 1, expired: 1, truncated: false });
  });

  it("expires the oldest orders first", async () => {
    const early = await maker.place([{ quantity: 1 }]);
    clock.advanceMinutes(5);
    const late = await maker.place([{ quantity: 1 }]);
    const lateRow = await orderRow(pool, late.number);
    const first = await expireDueOrders(deps, lateRow.expires_at, { batchSize: 1, maxBatches: 1 });
    expect(first).toMatchObject({ scanned: 1, expired: 1, truncated: true });
    expect((await orderRow(pool, early.number)).status).toBe("expired");
    expect((await orderRow(pool, late.number)).status).toBe("awaiting_payment");
    await expireDueOrders(deps, lateRow.expires_at);
  });

  it("one failing order does not stop the others, is reported by number and error class only, and does not loop", async () => {
    const first = await maker.place([{ quantity: 1 }]);
    clock.advanceMinutes(1);
    const broken = await maker.place([{ quantity: 1 }]);
    clock.advanceMinutes(1);
    const last = await maker.place([{ quantity: 1 }]);
    const failing: ExpireOrdersDeps = {
      ...deps,
      orders: {
        expireOne: async (orderId, now) => {
          if (orderId === broken.id) {
            throw new TypeError("secret buyer@example.test detail in a message");
          }
          return orders.expireOne(orderId, now);
        },
      },
    };
    // A page of one: the failing order sits in the middle and the cursor must move past it.
    const result = await expireDueOrders(failing, await dueAt([first, broken, last]), {
      batchSize: 1,
    });
    expect(result).toMatchObject({ scanned: 3, expired: 2, notDue: 0, truncated: false });
    expect(result.failures).toEqual([
      { orderNumber: broken.number, error: "TypeError cause=TypeError" },
    ]);
    expect(JSON.stringify(result)).not.toContain("buyer@example.test");
    expect((await orderRow(pool, first.number)).status).toBe("expired");
    expect((await orderRow(pool, broken.number)).status).toBe("awaiting_payment");
    expect((await orderRow(pool, last.number)).status).toBe("expired");
    expect(await level(broken.lines[0]?.variantId ?? "")).toEqual({ on_hand: 50, reserved: 1 });
  });

  it("counts an order that a payment or cancellation got to first as notDue", async () => {
    const order = await maker.place([{ quantity: 1 }]);
    const racing: ExpireOrdersDeps = {
      ...deps,
      orders: {
        expireOne: async (orderId, now) => {
          await orders.cancelAsGuest(order.number, order.accessToken);
          return orders.expireOne(orderId, now);
        },
      },
    };
    const result = await expireDueOrders(racing, await dueAt([order]));
    expect(result).toMatchObject({ scanned: 1, expired: 0, notDue: 1, failures: [] });
    expect((await orderRow(pool, order.number)).status).toBe("cancelled");
  });

  it("stops starting orders when the time budget is used up, says so, and the next run finishes (one slow job cannot hold the tick)", async () => {
    const three: MadeOrder[] = [];
    for (let index = 0; index < 3; index += 1) {
      clock.advanceMinutes(1);
      three.push(await maker.place([{ quantity: 1 }]));
    }
    const due = await dueAt(three);
    let ticks = 0;
    // The first question (at construction) is the start; the next answers are 1 s later each, the budget is 1.5 s.
    const budget = new JobBudget(1_500, () => {
      ticks += 1;
      return ticks * 1_000;
    });
    const first = await expireDueOrders(deps, due, { budget });
    expect(first).toMatchObject({ scanned: 1, expired: 1, truncated: true });
    expect((await orderRow(pool, three[0]?.number ?? "")).status).toBe("expired");
    expect((await orderRow(pool, three[1]?.number ?? "")).status).toBe("awaiting_payment");
    expect(await expireDueOrders(deps, due)).toMatchObject({ expired: 2, truncated: false });
  });

  it("an order whose row a stuck writer holds fails within lock_timeout, is reported, and the others still expire", async () => {
    const stuck = await maker.place([{ quantity: 1 }]);
    clock.advanceMinutes(1);
    const free = await maker.place([{ quantity: 1 }]);
    const holder = await pool.connect();
    await holder.query("begin");
    await holder.query("select 1 from sales_order where id = $1 for update", [stuck.id]);
    const startedAt = Date.now();
    try {
      const result = await expireDueOrders(deps, await dueAt([stuck, free]), {
        limits: { statementTimeoutMs: 10_000, lockTimeoutMs: 300 },
      });
      expect(Date.now() - startedAt).toBeLessThan(5_000);
      expect(result).toMatchObject({ scanned: 2, expired: 1, truncated: false });
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.orderNumber).toBe(stuck.number);
    } finally {
      await holder.query("rollback");
      holder.release();
    }
    expect((await orderRow(pool, free.number)).status).toBe("expired");
    expect((await orderRow(pool, stuck.number)).status).toBe("awaiting_payment");
  });

  it("refuses a nonsensical limit", async () => {
    await expect(expireDueOrders(deps, START, { batchSize: 0 })).rejects.toThrow(RangeError);
    await expect(expireDueOrders(deps, START, { maxBatches: 0 })).rejects.toThrow(RangeError);
  });

  it("works on a clock-free `now`: the real time of the machine plays no part", async () => {
    const order = await maker.place([{ quantity: 1 }]);
    // The machine's clock is long past this order's expiry (2025); only the `now` we pass counts.
    expect(await expireDueOrders(deps, START)).toMatchObject({ scanned: 0 });
    expect((await orderRow(pool, order.number)).status).toBe("awaiting_payment");
    expect(await expireDueOrders(deps, new Date(START.getTime() + 60 * MINUTE))).toMatchObject({
      expired: 1,
    });
  });
});
