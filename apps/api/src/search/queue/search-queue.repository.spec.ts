import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../../database/schema/index.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { ensureMigrated } from "../../test/migrate.js";
import { SearchQueueRepository } from "./search-queue.repository.js";

describe("SearchQueueRepository (real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl(), max: 1 });
  const database = drizzle(pool, { schema });
  const queue = new SearchQueueRepository();

  beforeAll(async () => {
    await ensureMigrated();
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  it("claims at most one page with stale empty-table statistics, leaving the rest due", async () => {
    await database.transaction(async (tx) => {
      // A private queue makes the statistics deterministic without changing the shared queue or its planner settings.
      await tx.execute(sql`
        create temporary table search_sync_queue
        (like public.search_sync_queue including all) on commit drop`);
      await tx.execute(sql`
        insert into search_sync_queue (product_id, reason)
        select gen_random_uuid(), 'product_changed' from generate_series(1, 2150)`);
      await tx.execute(sql`delete from search_sync_queue`);
      // ANALYZE after a drained backlog is a normal autovacuum outcome. The next page can then be the INNER side of a
      // nested loop: a non-materialized LIMIT is re-executed for each outer row and one claim can lease the whole queue.
      await tx.execute(sql`analyze search_sync_queue`);
      await tx.execute(sql`
        insert into search_sync_queue (product_id, reason)
        select gen_random_uuid(), 'product_changed' from generate_series(1, 450)`);
      const now = new Date();
      const boundary = await queue.lastChangeSeq(tx);

      const first = await queue.claimDue(tx, now, 100, 120, boundary);
      expect(first).toHaveLength(100);
      const second = await queue.claimDue(tx, now, 100, 120, boundary);
      expect(second).toHaveLength(100);
      expect(new Set([...first, ...second].map((row) => row.productId)).size).toBe(200);
      expect(await queue.hasDue(tx, now, boundary)).toBe(true);
      expect(await queue.summary(tx, now)).toMatchObject({ depth: 450, leased: 200 });
      const remaining = await tx.execute(sql`
        select count(*)::int as count from search_sync_queue where lease_until is null`);
      expect(remaining.rows).toEqual([{ count: 250 }]);
    });
  });
});
