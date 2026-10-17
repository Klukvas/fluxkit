import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.factory.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { startApp, type RunningApp } from "../test/app.js";
import { sha256Hex } from "../test/cart-helpers.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import { createTestCustomer, type TestCustomer } from "../test/customer-fixtures.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { ensureMigrated } from "../test/migrate.js";
import { PlacedOrders } from "../test/order-fixtures.js";
import { eventsOf, orderRow } from "../test/order-http.js";
import { OrderMaker } from "../test/order-maker.js";
import { JobsRunner, type JobReport } from "./jobs-runner.js";
import { SCHEDULER_LOCK_APPLICATION_NAME, SCHEDULER_LOCK_KEY } from "./scheduler-lock.js";
import { SchedulerService } from "./scheduler.service.js";

const START = new Date("2025-10-01T08:00:00.000Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A promise a test settles by hand. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("the scheduler: advisory lock, ticks, shutdown (real Postgres)", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const apps: RunningApp[] = [];
  const catalog = new CartCatalog(pool);
  const placedOrders = new PlacedOrders(pool);
  let first: RunningApp;
  let second: RunningApp;

  const schedulerOf = (running: RunningApp) => running.app.get(SchedulerService);
  const runnerOf = (running: RunningApp) => running.app.get(JobsRunner);

  async function app(options: Parameters<typeof startApp>[0] = {}): Promise<RunningApp> {
    const running = await startApp({
      clock,
      adminAuthenticator: "production-default",
      rateLimits: { checkout: { maxAttempts: 100_000, windowMinutes: 10 } },
      ...options,
    });
    apps.push(running);
    return running;
  }

  /** Whether the advisory lock is free right now, asked from a fresh connection (and given back at once). */
  async function lockIsFree(): Promise<boolean> {
    const client = new pg.Client({ connectionString: requireTestDatabaseUrl() });
    await client.connect();
    try {
      const result = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock($1) as locked",
        [SCHEDULER_LOCK_KEY],
      );
      if (result.rows[0]?.locked === true) {
        await client.query("select pg_advisory_unlock($1)", [SCHEDULER_LOCK_KEY]);
        return true;
      }
      return false;
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    await ensureMigrated();
    first = await app();
    second = await app();
    await catalog.init();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await placedOrders.cleanup();
  });

  afterAll(async () => {
    for (const running of apps) {
      await running.app.close();
    }
    await catalog.cleanup();
    await pool.end();
  });

  describe("the advisory lock", () => {
    it("lets one of two instances run a tick at a time; the other skips it, and the lock is free again afterwards", async () => {
      const entered = gate();
      const release = gate();
      const runFirst = vi.spyOn(runnerOf(first), "runAll").mockImplementation(async () => {
        entered.open();
        await release.promise;
        return [];
      });
      const runSecond = vi.spyOn(runnerOf(second), "runAll").mockResolvedValue([]);

      const running = schedulerOf(first).tick();
      await entered.promise;
      expect(await lockIsFree()).toBe(false);
      expect(await schedulerOf(second).tick()).toEqual({ status: "lock_held" });
      expect(runSecond).not.toHaveBeenCalled();

      release.open();
      expect(await running).toEqual({ status: "ran", reports: [] });
      expect(runFirst).toHaveBeenCalledTimes(1);
      expect(await lockIsFree()).toBe(true);
      expect(await schedulerOf(second).tick()).toEqual({ status: "ran", reports: [] });
      expect(runSecond).toHaveBeenCalledTimes(1);
    });

    it("never lets two instances run jobs at the same moment, over many simultaneous ticks", async () => {
      let active = 0;
      let overlapped = false;
      let runs = 0;
      const observe = async (): Promise<JobReport[]> => {
        active += 1;
        runs += 1;
        overlapped ||= active > 1;
        await sleep(15);
        active -= 1;
        return [];
      };
      vi.spyOn(runnerOf(first), "runAll").mockImplementation(observe);
      vi.spyOn(runnerOf(second), "runAll").mockImplementation(observe);
      for (let round = 0; round < 10; round += 1) {
        await Promise.all([schedulerOf(first).tick(), schedulerOf(second).tick()]);
      }
      expect(overlapped).toBe(false);
      expect(runs).toBeGreaterThanOrEqual(10);
    });

    it("leaves no connection behind after a tick, a skipped tick or a failed tick", async () => {
      vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      vi.spyOn(runnerOf(first), "runAll").mockResolvedValue([]);
      await schedulerOf(first).tick();
      vi.spyOn(runnerOf(second), "runAll").mockRejectedValueOnce(new Error("boom"));
      await schedulerOf(second).tick();
      const entered = gate();
      const release = gate();
      vi.spyOn(runnerOf(first), "runAll").mockImplementationOnce(async () => {
        entered.open();
        await release.promise;
        return [];
      });
      const holding = schedulerOf(first).tick();
      await entered.promise;
      await schedulerOf(second).tick();
      release.open();
      await holding;
      const open = await pool.query(
        "select count(*)::int as count from pg_stat_activity where application_name = $1",
        [SCHEDULER_LOCK_APPLICATION_NAME],
      );
      expect(open.rows[0]).toEqual({ count: 0 });
    });

    it("releases the lock when the jobs throw (the tick reports failed and logs, and the next tick runs)", async () => {
      const errors = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      vi.spyOn(runnerOf(first), "runAll").mockRejectedValueOnce(
        new TypeError("secret buyer@example.test"),
      );
      expect(await schedulerOf(first).tick()).toEqual({ status: "failed" });
      expect(errors.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
        "Scheduler tick failed: TypeError cause=TypeError",
      );
      expect(errors.mock.calls.map((call) => String(call[0])).join("\n")).not.toContain(
        "buyer@example.test",
      );
      expect(await lockIsFree()).toBe(true);
      expect(await schedulerOf(second).tick()).toMatchObject({ status: "ran" });
    });

    it("is released when the holder's connection dies (a crashed process), so another instance takes over", async () => {
      vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const entered = gate();
      const release = gate();
      vi.spyOn(runnerOf(first), "runAll").mockImplementation(async () => {
        entered.open();
        await release.promise;
        return [];
      });
      vi.spyOn(runnerOf(second), "runAll").mockResolvedValue([]);
      const running = schedulerOf(first).tick();
      await entered.promise;
      expect(await schedulerOf(second).tick()).toEqual({ status: "lock_held" });

      // The database ends the holder's session, as it does when the process dies.
      const killed = await pool.query<{ terminated: boolean }>(
        `select pg_terminate_backend(l.pid) as terminated from pg_locks l
          where l.locktype = 'advisory' and l.objid = $1 and l.granted`,
        [SCHEDULER_LOCK_KEY],
      );
      expect(killed.rows.map((row) => row.terminated)).toEqual([true]);
      for (let waited = 0; waited < 50 && !(await lockIsFree()); waited += 1) {
        await sleep(20);
      }
      expect(await lockIsFree()).toBe(true);
      expect(await schedulerOf(second).tick()).toMatchObject({ status: "ran" });

      // The first tick ends without taking the process down, whatever it reports.
      release.open();
      await expect(running).resolves.toBeDefined();
    });
  });

  describe("ticks", () => {
    it("a tick that starts while this process is still in the previous one does nothing", async () => {
      const entered = gate();
      const release = gate();
      const runner = vi.spyOn(runnerOf(first), "runAll").mockImplementation(async () => {
        entered.open();
        await release.promise;
        return [];
      });
      const running = schedulerOf(first).tick();
      await entered.promise;
      expect(await schedulerOf(first).tick()).toEqual({ status: "overlap" });
      expect(await schedulerOf(first).tick()).toEqual({ status: "overlap" });
      release.open();
      expect(await running).toMatchObject({ status: "ran" });
      expect(runner).toHaveBeenCalledTimes(1);
      expect(await schedulerOf(first).tick()).toMatchObject({ status: "ran" });
    });

    it("runs every job with now = the injected clock, never the wall clock", async () => {
      const runner = vi.spyOn(runnerOf(first), "runAll").mockResolvedValue([]);
      clock.set(new Date("2025-10-02T03:04:05.678Z"));
      await schedulerOf(first).tick();
      expect(runner).toHaveBeenCalledWith(new Date("2025-10-02T03:04:05.678Z"));
      clock.set(START);
    });

    it("does real work: a stale order, an expired cart, an expired session and a waiting event are all handled in one tick", async () => {
      const maker = new OrderMaker(catalog, placedOrders, pool, () => first.baseUrl);
      const db = first.app.get<Database>(DRIZZLE);
      const customer: TestCustomer = await createTestCustomer(db);
      try {
        clock.set(START);
        const order = await maker.place([{ quantity: 2 }]);
        const dead = await pool.query<{ id: string }>(
          `insert into cart (token_hash, created_at, updated_at, expires_at)
           values ($1, $2, $2, $3) returning id`,
          [
            sha256Hex(randomUUID()),
            new Date(START.getTime() - 40 * DAY),
            new Date(START.getTime() - DAY),
          ],
        );
        await pool.query(
          `insert into customer_session (customer_id, token_hash, created_at, last_seen_at, expires_at)
           values ($1, $2, $3, $3, $4)`,
          [
            customer.id,
            sha256Hex(randomUUID()),
            new Date(START.getTime() - 90 * DAY),
            new Date(START.getTime() - MINUTE),
          ],
        );
        clock.set(new Date((await orderRow(pool, order.number)).expires_at.getTime() + MINUTE));
        const outcome = await schedulerOf(first).tick();
        expect(outcome.status).toBe("ran");
        expect(outcome.status === "ran" && outcome.reports.every((report) => report.ok)).toBe(true);
        expect((await orderRow(pool, order.number)).status).toBe("expired");
        expect((await eventsOf(pool, order.id)).map((event) => event.type)).toEqual([
          "order.placed",
          "order.expired",
        ]);
        expect(
          (await pool.query("select 1 from cart where id = $1", [dead.rows[0]?.id])).rowCount,
        ).toBe(0);
        expect(
          (await pool.query("select 1 from customer_session where customer_id = $1", [customer.id]))
            .rowCount,
        ).toBe(0);
      } finally {
        clock.set(START);
        await placedOrders.cleanup();
        await pool.query("delete from customer where id = $1", [customer.id]);
      }
    });

    it("an unreachable database makes the tick report failed instead of throwing", async () => {
      vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const lost = await createApp(
        {
          databaseUrl: "postgres://fluxkit:wrong@127.0.0.1:1/none",
          enabledFeatures: [],
          featuresDir: undefined,
        },
        { logLevels: [] },
      );
      try {
        await lost.init();
        expect(await lost.get(SchedulerService).tick()).toEqual({ status: "failed" });
      } finally {
        await lost.close();
      }
    });
  });

  describe("the timer", () => {
    it("is not started when the scheduler is disabled (the default of the test app)", async () => {
      const idle = await app({ schedulerEnabled: false, schedulerIntervalSeconds: 0.05 });
      const runner = vi.spyOn(runnerOf(idle), "runAll").mockResolvedValue([]);
      await sleep(300);
      expect(runner).not.toHaveBeenCalled();
    });

    it("ticks on its interval, with the injected clock, and stops for good at shutdown", async () => {
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
      const ticking = await startApp({
        clock,
        adminAuthenticator: "production-default",
        schedulerEnabled: true,
        schedulerIntervalSeconds: 0.1,
      });
      const runner = vi.spyOn(runnerOf(ticking), "runAll").mockResolvedValue([]);
      for (let waited = 0; waited < 100 && runner.mock.calls.length < 3; waited += 1) {
        await sleep(30);
      }
      expect(runner.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(runner.mock.calls.every((call) => call[0].getTime() === START.getTime())).toBe(true);
      const created = setIntervalSpy.mock.calls.findIndex((call) => call[1] === 100);
      expect(created).toBeGreaterThanOrEqual(0);
      const handle = setIntervalSpy.mock.results[created]?.value as NodeJS.Timeout;
      await ticking.app.close();
      expect(clearIntervalSpy).toHaveBeenCalledWith(handle);
      const after = runner.mock.calls.length;
      await sleep(400);
      expect(runner.mock.calls.length).toBe(after);
      expect(await schedulerOf(ticking).tick()).toEqual({ status: "stopped" });
    });

    it("shutdown waits for a tick that is running before the database is closed", async () => {
      const ticking = await startApp({
        clock,
        adminAuthenticator: "production-default",
        schedulerEnabled: true,
        schedulerIntervalSeconds: 0.1,
      });
      const entered = gate();
      const release = gate();
      vi.spyOn(runnerOf(ticking), "runAll").mockImplementation(async () => {
        entered.open();
        await release.promise;
        return [];
      });
      await entered.promise;
      let closed = false;
      const closing = ticking.app.close().then(() => {
        closed = true;
      });
      await sleep(200);
      expect(closed).toBe(false);
      release.open();
      await closing;
      expect(closed).toBe(true);
    });

    it("leaves GET /health exactly as it was", async () => {
      const ticking = await startApp({ schedulerEnabled: true, schedulerIntervalSeconds: 60 });
      try {
        const response = await fetch(`${ticking.baseUrl}/health`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: "ok" });
      } finally {
        await ticking.app.close();
      }
    });
  });
});
