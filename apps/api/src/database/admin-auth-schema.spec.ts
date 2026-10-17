import { fileURLToPath } from "node:url";
import { getTableName, is } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../test/env.js";
import { mapPostgresError } from "../common/postgres-errors.js";
import * as adminAuthSchema from "./schema/admin-auth.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Same value in every spec that needs the migrated schema: they run in parallel workers on one database. */
const SCHEMA_LOCK_KEY = 7_426_001;

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

type Value = string | number | boolean | null;
type Row = Record<string, Value>;

const PASSWORD_HASH = "scrypt$16384$8$1$c2FsdA$aGFzaA";
const TOKEN_HASH = "a".repeat(64);

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Test setup bug: ${what} is missing`);
  return value;
}

describe("admin auth schema (real Postgres)", () => {
  // Destructive: drops the whole schema in beforeAll/afterAll. requireTestDatabaseUrl refuses non-"_test" databases.
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let lockClient: pg.PoolClient;
  // Every test runs in its own transaction that is rolled back, so tests never see each other's rows.
  let client: pg.PoolClient;

  async function dropEverything(): Promise<void> {
    await pool.query('drop schema if exists "drizzle" cascade');
    // Reverse dependency order, no CASCADE (same reasoning as migrations.spec.ts).
    for (const name of [
      "domain_event",
      "order_item_reservation",
      "order_status_change",
      "order_adjustment",
      "order_item",
      "sales_order",
      "cart_item",
      "cart",
      "customer_session",
      "customer",
      "reservation",
      "stock_movement",
      "inventory_level",
      "price",
      "location",
      "admin_session",
      "admin_user",
      "media",
      "variant_option_value",
      "variant",
      "product_option_value",
      "product_option",
      "product_category",
      "product",
      "brand",
      "category",
      "product_type_option",
      "product_type_attribute",
      "product_type",
      "option_value",
      "option",
      "attribute_option",
      "attribute",
      "health_check",
    ]) {
      await pool.query(`drop table if exists "${name}"`);
    }
    await pool.query('drop function if exists "order_status_change_append_only"()');
    await pool.query('drop function if exists "order_adjustment_append_only"()');
    await pool.query('drop function if exists "order_item_immutable"()');
    await pool.query('drop function if exists "stock_movement_append_only"()');
  }

  beforeAll(async () => {
    lockClient = await pool.connect();
    await lockClient.query("select pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
    await dropEverything();
    await migrate(drizzle(pool), { migrationsFolder });
  }, 120_000);

  afterAll(async () => {
    try {
      await dropEverything();
    } finally {
      await lockClient.query("select pg_advisory_unlock($1)", [SCHEMA_LOCK_KEY]);
      lockClient.release();
      await pool.end();
    }
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

  async function insertId(table: string, row: Row): Promise<string> {
    const created = await insert(table, row);
    if (typeof created.id !== "string") throw new Error(`Test setup bug: ${table} has no id`);
    return created.id;
  }

  async function count(table: string, where = "true"): Promise<number> {
    const result = await client.query(
      `select count(*)::int as count from "${table}" where ${where}`,
    );
    return must(result.rows[0] as { count: number } | undefined, "count row").count;
  }

  /** Runs one statement that must fail; asserts SQLSTATE and constraint name, then undoes the failed statement. */
  async function expectViolation(
    run: () => Promise<unknown>,
    code: string,
    constraint: string,
  ): Promise<pg.DatabaseError> {
    await client.query("savepoint expected_violation");
    const error = await run().then(
      () => undefined,
      (reason: unknown) => reason,
    );
    await client.query("rollback to savepoint expected_violation");
    expect(
      error,
      `expected "${constraint}" to be violated, but the statement succeeded`,
    ).toBeInstanceOf(pg.DatabaseError);
    if (!(error instanceof pg.DatabaseError)) throw new Error("unreachable");
    expect({ code: error.code, constraint: error.constraint }).toEqual({ code, constraint });
    return error;
  }

  const userRow = (extra: Row = {}): Row => ({
    email: "owner@example.com",
    password_hash: PASSWORD_HASH,
    role: "owner",
    ...extra,
  });
  const createUser = (extra: Row = {}) => insertId("admin_user", userRow(extra));
  const sessionRow = (userId: string, extra: Row = {}): Row => ({
    user_id: userId,
    token_hash: TOKEN_HASH,
    expires_at: "2099-01-01T00:00:00Z",
    ...extra,
  });

  describe("admin_user", () => {
    it("accepts a user and applies the defaults", async () => {
      const created = await insert("admin_user", userRow());
      expect(created).toMatchObject({
        email: "owner@example.com",
        role: "owner",
        is_active: true,
        failed_login_count: 0,
        locked_until: null,
        last_login_at: null,
      });
      expect(created.password_changed_at).toBeInstanceOf(Date);
      expect(created.created_at).toBeInstanceOf(Date);
      expect(created.updated_at).toBeInstanceOf(Date);
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("accepts every role of the list", async () => {
      for (const role of ["owner", "manager", "viewer"]) {
        await insert("admin_user", userRow({ email: `${role}@example.com`, role }));
      }
      expect(await count("admin_user")).toBe(3);
    });

    it("rejects a duplicate email", async () => {
      await createUser();
      await expectViolation(
        () => insert("admin_user", userRow()),
        UNIQUE_VIOLATION,
        "admin_user_email_key",
      );
    });

    it("rejects an upper-case email, so uniqueness cannot be bypassed by case", async () => {
      await expectViolation(
        () => insert("admin_user", userRow({ email: "Owner@Example.com" })),
        CHECK_VIOLATION,
        "admin_user_email_check",
      );
    });

    it("rejects an email shorter than 3 or longer than 254 characters and accepts the limits", async () => {
      await expectViolation(
        () => insert("admin_user", userRow({ email: "a@" })),
        CHECK_VIOLATION,
        "admin_user_email_check",
      );
      await expectViolation(
        () => insert("admin_user", userRow({ email: `${"a".repeat(253)}@b` })),
        CHECK_VIOLATION,
        "admin_user_email_check",
      );
      await insert("admin_user", userRow({ email: "a@b" }));
      await insert("admin_user", userRow({ email: `${"a".repeat(252)}@b` }));
      expect(await count("admin_user")).toBe(2);
    });

    it("rejects a role outside the list", async () => {
      await expectViolation(
        () => insert("admin_user", userRow({ role: "superuser" })),
        CHECK_VIOLATION,
        "admin_user_role_check",
      );
      await expectViolation(
        () => insert("admin_user", userRow({ role: "Owner" })),
        CHECK_VIOLATION,
        "admin_user_role_check",
      );
    });

    it("rejects an empty password hash", async () => {
      await expectViolation(
        () => insert("admin_user", userRow({ password_hash: "" })),
        CHECK_VIOLATION,
        "admin_user_password_hash_check",
      );
    });

    it("rejects a negative failed login count and accepts zero", async () => {
      await expectViolation(
        () => insert("admin_user", userRow({ failed_login_count: -1 })),
        CHECK_VIOLATION,
        "admin_user_failed_login_count_check",
      );
      await insert("admin_user", userRow({ failed_login_count: 0 }));
    });

    it("rejects NULL in required columns", async () => {
      for (const column of ["email", "password_hash", "role"]) {
        await client.query("savepoint not_null");
        await expect(insert("admin_user", userRow({ [column]: null }))).rejects.toMatchObject({
          code: "23502",
          column,
        });
        await client.query("rollback to savepoint not_null");
      }
    });

    it("moves updated_at when a row is updated through Drizzle ($onUpdate)", async () => {
      const userId = await createUser({ updated_at: "2020-01-01T00:00:00Z" });
      const db = drizzle(client);
      await db
        .update(adminAuthSchema.adminUser)
        .set({ isActive: false })
        .where(eq(adminAuthSchema.adminUser.id, userId));
      const result = await client.query<{ updated_at: Date; created_at: Date }>(
        "select updated_at, created_at from admin_user where id = $1",
        [userId],
      );
      const row = must(result.rows[0], "updated user");
      expect(row.updated_at.getTime()).toBeGreaterThan(new Date("2020-01-02T00:00:00Z").getTime());
    });

    it("maps a duplicate email to a 409 conflict on the field email (error mapper learns it from the schema)", async () => {
      await createUser();
      const error = await expectViolation(
        () => insert("admin_user", userRow()),
        UNIQUE_VIOLATION,
        "admin_user_email_key",
      );
      const problem = mapPostgresError(error);
      expect(problem?.getStatus()).toBe(409);
      expect(problem).toMatchObject({
        code: "conflict",
        extensions: { field: "email", constraint: "admin_user_email_key" },
      });
    });
  });

  describe("admin_session", () => {
    it("accepts a session and applies the defaults", async () => {
      const userId = await createUser();
      const created = await insert("admin_session", sessionRow(userId));
      expect(created).toMatchObject({ user_id: userId, token_hash: TOKEN_HASH });
      expect(created.created_at).toBeInstanceOf(Date);
      expect(created.last_seen_at).toBeInstanceOf(Date);
    });

    it("rejects a duplicate token hash", async () => {
      const userId = await createUser();
      await insert("admin_session", sessionRow(userId));
      await expectViolation(
        () => insert("admin_session", sessionRow(userId)),
        UNIQUE_VIOLATION,
        "admin_session_token_hash_key",
      );
    });

    it("rejects a token hash that is not 64 lower-case hex characters", async () => {
      const userId = await createUser();
      const bad = [
        "g".repeat(64), // not hex
        "A".repeat(64), // upper case
        "a".repeat(63), // too short
        "a".repeat(65), // too long
        "",
        `${"a".repeat(64)}\n`, // trailing newline must not slip through
        `${"a".repeat(32)} ${"a".repeat(31)}`,
      ];
      for (const tokenHash of bad) {
        await expectViolation(
          () => insert("admin_session", sessionRow(userId, { token_hash: tokenHash })),
          CHECK_VIOLATION,
          "admin_session_token_hash_check",
        );
      }
      await insert(
        "admin_session",
        sessionRow(userId, { token_hash: "0123456789abcdef".repeat(4) }),
      );
    });

    it("rejects expires_at that is not after created_at", async () => {
      const userId = await createUser();
      await expectViolation(
        () =>
          insert(
            "admin_session",
            sessionRow(userId, {
              created_at: "2030-01-01T00:00:00Z",
              expires_at: "2030-01-01T00:00:00Z",
            }),
          ),
        CHECK_VIOLATION,
        "admin_session_expires_at_check",
      );
      await expectViolation(
        () =>
          insert(
            "admin_session",
            sessionRow(userId, {
              created_at: "2030-01-01T00:00:01Z",
              expires_at: "2030-01-01T00:00:00Z",
            }),
          ),
        CHECK_VIOLATION,
        "admin_session_expires_at_check",
      );
      await insert(
        "admin_session",
        sessionRow(userId, {
          created_at: "2030-01-01T00:00:00Z",
          expires_at: "2030-01-01T00:00:01Z",
        }),
      );
    });

    it("rejects a session without an existing user", async () => {
      await expectViolation(
        () => insert("admin_session", sessionRow("00000000-0000-4000-8000-000000000000")),
        FOREIGN_KEY_VIOLATION,
        "admin_session_user_id_fkey",
      );
    });

    it("deleting a user removes its sessions only", async () => {
      const first = await createUser({ email: "first@example.com" });
      const second = await createUser({ email: "second@example.com" });
      await insert("admin_session", sessionRow(first, { token_hash: "1".repeat(64) }));
      await insert("admin_session", sessionRow(first, { token_hash: "2".repeat(64) }));
      await insert("admin_session", sessionRow(second, { token_hash: "3".repeat(64) }));
      await client.query("delete from admin_user where id = $1", [first]);
      expect(await count("admin_session", `user_id = '${first}'`)).toBe(0);
      expect(await count("admin_session", `user_id = '${second}'`)).toBe(1);
      expect(await count("admin_user", `id = '${second}'`)).toBe(1);
    });

    it("stores no personal data besides the user reference (no IP address, no user agent)", async () => {
      const result = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'admin_session' order by column_name`,
      );
      expect(result.rows.map((row) => row.column_name)).toEqual([
        "created_at",
        "expires_at",
        "id",
        "last_seen_at",
        "token_hash",
        "user_id",
      ]);
    });
  });

  describe("names", () => {
    interface Declared {
      kind: string;
      name: string;
    }

    function declaredNames(): Declared[] {
      const names: Declared[] = [];
      const tables = Object.values(adminAuthSchema).filter((value) => is(value, PgTable));
      expect(tables).toHaveLength(2);
      for (const table of tables) {
        const config = getTableConfig(table);
        names.push({ kind: "table", name: getTableName(table) });
        for (const item of config.indexes) {
          names.push({
            kind: "index",
            name: must(item.config.name, `index name in ${config.name}`),
          });
        }
        for (const item of config.foreignKeys)
          names.push({ kind: "foreign key", name: item.getName() });
        for (const item of config.checks) names.push({ kind: "check", name: item.name });
        for (const item of config.uniqueConstraints) {
          names.push({ kind: "unique", name: must(item.name, `unique name in ${config.name}`) });
        }
        for (const item of config.primaryKeys)
          names.push({ kind: "primary key", name: item.getName() });
      }
      return names;
    }

    it("declares every constraint, index and table name with at most 63 characters, and the DB has them unchanged", async () => {
      const declared = declaredNames();
      // 2 tables, 2 pkeys (implicit, not listed), 1 fkey, 2 unique, 6 checks, 2 indexes.
      expect(declared.length).toBeGreaterThanOrEqual(13);

      // Postgres silently truncates longer identifiers to 63 characters, so check the declared names.
      const tooLong = declared.filter((item) => item.name.length > 63);
      expect(tooLong).toEqual([]);

      const result = await client.query<{ name: string }>(`
        select conname as name from pg_constraint c join pg_namespace n on n.oid = c.connamespace
          where n.nspname = 'public' and c.contype <> 'n'
        union
        select relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'i')
      `);
      const inDatabase = new Set(result.rows.map((row) => row.name));
      const missing = declared.filter((item) => !inDatabase.has(item.name));
      expect(missing).toEqual([]);
    });

    it("has no constraint on an admin auth table that the schema did not name (single-column primary keys are <table>_pkey)", async () => {
      const declared = new Set(declaredNames().map((item) => item.name));
      const result = await client.query<{ name: string; table: string }>(`
        select c.conname as name, t.relname as "table"
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = c.connamespace
        where n.nspname = 'public' and c.contype <> 'n' and t.relname in ('admin_user', 'admin_session')
      `);
      expect(result.rows.length).toBeGreaterThan(0);
      const unnamed = result.rows.filter(
        (row) => !declared.has(row.name) && row.name !== `${row.table}_pkey`,
      );
      expect(unnamed).toEqual([]);
    });

    it("has no index on an admin auth table that the schema did not declare", async () => {
      const declared = new Set(declaredNames().map((item) => item.name));
      const result = await client.query<{ name: string; table: string }>(`
        select i.relname as name, t.relname as "table"
        from pg_index x
        join pg_class i on i.oid = x.indexrelid
        join pg_class t on t.oid = x.indrelid
        join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public' and t.relname in ('admin_user', 'admin_session')
      `);
      expect(result.rows.length).toBeGreaterThan(0);
      // Indexes behind primary keys and unique constraints carry the constraint's name.
      const undeclared = result.rows.filter(
        (row) => !declared.has(row.name) && row.name !== `${row.table}_pkey`,
      );
      expect(undeclared).toEqual([]);
    });
  });
});
