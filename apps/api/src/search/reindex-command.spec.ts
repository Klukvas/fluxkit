import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCHEDULER_LOCK_KEY } from "../jobs/scheduler-lock.js";
import { requireEnv, requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import { listIndexUids } from "../test/search-engine.js";
import { SearchWorld } from "../test/search-world.js";
import {
  formatReindex,
  ReindexUsageError,
  reindexExitCode,
  runReindexCommand,
} from "./reindex-command.js";

/** `pnpm search:reindex` (ADR 0034 decision 5) with the real database and engine. */
describe("pnpm search:reindex (real Postgres, real Meilisearch)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let search: SearchWorld;
  let env: Record<string, string>;

  beforeAll(async () => {
    await ensureMigrated();
    await pool.query("delete from search_sync_queue");
    await pool.query("delete from search_index_state");
    search = await SearchWorld.create("rx");
    env = {
      DATABASE_URL: requireTestDatabaseUrl(),
      ORDER_TOKEN_SECRET: "reindex-spec-secret-0123456789-abcdefgh",
      SEARCH_ENABLED: "true",
      MEILI_URL: requireEnv("MEILI_URL"),
      MEILI_API_KEY: search.key,
      MEILI_INDEX_PREFIX: search.prefix,
      MEDIA_STORAGE_DRIVER: "none",
    };
  }, 60_000);

  afterAll(async () => {
    await search.dispose(pool);
    await pool.end();
  });

  it("refuses arguments and refuses to run with search off", async () => {
    await expect(runReindexCommand(["--now"], env)).rejects.toBeInstanceOf(ReindexUsageError);
    await expect(runReindexCommand([], { ...env, SEARCH_ENABLED: "false" })).rejects.toThrow(
      /Search is off/,
    );
  });

  it("builds every locale's index, swaps it in and exits 0", async () => {
    const outcome = await runReindexCommand([], env);
    expect(outcome).toMatchObject({ kind: "done", swapped: 2, failures: [] });
    expect(reindexExitCode(outcome)).toBe(0);
    expect(formatReindex(outcome)).toMatch(/^documents=\d+ swapped=2 synced=\d+$/);
    expect(await listIndexUids(search.prefix)).toEqual([
      search.liveUid("en"),
      search.liveUid("uk"),
    ]);
    // A second run builds again (it is a request) and leaves exactly the live indexes.
    expect(await runReindexCommand([], env)).toMatchObject({ kind: "done", swapped: 2 });
    expect(await listIndexUids(search.prefix)).toEqual([
      search.liveUid("en"),
      search.liveUid("uk"),
    ]);
  });

  it("leaves the work to a running scheduler when the lock is held, and keeps the request", async () => {
    const holder = new pg.Client({ connectionString: requireTestDatabaseUrl() });
    await holder.connect();
    try {
      await holder.query("select pg_advisory_lock($1)", [SCHEDULER_LOCK_KEY]);
      const outcome = await runReindexCommand([], env);
      expect(outcome).toEqual({ kind: "lock_held" });
      expect(reindexExitCode(outcome)).toBe(2);
      const requested = await pool.query(
        "select count(*)::int as count from search_index_state where rebuild_requested_at is not null",
      );
      expect(requested.rows[0]).toEqual({ count: 2 });
    } finally {
      await holder.end();
    }
    await pool.query("update search_index_state set rebuild_requested_at = null");
  });
});
