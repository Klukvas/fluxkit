import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createScratchDatabase, type ScratchDatabase } from "../test/scratch-database.js";
import {
  MIGRATION_LOCK_KEY,
  MigrateFailure,
  MigrateRefusal,
  MigrateUsageError,
  formatMigrateResult,
  migrationsFolder,
  runMigrateCommand,
} from "./migrate-command.js";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

async function readJournal(folder: string): Promise<JournalEntry[]> {
  const journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8")) as {
    entries: JournalEntry[];
  };
  return journal.entries;
}

describe("runMigrateCommand (real Postgres)", () => {
  const scratch: ScratchDatabase[] = [];
  const tempFolders: string[] = [];
  const logs: string[] = [];
  const io = { log: (line: string) => void logs.push(line) };

  async function freshDatabase(): Promise<ScratchDatabase> {
    const database = await createScratchDatabase();
    scratch.push(database);
    return database;
  }

  async function query<T extends pg.QueryResultRow>(
    database: ScratchDatabase,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    try {
      return (await client.query<T>(sql, params)).rows;
    } finally {
      await client.end();
    }
  }

  async function appliedRows(database: ScratchDatabase): Promise<number[]> {
    const rows = await query<{ created_at: string }>(
      database,
      'select created_at from "drizzle"."__drizzle_migrations" order by created_at',
    );
    return rows.map((row) => Number(row.created_at));
  }

  async function tableExists(database: ScratchDatabase, name: string): Promise<boolean> {
    const rows = await query<{ name: string | null }>(database, "select to_regclass($1) as name", [
      `public.${name}`,
    ]);
    return rows[0]?.name !== null;
  }

  /** A migrations folder holding only the first `count` entries of the real journal. */
  async function partialFolder(count: number): Promise<string> {
    const folder = await mkdtemp(join(tmpdir(), "fluxkit-migrations-"));
    tempFolders.push(folder);
    await mkdir(join(folder, "meta"));
    const entries = (await readJournal(migrationsFolder)).slice(0, count);
    await writeFile(
      join(folder, "meta/_journal.json"),
      JSON.stringify({ version: "7", dialect: "postgresql", entries }),
    );
    for (const entry of entries) {
      await writeFile(
        join(folder, `${entry.tag}.sql`),
        await readFile(join(migrationsFolder, `${entry.tag}.sql`), "utf8"),
      );
    }
    return folder;
  }

  afterAll(async () => {
    for (const database of scratch) await database.drop();
    for (const folder of tempFolders) await rm(folder, { recursive: true, force: true });
  });

  it("resolves the migrations folder from the file location, not from the working directory", async () => {
    expect(migrationsFolder).toBe(fileURLToPath(new URL("../../drizzle", import.meta.url)));
    expect((await readJournal(migrationsFolder)).length).toBeGreaterThanOrEqual(3);
  });

  it("applies every migration to a fresh database, in journal order, and names the database", async () => {
    const database = await freshDatabase();
    const journal = await readJournal(migrationsFolder);
    logs.length = 0;

    const result = await runMigrateCommand([], { DATABASE_URL: database.url }, io);

    expect(result.applied).toEqual(journal.map((entry) => entry.tag));
    expect(result.total).toBe(journal.length);
    expect(result.database).toBe(database.name);
    expect(logs).toEqual([`Migrating database "${database.name}"`]);
    expect(await appliedRows(database)).toEqual(journal.map((entry) => entry.when));
    expect(await tableExists(database, "health_check")).toBe(true);
    expect(await tableExists(database, "product")).toBe(true);
    expect(await tableExists(database, "admin_user")).toBe(true);
    expect(formatMigrateResult(result)).toBe(
      [`Applied ${journal.length} migrations:`, ...journal.map((entry) => `  ${entry.tag}`)].join(
        "\n",
      ),
    );
  });

  it("applies nothing on a second run and says so", async () => {
    const database = await freshDatabase();
    const env = { DATABASE_URL: database.url };
    await runMigrateCommand([], env, io);
    const before = await appliedRows(database);

    const second = await runMigrateCommand([], env, io);

    expect(second.applied).toEqual([]);
    expect(formatMigrateResult(second)).toBe(
      `Database is up to date (${before.length} migrations)`,
    );
    expect(await appliedRows(database)).toEqual(before);
  });

  it("applies only the pending migrations to a database migrated up to 0001", async () => {
    const database = await freshDatabase();
    const env = { DATABASE_URL: database.url };
    const journal = await readJournal(migrationsFolder);
    const upToCatalog = await runMigrateCommand([], env, io, {
      migrationsFolder: await partialFolder(2),
    });
    expect(upToCatalog.applied).toEqual(["0000_health_check", "0001_catalog"]);
    expect(await tableExists(database, "admin_user")).toBe(false);

    const rest = await runMigrateCommand([], env, io);

    expect(rest.applied).toEqual(journal.slice(2).map((entry) => entry.tag));
    expect(rest.applied[0]).toBe("0002_admin_auth");
    expect(await tableExists(database, "admin_user")).toBe(true);
    expect(await appliedRows(database)).toEqual(journal.map((entry) => entry.when));
  });

  it("fails with a clear message when DATABASE_URL is missing or empty, and takes no arguments", async () => {
    await expect(runMigrateCommand([], {}, io)).rejects.toThrow(/DATABASE_URL/);
    await expect(runMigrateCommand([], { DATABASE_URL: "" }, io)).rejects.toThrow(/DATABASE_URL/);
    const withArgument = runMigrateCommand(
      ["--down"],
      { DATABASE_URL: "postgres://x@127.0.0.1:1/x" },
      io,
    );
    await expect(withArgument).rejects.toBeInstanceOf(MigrateUsageError);
    await expect(withArgument).rejects.toThrow(/takes no arguments/);
  });

  it("reports an unreachable database without the password or the connection string", async () => {
    const url = "postgres://migrator:s3cr3t%2Fpw%40x@127.0.0.1:1/some_db";
    const error: unknown = await runMigrateCommand([], { DATABASE_URL: url }, io).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(MigrateFailure);
    const text = String((error as Error).message);
    expect(text).toMatch(/ECONNREFUSED/);
    for (const secret of ["s3cr3t", "%2Fpw", "/pw@x", url]) {
      expect(text).not.toContain(secret);
    }
  });

  it("refuses a database that is ahead of the code and changes nothing", async () => {
    const database = await freshDatabase();
    const env = { DATABASE_URL: database.url };
    await runMigrateCommand([], env, io);
    const journal = await readJournal(migrationsFolder);
    const newest = Math.max(...journal.map((entry) => entry.when));
    await query(
      database,
      'insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)',
      ["from-a-newer-release", newest + 1000],
    );
    const before = await appliedRows(database);

    const error: unknown = await runMigrateCommand([], env, io).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MigrateRefusal);
    expect((error as Error).message).toMatch(/newer than this code/);
    expect((error as Error).message).toContain(database.name);
    expect(await appliedRows(database)).toEqual(before);
  });

  it("refuses an ahead database even when the table holds fewer rows than the journal", async () => {
    const database = await freshDatabase();
    await query(database, 'create schema "drizzle"');
    await query(
      database,
      'create table "drizzle"."__drizzle_migrations" (id serial primary key, hash text not null, created_at bigint)',
    );
    await query(
      database,
      'insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)',
      ["future", Date.now() * 10],
    );
    await expect(runMigrateCommand([], { DATABASE_URL: database.url }, io)).rejects.toBeInstanceOf(
      MigrateRefusal,
    );
    expect(await tableExists(database, "health_check")).toBe(false);
  });

  it("does not let a second instance migrate while another holds the advisory lock", async () => {
    const database = await freshDatabase();
    const holder = new pg.Client({ connectionString: database.url });
    await holder.connect();
    try {
      await holder.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
      let finished = false;
      const run = runMigrateCommand([], { DATABASE_URL: database.url }, io).finally(() => {
        finished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(finished).toBe(false);
      expect(await tableExists(database, "health_check")).toBe(false);

      await holder.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
      const result = await run;
      expect(result.applied.length).toBeGreaterThanOrEqual(3);
    } finally {
      await holder.end();
    }
  });

  it("applies exactly once when two instances start together, the second one reports nothing to apply", async () => {
    const database = await freshDatabase();
    const env = { DATABASE_URL: database.url };
    const results = await Promise.all([
      runMigrateCommand([], env, io),
      runMigrateCommand([], env, io),
    ]);
    const journal = await readJournal(migrationsFolder);
    const counts = results.map((result) => result.applied.length).sort((a, b) => a - b);
    expect(counts).toEqual([0, journal.length]);
    expect(await appliedRows(database)).toEqual(journal.map((entry) => entry.when));
  });

  it("surfaces a failing migration, rolls it back as the migrator does and releases the lock", async () => {
    const database = await freshDatabase();
    const folder = await mkdtemp(join(tmpdir(), "fluxkit-broken-"));
    tempFolders.push(folder);
    await mkdir(join(folder, "meta"));
    await writeFile(
      join(folder, "meta/_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [{ idx: 0, version: "7", when: 1, tag: "0000_broken", breakpoints: true }],
      }),
    );
    await writeFile(
      join(folder, "0000_broken.sql"),
      'create table "probe" ("id" integer);--> statement-breakpoint\nselect * from "does_not_exist";',
    );

    const error: unknown = await runMigrateCommand([], { DATABASE_URL: database.url }, io, {
      migrationsFolder: folder,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MigrateFailure);
    expect((error as Error).message).toMatch(/does_not_exist/);
    expect(await tableExists(database, "probe")).toBe(false);
    expect(await appliedRows(database)).toEqual([]);

    const probe = new pg.Client({ connectionString: database.url });
    await probe.connect();
    try {
      const free = await probe.query<{ free: boolean }>("select pg_try_advisory_lock($1) as free", [
        MIGRATION_LOCK_KEY,
      ]);
      expect(free.rows[0]?.free).toBe(true);
    } finally {
      await probe.end();
    }
  });
});
