import { randomUUID } from "node:crypto";
import { getTableConfig } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CODE_PATTERN,
  SEARCH_INDEX_UID_PATTERN,
  SEARCH_SYNC_REASONS,
  SYNONYM_LIMITS,
  deriveIndexSettings,
} from "@fluxkit/core";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import * as searchSchema from "./schema/search.js";

const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const NOT_NULL_VIOLATION = "23502";
const UNIQUE_VIOLATION = "23505";

type Value = string | number | boolean | null | readonly string[];
type Row = Record<string, Value>;

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Test setup bug: ${what} is missing`);
  return value;
}

describe("search schema (migration 0010, real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  // Every test runs in its own transaction that is rolled back, so tests never see each other's rows.
  let client: pg.PoolClient;

  beforeAll(async () => {
    await ensureMigrated();
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query("begin");
  });

  afterEach(async () => {
    try {
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  async function insert(table: string, row: Row): Promise<Record<string, unknown>> {
    const columns = Object.keys(row);
    const result = await client.query(
      `insert into "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) ` +
        `values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning *`,
      Object.values(row),
    );
    return must(result.rows[0] as Record<string, unknown> | undefined, `${table} row`);
  }

  /** Runs one statement that must fail; asserts SQLSTATE and constraint name, then undoes the failed statement. */
  async function expectViolation(
    run: () => Promise<unknown>,
    code: string,
    constraint: string | undefined,
  ): Promise<void> {
    await client.query("savepoint expected_violation");
    const error = await run().then(
      () => undefined,
      (reason: unknown) => reason,
    );
    await client.query("rollback to savepoint expected_violation");
    expect(
      error,
      `expected "${constraint ?? code}" to be violated, but the statement succeeded`,
    ).toBeInstanceOf(pg.DatabaseError);
    if (!(error instanceof pg.DatabaseError)) throw new Error("unreachable");
    expect({ code: error.code, constraint: error.constraint }).toEqual({ code, constraint });
  }

  async function expectAccepted(run: () => Promise<unknown>): Promise<void> {
    await client.query("savepoint expected_accept");
    try {
      await run();
    } finally {
      await client.query("rollback to savepoint expected_accept");
    }
  }

  async function constraintDefinition(table: string, constraint: string): Promise<string> {
    const result = await client.query(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
       where conrelid = $1::regclass and conname = $2`,
      [`public.${table}`, constraint],
    );
    return must(
      (result.rows[0] as { definition: string } | undefined)?.definition,
      `${constraint} definition`,
    );
  }

  const LIVE_STATE: Row = {
    locale: "uk",
    live_index_uid: "fluxkit_catalog_uk",
    settings_hash: "0123456789abcd",
    document_version: 1,
    currency: "UAH",
    built_at: "2026-10-29T10:00:00Z",
    documents_count: 0,
  };

  describe("patterns and limits agree with core", () => {
    it("uses the core code pattern for reasons and error codes, and accepts every core reason", async () => {
      const source = CODE_PATTERN.source;
      for (const [table, constraint] of [
        ["search_sync_queue", "search_sync_queue_reason_check"],
        ["search_sync_queue", "search_sync_queue_last_error_code_check"],
        ["search_index_state", "search_index_state_last_error_code_check"],
      ] as const) {
        expect(await constraintDefinition(table, constraint)).toContain(`'${source}'`);
      }
      for (const reason of SEARCH_SYNC_REASONS) {
        await expectAccepted(() =>
          insert("search_sync_queue", { product_id: randomUUID(), reason }),
        );
      }
    });

    it("uses the core index uid pattern and accepts the core settings hash", async () => {
      expect(
        await constraintDefinition("search_index_state", "search_index_state_live_index_uid_check"),
      ).toContain(`'${SEARCH_INDEX_UID_PATTERN.source}'`);
      const { settingsHash } = deriveIndexSettings({
        locale: "uk",
        currency: "UAH",
        options: [],
        attributes: [],
        synonymGroups: [],
      });
      await expectAccepted(() =>
        insert("search_index_state", { ...LIVE_STATE, settings_hash: settingsHash }),
      );
    });

    it("mirrors the core synonym limits", () => {
      expect({
        minTerms: searchSchema.SYNONYM_MIN_TERMS,
        maxTerms: searchSchema.SYNONYM_MAX_TERMS,
        maxTermLength: searchSchema.SYNONYM_MAX_TERM_LENGTH,
      }).toEqual(SYNONYM_LIMITS);
    });
  });

  describe("search_sync_queue", () => {
    it("fills defaults and takes change_seq from the sequence, increasing", async () => {
      const first = await insert("search_sync_queue", {
        product_id: randomUUID(),
        reason: "product_changed",
      });
      const second = await insert("search_sync_queue", {
        product_id: randomUUID(),
        reason: "product_changed",
      });
      expect(first).toMatchObject({ attempts: 0, lease_until: null, last_error_code: null });
      expect(Number(second.change_seq)).toBeGreaterThan(Number(first.change_seq));
      expect(first.next_attempt_at).toBeInstanceOf(Date);
    });

    it("keeps one row per product and needs no product row (a deleted product is still removed from the index)", async () => {
      const productId = randomUUID();
      await insert("search_sync_queue", { product_id: productId, reason: "product_changed" });
      await expectViolation(
        () => insert("search_sync_queue", { product_id: productId, reason: "price_changed" }),
        UNIQUE_VIOLATION,
        "search_sync_queue_pkey",
      );
    });

    it("refuses reasons and error codes that are not codes, and negative attempts", async () => {
      for (const reason of ["", "Product", "a-b", "product changed", "x".repeat(65)]) {
        await expectViolation(
          () => insert("search_sync_queue", { product_id: randomUUID(), reason }),
          CHECK_VIOLATION,
          "search_sync_queue_reason_check",
        );
      }
      await expectViolation(
        () =>
          insert("search_sync_queue", {
            product_id: randomUUID(),
            reason: "product_changed",
            last_error_code: "Engine said: no",
          }),
        CHECK_VIOLATION,
        "search_sync_queue_last_error_code_check",
      );
      await expectViolation(
        () =>
          insert("search_sync_queue", {
            product_id: randomUUID(),
            reason: "product_changed",
            attempts: -1,
          }),
        CHECK_VIOLATION,
        "search_sync_queue_attempts_check",
      );
      await expectViolation(
        () =>
          insert("search_sync_queue", {
            product_id: randomUUID(),
            reason: "product_changed",
            change_seq: 0,
          }),
        CHECK_VIOLATION,
        "search_sync_queue_change_seq_check",
      );
      await expectViolation(
        () => insert("search_sync_queue", { product_id: randomUUID(), reason: null }),
        NOT_NULL_VIOLATION,
        undefined,
      );
    });
  });

  describe("search_index_state", () => {
    it("accepts an empty row of a locale and a live row with its build facts", async () => {
      await expectAccepted(() => insert("search_index_state", { locale: "en-us" }));
      await expectAccepted(() => insert("search_index_state", LIVE_STATE));
    });

    it("refuses a live index without what it was built with", async () => {
      for (const column of [
        "settings_hash",
        "document_version",
        "currency",
        "built_at",
        "documents_count",
      ]) {
        await expectViolation(
          () => insert("search_index_state", { ...LIVE_STATE, [column]: null }),
          CHECK_VIOLATION,
          "search_index_state_live_check",
        );
      }
    });

    it("refuses bad locales, uids, hashes, currencies and versions", async () => {
      const cases: [Row, string][] = [
        [{ locale: "UK" }, "search_index_state_locale_check"],
        [{ live_index_uid: "Fluxkit-catalog" }, "search_index_state_live_index_uid_check"],
        [{ live_index_uid: "a".repeat(129) }, "search_index_state_live_index_uid_check"],
        [
          { build_index_uid: "x y", build_started_at: "2026-10-29T10:00:00Z" },
          "search_index_state_build_index_uid_check",
        ],
        [{ settings_hash: "XYZ" }, "search_index_state_settings_hash_check"],
        [{ currency: "uah" }, "search_index_state_currency_check"],
        [{ document_version: 0 }, "search_index_state_document_version_check"],
        [{ documents_count: -1 }, "search_index_state_counts_check"],
        [{ failed_attempts: -1 }, "search_index_state_counts_check"],
        [{ last_error_code: "Engine down!" }, "search_index_state_last_error_code_check"],
      ];
      for (const [change, constraint] of cases) {
        await expectViolation(
          () => insert("search_index_state", { ...LIVE_STATE, ...change }),
          CHECK_VIOLATION,
          constraint,
        );
      }
    });

    it("ties a build uid to its start time and cursor, and never to the live uid", async () => {
      await expectViolation(
        () =>
          insert("search_index_state", {
            ...LIVE_STATE,
            build_index_uid: "fluxkit_catalog_uk_20261029100000",
          }),
        CHECK_VIOLATION,
        "search_index_state_build_check",
      );
      await expectViolation(
        () =>
          insert("search_index_state", {
            ...LIVE_STATE,
            build_started_at: "2026-10-29T10:00:00Z",
          }),
        CHECK_VIOLATION,
        "search_index_state_build_check",
      );
      await expectViolation(
        () =>
          insert("search_index_state", {
            ...LIVE_STATE,
            build_index_uid: "fluxkit_catalog_uk",
            build_started_at: "2026-10-29T10:00:00Z",
          }),
        CHECK_VIOLATION,
        "search_index_state_build_uid_distinct_check",
      );
      await expectViolation(
        () => insert("search_index_state", { ...LIVE_STATE, build_cursor: randomUUID() }),
        CHECK_VIOLATION,
        "search_index_state_cursor_check",
      );
      await expectAccepted(() =>
        insert("search_index_state", {
          ...LIVE_STATE,
          build_index_uid: "fluxkit_catalog_uk_20261029100000",
          build_started_at: "2026-10-29T10:00:00Z",
          build_cursor: randomUUID(),
        }),
      );
    });
  });

  describe("search_synonym_group", () => {
    async function createAdmin(): Promise<string> {
      const row = await insert("admin_user", {
        email: `search-schema-${randomUUID()}@example.com`,
        password_hash: "scrypt$16384$8$1$c2FsdA$aGFzaA",
        role: "owner",
      });
      return row.id as string;
    }

    it("accepts 2 to 20 terms of up to 50 characters", async () => {
      await expectAccepted(() =>
        insert("search_synonym_group", { locale: "uk", terms: ["викрутка", "відвертка"] }),
      );
      await expectAccepted(() =>
        insert("search_synonym_group", {
          locale: "uk",
          terms: Array.from({ length: 20 }, (_, index) => `${"т".repeat(48)}${index}`),
        }),
      );
    });

    it("refuses too few or too many, empty, NULL, too long or control-character terms", async () => {
      for (const terms of [
        ["одне"],
        [],
        Array.from({ length: 21 }, (_, index) => `t${index}`),
        ["a", ""],
        ["a", "b".repeat(51)],
        ["a".repeat(51), "b"],
        ["a", "b\u0007c"],
        ["a", "b\u001fc"],
      ]) {
        await expectViolation(
          () => insert("search_synonym_group", { locale: "uk", terms }),
          CHECK_VIOLATION,
          "search_synonym_group_terms_check",
        );
      }
      await expectViolation(
        () =>
          client.query(
            `insert into "search_synonym_group" (locale, terms) values ('uk', array['a', null]::text[])`,
          ),
        CHECK_VIOLATION,
        "search_synonym_group_terms_check",
      );
      await expectViolation(
        () => insert("search_synonym_group", { locale: "U K", terms: ["a", "b"] }),
        CHECK_VIOLATION,
        "search_synonym_group_locale_check",
      );
      await expectViolation(
        () =>
          insert("search_synonym_group", {
            locale: "uk",
            terms: ["a", "b"],
            created_at: "2026-10-29T10:00:00Z",
            updated_at: "2026-10-29T09:00:00Z",
          }),
        CHECK_VIOLATION,
        "search_synonym_group_updated_at_check",
      );
    });

    it("keeps a group when its admin is deleted and refuses an unknown admin", async () => {
      const adminId = await createAdmin();
      const group = await insert("search_synonym_group", {
        locale: "uk",
        terms: ["a", "b"],
        created_by_admin_id: adminId,
      });
      await client.query('delete from "admin_user" where id = $1', [adminId]);
      const kept = await client.query(
        'select created_by_admin_id from "search_synonym_group" where id = $1',
        [group.id],
      );
      expect(kept.rows).toEqual([{ created_by_admin_id: null }]);
      await expectViolation(
        () =>
          insert("search_synonym_group", {
            locale: "uk",
            terms: ["a", "b"],
            created_by_admin_id: randomUUID(),
          }),
        FOREIGN_KEY_VIOLATION,
        "search_synonym_group_created_by_admin_id_fkey",
      );
    });
  });

  describe("indexes and names", () => {
    it("covers every foreign key of the new tables with an index that starts with its columns", async () => {
      const result = await client.query(
        `select c.conrelid::regclass::text as table_name, c.conname
         from pg_constraint c
         where c.contype = 'f' and c.conrelid::regclass::text = any($1)
           and not exists (
             select 1 from pg_index i
             where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1] and i.indpred is null
           )`,
        [["search_sync_queue", "search_index_state", "search_synonym_group"]],
      );
      expect(result.rows).toEqual([]);
    });

    it("has no trigger and no foreign key on the queue (tombstones of deleted products)", async () => {
      const result = await client.query(
        `select count(*)::int as count from pg_constraint
         where contype = 'f' and conrelid = 'public.search_sync_queue'::regclass`,
      );
      expect(result.rows[0]).toEqual({ count: 0 });
    });

    it("keeps every constraint, index and table name within 63 characters", () => {
      for (const table of [
        searchSchema.searchSyncQueue,
        searchSchema.searchIndexState,
        searchSchema.searchSynonymGroup,
      ]) {
        const config = getTableConfig(table);
        for (const name of [
          config.name,
          ...config.checks.map((item) => item.name),
          ...config.indexes.map((item) => item.config.name ?? ""),
          ...config.foreignKeys.map((item) => item.getName()),
        ]) {
          expect(name.length, name).toBeLessThanOrEqual(63);
        }
      }
    });
  });
});
