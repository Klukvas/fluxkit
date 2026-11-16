import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const SCHEMA_LOCK_KEY = 7_426_001;

describe("0014 split listing migration (real Postgres, _test database only)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let lock: pg.PoolClient;
  const locale = randomUUID()
    .slice(0, 8)
    .replace(/[0-9]/g, (digit) => String.fromCharCode(97 + Number(digit)));
  const typeId = randomUUID();
  const optionId = randomUUID();
  const otherOptionId = randomUUID();

  beforeAll(async () => {
    await ensureMigrated();
    lock = await pool.connect();
    await lock.query("select pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
  });

  afterAll(async () => {
    try {
      await migrate(drizzle(pool), { migrationsFolder });
      await pool.query("delete from search_index_state where locale = $1", [locale]);
      await pool.query("delete from product_type where id = $1", [typeId]);
      await pool.query("delete from option where id = any($1::uuid[])", [
        [optionId, otherOptionId],
      ]);
    } finally {
      await lock.query("select pg_advisory_unlock($1)", [SCHEMA_LOCK_KEY]);
      lock.release();
      await pool.end();
    }
  });

  async function down(): Promise<void> {
    await pool.query(
      await readFile(`${migrationsFolder}/0016_email_provider_pin.down.sql`, "utf8"),
    );
    await pool.query(
      await readFile(`${migrationsFolder}/0015_inventory_reserved_upper_bound.down.sql`, "utf8"),
    );
    await pool.query(await readFile(`${migrationsFolder}/0014_split_listing.down.sql`, "utf8"));
  }

  async function columns(): Promise<string[]> {
    return (
      await pool.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public'
       and ((table_name = 'product_type_option' and column_name = 'splits_listing')
       or (table_name = 'search_index_state' and column_name = 'build_rebuild_key')) order by column_name`,
      )
    ).rows.map((row) => row.column_name);
  }

  it("up/down/up/down preserves legacy assignments, defaults false, and removes only its journal row", async () => {
    const journal = JSON.parse(
      await readFile(`${migrationsFolder}/meta/_journal.json`, "utf8"),
    ) as {
      entries: { tag: string; when: number }[];
    };
    const when = journal.entries.find((entry) => entry.tag === "0014_split_listing")?.when;
    expect(when).toBeTypeOf("number");
    const otherRows = async () =>
      (
        await pool.query(
          "select * from drizzle.__drizzle_migrations where created_at < $1 order by created_at",
          [when],
        )
      ).rows;
    const before = await otherRows();
    await down();
    const code = randomUUID().replaceAll("-", "");
    await pool.query(`insert into product_type (id, code, name) values ($1, $2, '{"uk":"Type"}')`, [
      typeId,
      `split_${code}`,
    ]);
    await pool.query(
      `insert into option (id, code, name) values ($1, $3, '{"uk":"Axis"}'), ($2, $4, '{"uk":"Other"}')`,
      [optionId, otherOptionId, `axis_${code}`, `other_${code}`],
    );
    await pool.query(
      "insert into product_type_option (product_type_id, option_id) values ($1, $2), ($1, $3)",
      [typeId, optionId, otherOptionId],
    );

    for (let pass = 0; pass < 2; pass += 1) {
      await migrate(drizzle(pool), { migrationsFolder });
      expect(await columns()).toEqual(["build_rebuild_key", "splits_listing"]);
      const assignments = await pool.query<{ splits_listing: boolean }>(
        "select splits_listing from product_type_option where product_type_id = $1",
        [typeId],
      );
      expect(assignments.rows).toEqual([{ splits_listing: false }, { splits_listing: false }]);
      await pool.query(
        "update product_type_option set splits_listing = true where product_type_id = $1 and option_id = $2",
        [typeId, optionId],
      );
      await expect(
        pool.query(
          "update product_type_option set splits_listing = true where product_type_id = $1 and option_id = $2",
          [typeId, otherOptionId],
        ),
      ).rejects.toMatchObject({ code: "23505", constraint: "product_type_one_split_option_idx" });
      if (pass === 0) {
        await pool.query("insert into search_index_state (locale) values ($1)", [locale]);
      }
      const state = await pool.query(
        "select build_rebuild_key from search_index_state where locale = $1",
        [locale],
      );
      expect(state.rows).toEqual([{ build_rebuild_key: null }]);
      await pool.query(
        "update search_index_state set build_rebuild_key = 'test-build-key' where locale = $1",
        [locale],
      );
      await down();
      expect(await columns()).toEqual([]);
      expect(
        (await pool.query("select to_regclass('public.product_type_one_split_option_idx') as name"))
          .rows,
      ).toEqual([{ name: null }]);
      expect(
        (
          await pool.query("select * from drizzle.__drizzle_migrations where created_at = $1", [
            when,
          ])
        ).rows,
      ).toEqual([]);
      expect(await otherRows()).toEqual(before);
      expect(
        (
          await pool.query(
            "select count(*)::int as count from product_type_option where product_type_id = $1",
            [typeId],
          )
        ).rows,
      ).toEqual([{ count: 2 }]);
    }
    await pool.query("delete from search_index_state where locale = $1", [locale]);
  });
});
