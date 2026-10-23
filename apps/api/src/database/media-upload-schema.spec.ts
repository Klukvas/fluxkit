import { getTableConfig } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ALLOWED_IMAGE_TYPES, isMediaKey } from "@fluxkit/core";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import { mediaUpload } from "./schema/media.js";

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
const NOT_NULL_VIOLATION = "23502";

const KEY = "0123456789abcdef0123456789abcdef.webp";
const SHA = "a".repeat(64);

type Row = Record<string, string | number | null>;

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Test setup bug: ${what} is missing`);
  return value;
}

describe("media_upload schema (migration 0005, real Postgres)", () => {
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

  const uploadRow = (extra: Row = {}): Row => ({
    storage_key: KEY,
    content_type: "image/webp",
    byte_size: 10,
    width: 1,
    height: 1,
    sha256: SHA,
    ...extra,
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
    expect(error, `expected ${constraint ?? code}, but the statement succeeded`).toBeInstanceOf(
      pg.DatabaseError,
    );
    if (!(error instanceof pg.DatabaseError)) throw new Error("unreachable");
    expect({ code: error.code, constraint: error.constraint }).toEqual({ code, constraint });
  }

  async function createAdmin(): Promise<string> {
    const row = await insert("admin_user", {
      email: `media-schema-${Math.random().toString(16).slice(2)}@example.com`,
      password_hash: "scrypt$16$8$1$test$test",
      role: "manager",
    });
    return row.id as string;
  }

  it("stores a valid row with the defaults: id, created_at, no attachment yet", async () => {
    const created = await insert("media_upload", uploadRow());
    expect(created).toMatchObject({
      storage_key: KEY,
      content_type: "image/webp",
      byte_size: 10,
      width: 1,
      height: 1,
      sha256: SHA,
      created_by: null,
      first_attached_at: null,
    });
    expect(typeof created.id).toBe("string");
    expect(created.created_at).toBeInstanceOf(Date);
  });

  it("refuses a second row with the same storage key (a key is never reused)", async () => {
    await insert("media_upload", uploadRow());
    await expectViolation(
      () => insert("media_upload", uploadRow({ sha256: "b".repeat(64) })),
      UNIQUE_VIOLATION,
      "media_upload_storage_key_key",
    );
  });

  it("accepts every key format core generates and refuses the traps, exactly like isMediaKey", async () => {
    const hex = "3f2a9c0d1b7e4f6a8c5d2e1f00aabbcc";
    const candidates = [
      ...Object.values(ALLOWED_IMAGE_TYPES).map(({ extension }) => `${hex}.${extension}`),
      `${hex}.jpeg`,
      `${hex}.gif`,
      `${hex.toUpperCase()}.png`,
      `${hex}.PNG`,
      `../${hex}.png`,
      `3f/2a/${hex}.png`,
      `${hex}.png\n`,
      `${hex.slice(1)}.png`,
      `${hex}0.png`,
      `${hex}.png.png`,
      `${hex}xpng`,
      "",
    ];
    for (const [index, candidate] of candidates.entries()) {
      const row = uploadRow({
        storage_key: candidate,
        sha256: index.toString(16).padStart(64, "0"),
      });
      if (isMediaKey(candidate)) {
        await client.query("savepoint key_ok");
        await insert("media_upload", row);
        await client.query("rollback to savepoint key_ok");
      } else {
        await expectViolation(
          () => insert("media_upload", row),
          CHECK_VIOLATION,
          "media_upload_storage_key_check",
        );
      }
    }
  });

  it.each([
    ["content_type", "image/gif", "media_upload_content_type_check"],
    ["content_type", "image/svg+xml", "media_upload_content_type_check"],
    ["content_type", "IMAGE/PNG", "media_upload_content_type_check"],
    ["byte_size", 0, "media_upload_byte_size_check"],
    ["byte_size", -1, "media_upload_byte_size_check"],
    ["width", 0, "media_upload_width_check"],
    ["height", 0, "media_upload_height_check"],
    ["sha256", "A".repeat(64), "media_upload_sha256_check"],
    ["sha256", "a".repeat(63), "media_upload_sha256_check"],
  ])("refuses %s = %j", async (column, value, constraint) => {
    await expectViolation(
      () => insert("media_upload", uploadRow({ [column]: value })),
      CHECK_VIOLATION,
      constraint,
    );
  });

  it.each(["storage_key", "content_type", "byte_size", "width", "height", "sha256"])(
    "requires %s",
    async (column) => {
      await expectViolation(
        () => insert("media_upload", uploadRow({ [column]: null })),
        NOT_NULL_VIOLATION,
        undefined,
      );
    },
  );

  it("references admin_user: an unknown creator is refused, deleting the creator keeps the row with created_by null", async () => {
    await expectViolation(
      () =>
        insert("media_upload", uploadRow({ created_by: "00000000-0000-4000-8000-000000000000" })),
      FOREIGN_KEY_VIOLATION,
      "media_upload_created_by_fkey",
    );
    const adminId = await createAdmin();
    const created = await insert("media_upload", uploadRow({ created_by: adminId }));
    await client.query(`delete from "admin_user" where id = $1`, [adminId]);
    const after = await client.query(`select created_by from "media_upload" where id = $1`, [
      created.id,
    ]);
    expect(after.rows).toEqual([{ created_by: null }]);
  });

  it("has the partial index of the cleanup job on created_at where first_attached_at is null", async () => {
    const result = await client.query(
      `select indexdef from pg_indexes where tablename = 'media_upload' and indexname = $1`,
      ["media_upload_created_at_unattached_idx"],
    );
    expect(result.rows).toHaveLength(1);
    expect(String(result.rows[0].indexdef)).toMatch(
      /\(created_at\) WHERE \(first_attached_at IS NULL\)/,
    );
  });

  it("uses names of at most 63 characters (Postgres truncates longer ones silently)", () => {
    const config = getTableConfig(mediaUpload);
    const names = [
      config.name,
      ...config.checks.map((check) => check.name),
      ...config.indexes.map((index) => index.config.name ?? ""),
      ...config.foreignKeys.map((foreignKey) => foreignKey.getName()),
      ...config.uniqueConstraints.map((constraint) => constraint.getName() ?? ""),
    ];
    for (const name of names) {
      expect(name.length, name).toBeGreaterThan(0);
      expect(name.length, name).toBeLessThanOrEqual(63);
    }
  });
});
