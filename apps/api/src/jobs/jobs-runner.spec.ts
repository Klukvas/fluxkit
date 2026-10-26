import { Logger } from "@nestjs/common";
import pg from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { OrdersService } from "../orders/orders.service.js";
import { ReservationsService } from "../inventory/reservations/reservations.service.js";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { defaultLocationId, levelOf } from "../test/inventory-fixtures.js";
import { ensureMigrated } from "../test/migrate.js";
import { PlacedOrders } from "../test/order-fixtures.js";
import { eventsOf, orderRow, reservationsOfOrder } from "../test/order-http.js";
import { OrderMaker } from "../test/order-maker.js";
import { JobsRepository } from "./jobs.repository.js";
import { JOB_NAMES, JobsRunner, describeAllCounts, describeCounts } from "./jobs-runner.js";

const START = new Date("2025-07-01T08:00:00.000Z");
const MINUTE = 60_000;

describe("JobsRunner (real Postgres, injected time)", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const placedOrders = new PlacedOrders(pool);
  let running: RunningApp;
  let maker: OrderMaker;
  let runner: JobsRunner;
  let mainId = "";

  let errors: MockInstance<Logger["error"]>;
  let logs: MockInstance<Logger["log"]>;

  const lines = (spy: MockInstance<Logger["error"]> | MockInstance<Logger["log"]>): string[] =>
    spy.mock.calls.map((call) => String(call[0]));

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      rateLimits: { checkout: { maxAttempts: 100_000, windowMinutes: 10 } },
    });
    maker = new OrderMaker(catalog, placedOrders, pool, () => running.baseUrl);
    runner = running.app.get(JobsRunner);
    mainId = await defaultLocationId(pool);
    await catalog.init();
  });

  beforeEach(() => {
    errors = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    logs = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await pool.query("delete from reservation where reference = 'orphan'");
    await placedOrders.cleanup();
  });

  afterAll(async () => {
    await running.app.close();
    await catalog.cleanup();
    await pool.end();
  });

  it("runs the ten jobs in the documented order and reports each", async () => {
    const reports = await runner.runAll(START);
    expect(reports.map((report) => report.name)).toEqual([...JOB_NAMES]);
    expect(JOB_NAMES).toEqual([
      "expire-orders",
      "sweep-reservations",
      "dispatch-events",
      "delete-dispatched-events",
      "delete-carts",
      "delete-customer-sessions",
      "delete-abandoned-uploads",
      "track-shipments",
      "send-emails",
      "purge-email-messages",
    ]);
    expect(reports.every((report) => report.ok)).toBe(true);
  });

  it("expires orders BEFORE the sweep: a stale order's reservations are released, not swept, and orphans are swept", async () => {
    const order = await maker.place([{ quantity: 2 }]);
    const row = await orderRow(pool, order.number);
    const reservations = running.app.get(ReservationsService, { strict: false });
    const orphanVariant = (await catalog.simple({ trackInventory: true, onHand: 9 })).variantId;
    const orphan = await reservations.reserve({
      variantId: orphanVariant,
      quantity: 4,
      expiresAt: new Date(START.getTime() + MINUTE),
      reference: "orphan",
    });
    expect(orphan.ok).toBe(true);

    // The order reservations outlive the order by the grace period: nothing of the order is touched before its expiry.
    await runner.runAll(new Date(row.expires_at.getTime() - 1));
    expect((await orderRow(pool, order.number)).status).toBe("awaiting_payment");
    expect((await reservationsOfOrder(pool, order.id)).map((held) => held.status)).toEqual([
      "active",
    ]);
    // The orphan was swept (its own expiry has passed), the order's hold was not.
    expect(await levelOf(pool, orphanVariant, mainId)).toEqual({ on_hand: 9, reserved: 0 });

    // The scheduler was down: by now the reservations are past their expiry too. The order job must still go first.
    const stale = new Date(row.expires_at.getTime() + 11 * MINUTE);
    const reports = await runner.runAll(stale);
    expect(reports.every((report) => report.ok)).toBe(true);
    expect((await orderRow(pool, order.number)).status).toBe("expired");
    expect((await reservationsOfOrder(pool, order.id)).map((held) => held.status)).toEqual([
      "released",
    ]);
    expect((await eventsOf(pool, order.id)).map((event) => event.type)).toEqual([
      "order.placed",
      "order.expired",
    ]);
    // Outbox rows are stamped by the database clock (the real time), so a tick at a faked 2025 does not see them yet; a
    // tick at the real time dispatches them (no handler is registered: they are simply marked dispatched).
    expect((await eventsOf(pool, order.id)).every((event) => event.dispatched_at === null)).toBe(
      true,
    );
    await runner.runAll(new Date());
    expect((await eventsOf(pool, order.id)).every((event) => event.dispatched_at !== null)).toBe(
      true,
    );
  });

  it("a job that throws is logged by class and cause only and does not stop the others", async () => {
    vi.spyOn(running.app.get(JobsRepository), "deleteExpiredCarts").mockRejectedValue(
      new TypeError("secret buyer@example.test in a message"),
    );
    const reports = await runner.runAll(START);
    const failed = reports.filter((report) => !report.ok);
    expect(failed.map((report) => report.name)).toEqual(["delete-carts"]);
    expect(reports.filter((report) => report.ok)).toHaveLength(JOB_NAMES.length - 1);
    const logged = lines(errors).join("\n");
    expect(logged).toContain("Job delete-carts failed: TypeError cause=TypeError");
    expect(logged).not.toContain("buyer@example.test");
  });

  it("logs every order that failed to expire by number and class, and a stock sweep failure by reservation id and reason", async () => {
    const order = await maker.place([{ quantity: 1 }]);
    const row = await orderRow(pool, order.number);
    vi.spyOn(running.app.get(OrdersService), "expireOne").mockRejectedValue(
      new RangeError("secret buyer@example.test"),
    );
    const reservations = running.app.get(ReservationsService, { strict: false });
    const brokenVariant = (await catalog.simple({ trackInventory: true, onHand: 5 })).variantId;
    const held = await reservations.reserve({
      variantId: brokenVariant,
      quantity: 3,
      expiresAt: new Date(START.getTime() + MINUTE),
      reference: "orphan",
    });
    if (!held.ok) throw new Error("Test setup: reserve refused");
    await pool.query("update inventory_level set reserved = 0 where variant_id = $1", [
      brokenVariant,
    ]);

    const reports = await runner.runAll(new Date(row.expires_at.getTime() + 11 * MINUTE));
    expect(reports.every((report) => report.ok)).toBe(true);
    const logged = lines(errors).join("\n");
    expect(logged).toContain(
      `Job expire-orders: {"orderNumber":"${order.number}","error":"RangeError cause=RangeError"}`,
    );
    expect(logged).toContain(
      `Job sweep-reservations: {"reservationId":"${held.reservation.id}","reason":"level_inconsistent"}`,
    );
    expect(logged).not.toContain("buyer@example.test");
    expect((await orderRow(pool, order.number)).status).toBe("awaiting_payment");
  });

  it("logs a job line only when it did something", async () => {
    await runner.runAll(START);
    expect(lines(logs).filter((line) => line.startsWith("Job "))).toEqual([]);
  });

  it("describes counts for the log and for the command line", () => {
    const result = { scanned: 3, expired: 0, failures: [{ a: 1 }], truncated: false, empty: [] };
    expect(describeCounts(result)).toBe("scanned=3 failures=1");
    expect(describeAllCounts(result)).toBe(
      "scanned=3 expired=0 failures=1 truncated=false empty=0",
    );
    expect(describeCounts({ scanned: 0, failures: [] })).toBe("");
  });
});
