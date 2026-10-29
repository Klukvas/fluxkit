import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../database/schema/index.js";
import type { Database } from "../../database/database.module.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { ensureMigrated } from "../../test/migrate.js";
import { SearchQueue } from "./search-queue.js";

interface QueueRow {
  product_id: string;
  reason: string;
  change_seq: string;
  enqueued_at: Date;
  next_attempt_at: Date;
  attempts: number;
  last_error_code: string | null;
}

/** The write side of the search queue on real Postgres (ADR 0034 decision 5). */
describe("SearchQueue (real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl(), max: 24 });
  const database: Database = drizzle(pool, { schema });
  const queue = new SearchQueue({ locales: ["uk", "en"], fanOutRebuildThreshold: 3 });

  beforeAll(async () => {
    await ensureMigrated();
  }, 120_000);

  beforeEach(async () => {
    await pool.query("delete from search_sync_queue");
    await pool.query("delete from search_index_state");
  });

  afterAll(async () => {
    await pool.query("delete from search_sync_queue");
    await pool.query("delete from search_index_state");
    await pool.end();
  });

  async function rows(): Promise<QueueRow[]> {
    const result = await pool.query<QueueRow>(
      "select * from search_sync_queue order by product_id",
    );
    return result.rows;
  }

  it("writes the mark in the caller's transaction: it commits with it and disappears with a rollback", async () => {
    const kept = randomUUID();
    const dropped = randomUUID();
    await database.transaction((tx) => queue.productsChanged(tx, [kept], "product_changed"));
    await expect(
      database.transaction(async (tx) => {
        await queue.productsChanged(tx, [dropped], "product_changed");
        throw new Error("the catalog write failed");
      }),
    ).rejects.toThrow("the catalog write failed");
    expect((await rows()).map((row) => row.product_id)).toEqual([kept]);
  });

  it("coalesces marks of one product into one row with a new change_seq, the latest reason, due now", async () => {
    const productId = randomUUID();
    await database.transaction((tx) => queue.productsChanged(tx, [productId], "product_changed"));
    const [first] = await rows();
    // A row that failed before and waits for its backoff.
    await pool.query(
      `update search_sync_queue set attempts = 3, last_error_code = 'engine_timeout',
         next_attempt_at = now() + interval '10 minutes', enqueued_at = now() - interval '1 hour'
       where product_id = $1`,
      [productId],
    );
    await database.transaction((tx) =>
      queue.productsChanged(tx, [productId, productId.toUpperCase()], "price_changed"),
    );
    const after = await rows();
    expect(after).toHaveLength(1);
    const [row] = after;
    expect(Number(row?.change_seq)).toBeGreaterThan(Number(first?.change_seq));
    expect(row).toMatchObject({
      reason: "price_changed",
      attempts: 3,
      last_error_code: "engine_timeout",
    });
    // Due now again, and the oldest unsynced change keeps its time.
    expect(row?.next_attempt_at.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
    expect(row?.enqueued_at.getTime()).toBeLessThan(Date.now() - 50 * 60_000);
  });

  it("does nothing for an empty list and refuses an id that is not a uuid (a caller bug)", async () => {
    await database.transaction((tx) => queue.productsChanged(tx, [], "product_changed"));
    expect(await rows()).toEqual([]);
    await expect(
      database.transaction((tx) => queue.productsChanged(tx, ["1 or 1=1"], "product_changed")),
    ).rejects.toThrow(RangeError);
  });

  it("fans out to the products of a query, and requests a rebuild of every locale above the limit instead", async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const values = (list: string[]) =>
      sql.join(
        list.map((id) => sql`select ${id}::uuid`),
        sql` union all `,
      );
    await database.transaction((tx) =>
      queue.productsChangedWhere(tx, values([...ids, ids[0] ?? ""]), "brand_changed"),
    );
    expect((await rows()).map((row) => [row.product_id, row.reason])).toEqual(
      [...ids].sort().map((id) => [id, "brand_changed"]),
    );
    expect((await pool.query("select * from search_index_state")).rows).toEqual([]);

    await pool.query("delete from search_sync_queue");
    const many = [...ids, randomUUID()];
    await database.transaction((tx) =>
      queue.productsChangedWhere(tx, values(many), "category_changed"),
    );
    expect(await rows()).toEqual([]);
    const state = await pool.query<{ locale: string; rebuild_requested_at: Date | null }>(
      "select locale, rebuild_requested_at from search_index_state order by locale",
    );
    expect(state.rows.map((row) => [row.locale, row.rebuild_requested_at instanceof Date])).toEqual(
      [
        ["en", true],
        ["uk", true],
      ],
    );
  });

  it("a mark made while another transaction holds the row waits for it, then gets a later change_seq", async () => {
    const productId = randomUUID();
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query(
        `insert into search_sync_queue (product_id, reason) values ($1, 'product_changed')`,
        [productId],
      );
      let finished = false;
      const second = database
        .transaction((tx) => queue.productsChanged(tx, [productId], "stock_changed"))
        .then(() => {
          finished = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(finished).toBe(false);
      const held = await holder.query<{ change_seq: string }>(
        "select change_seq from search_sync_queue where product_id = $1",
        [productId],
      );
      await holder.query("commit");
      await second;
      const [row] = await rows();
      expect(row?.reason).toBe("stock_changed");
      expect(Number(row?.change_seq)).toBeGreaterThan(Number(held.rows[0]?.change_seq));
    } finally {
      holder.release();
    }
  });

  it("many concurrent transactions marking overlapping products in any order never deadlock and leave one row each", async () => {
    const products = Array.from({ length: 6 }, () => randomUUID());
    // Warm the pool so the transactions really start together instead of queueing for connections.
    const warm = await Promise.all(Array.from({ length: 20 }, () => pool.connect()));
    for (const client of warm) client.release();

    const shuffled = (list: string[]) => [...list].sort(() => Math.random() - 0.5);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        database.transaction(async (tx) => {
          // Each transaction marks a different subset, given in a random order, after a random pause: overlapping rows.
          const subset = shuffled(products).slice(0, 2 + (index % 5));
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
          await queue.productsChanged(tx, subset, "reservation_changed");
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
          await queue.productsChanged(tx, shuffled(subset).slice(0, 1), "reservation_changed");
        }),
      ),
    );
    expect(results.filter((result) => result.status === "rejected")).toEqual([]);
    const after = await rows();
    expect(new Set(after.map((row) => row.product_id)).size).toBe(after.length);
    expect(after.length).toBeGreaterThanOrEqual(2);
    const seqs = after.map((row) => Number(row.change_seq));
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});
