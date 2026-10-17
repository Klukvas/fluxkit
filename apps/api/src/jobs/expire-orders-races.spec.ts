import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { OrdersService } from "../orders/orders.service.js";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import { createTestCustomer, type TestCustomer } from "../test/customer-fixtures.js";
import { customerCookieOf, customerLogin } from "../test/customer-http.js";
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
import { changesOf, eventsOf, orderRow, reservationsOfOrder } from "../test/order-http.js";
import { OrderMaker, type MadeOrder } from "../test/order-maker.js";
import { Shopper } from "../test/shopper.js";
import { expireDueOrders, type ExpireOrdersDeps } from "./expire-due-orders.job.js";
import { JobsRepository } from "./jobs.repository.js";

const START = new Date("2025-04-01T08:00:00.000Z");
const ROUNDS = 15;
const PASSWORD = "correct horse battery staple";

describe("order expiry against payment and cancellation: the order row lock picks exactly one winner (real Postgres)", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const placedOrders = new PlacedOrders(pool);
  let running: RunningApp;
  let maker: OrderMaker;
  let service: OrdersService;
  let deps: ExpireOrdersDeps;
  let adminId = "";
  let mainId = "";
  let customer: TestCustomer;
  let customerShopper: Shopper;

  const terminalEvents = async (orderId: string) =>
    (await eventsOf(pool, orderId))
      .map((event) => event.type)
      .filter((type) => type !== "order.placed");

  /** Stock and records of an order that lost or won; the same invariants for every race. */
  async function expectConsistent(order: MadeOrder, winner: "paid" | "cancelled" | "expired") {
    const row = await orderRow(pool, order.number);
    expect(row.status).toBe(winner);
    expect(await changesOf(pool, order.id)).toHaveLength(2);
    expect(await terminalEvents(order.id)).toEqual([`order.${winner}`]);
    const held = await reservationsOfOrder(pool, order.id);
    for (const line of order.lines) {
      const now = await level(line.variantId);
      expect(now.reserved).toBe(0);
      expect(now.on_hand).toBe(winner === "paid" ? 50 - line.quantity : 50);
      expect(await movementsOf(pool, line.variantId)).toHaveLength(winner === "paid" ? 1 : 0);
    }
    expect(
      held.every((entry) => entry.status === (winner === "paid" ? "committed" : "released")),
    ).toBe(true);
  }

  /**
   * Starts two operations a few milliseconds apart, in alternating order, so that over the rounds each of them is first
   * (the job needs one query before it takes the order lock, a payment does not), and the lock decides in both directions.
   */
  async function race<A, B>(
    round: number,
    first: () => Promise<A>,
    second: () => Promise<B>,
  ): Promise<[A, B]> {
    const delay = [0, 1, 2, 3, 5, 8][round % 6] ?? 0;
    const later = async <T>(work: () => Promise<T>): Promise<T> => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return work();
    };
    return round % 2 === 0
      ? Promise.all([first(), later(second)])
      : Promise.all([later(first), second()]);
  }

  const level = async (variantId: string) =>
    (await levelOf(pool, variantId, mainId)) ?? { on_hand: -1, reserved: -1 };

  async function dueAt(order: MadeOrder): Promise<Date> {
    return (await orderRow(pool, order.number)).expires_at;
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      rateLimits: { checkout: { maxAttempts: 100_000, windowMinutes: 10 } },
    });
    maker = new OrderMaker(catalog, placedOrders, pool, () => running.baseUrl);
    service = running.app.get(OrdersService);
    deps = {
      database: running.app.get<Database>(DRIZZLE),
      repository: running.app.get(JobsRepository),
      orders: service,
    };
    adminId = await insertAdminUserRow(pool);
    mainId = await defaultLocationId(pool);
    customer = await createTestCustomer(running.app.get<Database>(DRIZZLE), {
      password: PASSWORD,
    });
    const login = await customerLogin(running.baseUrl, customer.email, PASSWORD);
    const pair = customerCookieOf(login) ?? "";
    customerShopper = new Shopper(running.baseUrl);
    customerShopper.setCookie(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
    await catalog.init();
  });

  afterEach(async () => {
    await placedOrders.cleanup();
  });

  afterAll(async () => {
    await running.app.close();
    await catalog.cleanup();
    await pool.query("delete from customer where id = $1", [customer.id]);
    await pool.query("delete from admin_user where id = $1", [adminId]);
    await pool.end();
  });

  it("markPaid against the expiry job, many rounds", async () => {
    const wins = { paid: 0, expired: 0 };
    for (let round = 0; round < ROUNDS; round += 1) {
      const order = await maker.place([{ quantity: 2 }, { quantity: 1 }]);
      const due = await dueAt(order);
      const [paid, job] = await race(
        round,
        () =>
          service.markPaid(order.id, {
            amount: { amount: order.total, currency: "UAH" },
            providerReference: `RACE-${String(round)}`,
            source: "test",
          }),
        () => expireDueOrders(deps, due),
      );
      const status = (await orderRow(pool, order.number)).status;
      if (status === "paid") {
        wins.paid += 1;
        expect(paid).toMatchObject({ ok: true, alreadyPaid: false });
        expect(job.expired).toBe(0);
        await expectConsistent(order, "paid");
      } else {
        wins.expired += 1;
        expect(paid).toEqual({ ok: false, reason: "order_not_payable" });
        expect(job.expired).toBe(1);
        await expectConsistent(order, "expired");
      }
      expect(job.failures).toEqual([]);
    }
    expect(wins.paid + wins.expired).toBe(ROUNDS);
  });

  it("a guest cancel against the expiry job, many rounds", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const order = await maker.place([{ quantity: 2 }]);
      const due = await dueAt(order);
      const [cancel, job] = await race(
        round,
        () => service.cancelAsGuest(order.number, order.accessToken),
        () => expireDueOrders(deps, due),
      );
      const status = (await orderRow(pool, order.number)).status;
      if (status === "cancelled") {
        expect(cancel).toMatchObject({ ok: true });
        expect(job.expired).toBe(0);
        await expectConsistent(order, "cancelled");
      } else {
        expect(cancel).toEqual({ ok: false, reason: "invalid_transition" });
        expect(job.expired).toBe(1);
        await expectConsistent(order, "expired");
      }
    }
  });

  it("a customer cancel against the expiry job, many rounds", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const order = await maker.place([{ quantity: 1 }], customerShopper);
      const due = await dueAt(order);
      const [cancel, job] = await race(
        round,
        () => service.cancelAsCustomer(customer.id, order.number),
        () => expireDueOrders(deps, due),
      );
      const status = (await orderRow(pool, order.number)).status;
      if (status === "cancelled") {
        expect(cancel).toMatchObject({ ok: true });
        await expectConsistent(order, "cancelled");
      } else {
        expect(cancel).toEqual({ ok: false, reason: "invalid_transition" });
        await expectConsistent(order, "expired");
      }
      expect(job.failures).toEqual([]);
    }
  });

  it("an admin cancel against the expiry job, many rounds", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const order = await maker.place([{ quantity: 1 }]);
      const due = await dueAt(order);
      const [cancel, job] = await race(
        round,
        () => service.cancelAsAdmin(order.id, adminId, "race"),
        () => expireDueOrders(deps, due),
      );
      const status = (await orderRow(pool, order.number)).status;
      if (status === "cancelled") {
        expect(cancel).toMatchObject({ ok: true });
        await expectConsistent(order, "cancelled");
      } else {
        // The order was expired first; an expired order can not be cancelled.
        expect(cancel).toEqual({ ok: false, reason: "invalid_transition" });
        expect(job.expired).toBe(1);
        await expectConsistent(order, "expired");
      }
    }
  });

  it("two expiry runs at once expire every order exactly once", async () => {
    const batch: MadeOrder[] = [];
    for (let index = 0; index < 6; index += 1) {
      clock.advanceMinutes(1);
      batch.push(await maker.place([{ quantity: 1 }]));
    }
    const due = await dueAt(batch[batch.length - 1] as MadeOrder);
    const [first, second] = await Promise.all([
      expireDueOrders(deps, due, { batchSize: 2 }),
      expireDueOrders(deps, due, { batchSize: 2 }),
    ]);
    expect(first.expired + second.expired).toBe(6);
    expect(first.failures).toEqual([]);
    expect(second.failures).toEqual([]);
    for (const order of batch) {
      await expectConsistent(order, "expired");
    }
  });
});
