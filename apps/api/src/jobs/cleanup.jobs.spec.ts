import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { startApp, type RunningApp } from "../test/app.js";
import { sha256Hex } from "../test/cart-helpers.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import { createTestCustomer, type TestCustomer } from "../test/customer-fixtures.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { ensureMigrated } from "../test/migrate.js";
import { PlacedOrders } from "../test/order-fixtures.js";
import { orderRow } from "../test/order-http.js";
import { OrderMaker } from "../test/order-maker.js";
import { DEFAULT_CLEANUP_LIMITS } from "./batches.js";
import { deleteDispatchedEvents } from "./delete-dispatched-events.job.js";
import { deleteExpiredCarts } from "./delete-expired-carts.job.js";
import { deleteExpiredCustomerSessions } from "./delete-expired-customer-sessions.job.js";
import { JobsRepository } from "./jobs.repository.js";

// Before the carts and sessions any other spec leaves behind (their fake clocks start later), so only this spec's rows are due.
const NOW = new Date("2025-01-10T12:00:00.000Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe("cart, customer session and dispatched event cleanup (real Postgres, injected time)", () => {
  const clock = new FakeClock(NOW);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const placedOrders = new PlacedOrders(pool);
  let running: RunningApp;
  let deps: { database: Database; repository: JobsRepository };
  let customer: TestCustomer;
  let variantId = "";
  const cartIds: string[] = [];
  const sessionIds: string[] = [];
  const eventIds: string[] = [];

  /** A guest cart that expires at `expiresAt`, with one line, written straight into the table. */
  async function insertCart(expiresAt: Date, ownedBy?: string): Promise<string> {
    const created = new Date(expiresAt.getTime() - 30 * DAY);
    const result = await pool.query<{ id: string }>(
      `insert into cart (token_hash, customer_id, created_at, updated_at, expires_at)
       values ($1, $2, $3, $3, $4) returning id`,
      [ownedBy === undefined ? sha256Hex(randomUUID()) : null, ownedBy ?? null, created, expiresAt],
    );
    const id = result.rows[0]?.id ?? "";
    await pool.query("insert into cart_item (cart_id, variant_id, quantity) values ($1, $2, 1)", [
      id,
      variantId,
    ]);
    cartIds.push(id);
    return id;
  }

  async function insertSession(expiresAt: Date, lastSeenAt?: Date): Promise<string> {
    const created = new Date(expiresAt.getTime() - 90 * DAY);
    const result = await pool.query<{ id: string }>(
      `insert into customer_session (customer_id, token_hash, created_at, last_seen_at, expires_at)
       values ($1, $2, $3, $4, $5) returning id`,
      [customer.id, sha256Hex(randomUUID()), created, lastSeenAt ?? created, expiresAt],
    );
    const id = result.rows[0]?.id ?? "";
    sessionIds.push(id);
    return id;
  }

  async function insertEvent(dispatchedAt: Date | null): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `insert into domain_event (type, aggregate_id, payload, created_at, dispatched_at)
       values ('test.cleanup', $1, '{}'::jsonb, $2, $3) returning id`,
      [randomUUID(), new Date(NOW.getTime() - 60 * DAY), dispatchedAt],
    );
    const id = result.rows[0]?.id ?? "";
    eventIds.push(id);
    return id;
  }

  async function surviving(table: "cart" | "customer_session" | "domain_event", ids: string[]) {
    const result = await pool.query<{ id: string }>(
      `select id from ${table} where id = any($1::uuid[]) order by id`,
      [ids],
    );
    return result.rows.map((row) => row.id).sort();
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      rateLimits: { checkout: { maxAttempts: 100_000, windowMinutes: 10 } },
    });
    const database = running.app.get<Database>(DRIZZLE);
    deps = { database, repository: running.app.get(JobsRepository) };
    customer = await createTestCustomer(database);
    await catalog.init();
    variantId = (await catalog.simple({ trackInventory: false })).variantId;
  });

  afterEach(async () => {
    await pool.query("delete from cart where id = any($1::uuid[])", [cartIds.splice(0)]);
    await pool.query("delete from customer_session where id = any($1::uuid[])", [
      sessionIds.splice(0),
    ]);
    await pool.query("delete from domain_event where id = any($1::uuid[])", [eventIds.splice(0)]);
    await placedOrders.cleanup();
  });

  afterAll(async () => {
    await running.app.close();
    await pool.query("delete from customer where id = $1", [customer.id]);
    await catalog.cleanup();
    await pool.end();
  });

  describe("deleteExpiredCarts", () => {
    it("deletes carts and their lines at exactly their expiry and keeps live ones", async () => {
      const gone = await insertCart(new Date(NOW.getTime() - DAY));
      const edge = await insertCart(NOW);
      const live = await insertCart(new Date(NOW.getTime() + 1));
      const mine = await insertCart(new Date(NOW.getTime() - 40 * DAY), customer.id);
      expect(await deleteExpiredCarts(deps, NOW)).toEqual({ deleted: 3, truncated: false });
      expect(await surviving("cart", [gone, edge, live, mine])).toEqual([live]);
      const lines = await pool.query("select 1 from cart_item where cart_id = any($1::uuid[])", [
        [gone, edge, mine],
      ]);
      expect(lines.rowCount).toBe(0);
      expect(await deleteExpiredCarts(deps, NOW)).toEqual({ deleted: 0, truncated: false });
    });

    it("works in bounded batches and says when it stopped early", async () => {
      const ids: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        ids.push(await insertCart(new Date(NOW.getTime() - (index + 1) * MINUTE)));
      }
      expect(await deleteExpiredCarts(deps, NOW, { batchSize: 2, maxBatches: 2 })).toEqual({
        deleted: 4,
        truncated: true,
      });
      expect(await surviving("cart", ids)).toHaveLength(1);
      expect(await deleteExpiredCarts(deps, NOW, { batchSize: 2, maxBatches: 2 })).toEqual({
        deleted: 1,
        truncated: false,
      });
      // An exact multiple of the batch: the empty batch after the last full one ends the run.
      for (let index = 0; index < 4; index += 1) {
        await insertCart(new Date(NOW.getTime() - (index + 1) * MINUTE));
      }
      expect(await deleteExpiredCarts(deps, NOW, { batchSize: 2, maxBatches: 10 })).toEqual({
        deleted: 4,
        truncated: false,
      });
    });

    it("skips a cart that another transaction is writing and leaves its new expiry alone", async () => {
      const writing = await insertCart(new Date(NOW.getTime() - DAY));
      const other = await insertCart(new Date(NOW.getTime() - DAY));
      const writer = await pool.connect();
      try {
        await writer.query("begin");
        await writer.query("select id from cart where id = $1 for update", [writing]);
        await writer.query("update cart set updated_at = $2, expires_at = $3 where id = $1", [
          writing,
          NOW,
          new Date(NOW.getTime() + 30 * DAY),
        ]);
        // Does not wait for the writer: the locked cart is skipped, the other one goes.
        expect(await deleteExpiredCarts(deps, NOW)).toEqual({ deleted: 1, truncated: false });
        await writer.query("commit");
      } finally {
        writer.release();
      }
      expect(await surviving("cart", [writing, other])).toEqual([writing]);
    });

    it("never touches orders: a checked-out cart keeps its refreshed expiry, and deleting it later leaves the order", async () => {
      const maker = new OrderMaker(catalog, placedOrders, pool, () => running.baseUrl);
      const order = await maker.place([{ quantity: 1 }]);
      const before = await orderRow(pool, order.number);
      // The checkout gave the cart a new 30 day expiry from its clock (NOW).
      expect(await deleteExpiredCarts(deps, new Date(NOW.getTime() + 29 * DAY))).toMatchObject({
        deleted: 0,
      });
      const result = await deleteExpiredCarts(deps, new Date(NOW.getTime() + 31 * DAY));
      expect(result.deleted).toBeGreaterThanOrEqual(1);
      expect(await orderRow(pool, order.number)).toEqual(before);
    });
  });

  describe("deleteExpiredCustomerSessions", () => {
    it("deletes sessions past their absolute expiry (exactly at it) and keeps the others", async () => {
      const gone = await insertSession(new Date(NOW.getTime() - DAY));
      const edge = await insertSession(NOW);
      const live = await insertSession(new Date(NOW.getTime() + 1));
      expect(await deleteExpiredCustomerSessions(deps, NOW)).toEqual({
        deleted: 2,
        truncated: false,
      });
      expect(await surviving("customer_session", [gone, edge, live])).toEqual([live]);
    });

    it("keeps a session that is only idle-expired: idle expiry is decided when the session is used", async () => {
      const idle = await insertSession(
        new Date(NOW.getTime() + 60 * DAY),
        new Date(NOW.getTime() - 40 * DAY),
      );
      expect(await deleteExpiredCustomerSessions(deps, NOW)).toMatchObject({ deleted: 0 });
      expect(await surviving("customer_session", [idle])).toEqual([idle]);
    });

    it("works in bounded batches", async () => {
      for (let index = 0; index < 3; index += 1) {
        await insertSession(new Date(NOW.getTime() - (index + 1) * MINUTE));
      }
      expect(await deleteExpiredCustomerSessions(deps, NOW, { batchSize: 2, maxBatches: 1 })).toEqual({
        deleted: 2,
        truncated: true,
      });
      expect(await deleteExpiredCustomerSessions(deps, NOW, { batchSize: 2, maxBatches: 1 })).toEqual({
        deleted: 1,
        truncated: false,
      });
    });
  });

  describe("deleteDispatchedEvents", () => {
    it("deletes events dispatched MORE than 7 days ago: exactly 7 days is kept, a millisecond more goes", async () => {
      const cutoff = new Date(NOW.getTime() - 7 * DAY);
      const older = await insertEvent(new Date(cutoff.getTime() - 1));
      const exact = await insertEvent(cutoff);
      const newer = await insertEvent(new Date(cutoff.getTime() + 1));
      expect(await deleteDispatchedEvents(deps, NOW)).toEqual({ deleted: 1, truncated: false });
      expect(await surviving("domain_event", [older, exact, newer])).toEqual([exact, newer].sort());
    });

    it("never deletes an undispatched event, however old", async () => {
      const waiting = await insertEvent(null);
      expect(await deleteDispatchedEvents(deps, new Date(NOW.getTime() + 3650 * DAY))).toMatchObject({
        deleted: 0,
      });
      expect(await surviving("domain_event", [waiting])).toEqual([waiting]);
    });

    it("works in bounded batches", async () => {
      for (let index = 0; index < 3; index += 1) {
        await insertEvent(new Date(NOW.getTime() - 8 * DAY - index));
      }
      expect(await deleteDispatchedEvents(deps, NOW, { batchSize: 2, maxBatches: 1 })).toEqual({
        deleted: 2,
        truncated: true,
      });
      expect(await deleteDispatchedEvents(deps, NOW, { batchSize: 2, maxBatches: 1 })).toEqual({
        deleted: 1,
        truncated: false,
      });
    });
  });

  it("refuses nonsensical limits", async () => {
    await expect(deleteExpiredCarts(deps, NOW, { batchSize: 0, maxBatches: 1 })).rejects.toThrow(
      RangeError,
    );
    await expect(deleteExpiredCarts(deps, NOW, { batchSize: 10, maxBatches: 0 })).rejects.toThrow(
      RangeError,
    );
    expect(DEFAULT_CLEANUP_LIMITS).toEqual({ batchSize: 500, maxBatches: 100 });
  });
});
