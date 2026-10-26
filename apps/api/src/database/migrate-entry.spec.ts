import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../test/env.js";
import { createScratchDatabase, type ScratchDatabase } from "../test/scratch-database.js";

// The built entry, exactly as `pnpm db:migrate` runs it (`pnpm test` builds first; a missing build fails loudly).
const ENTRY = fileURLToPath(new URL("../../dist/database/migrate.js", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

interface Outcome {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runEntry(
  env: Record<string, string | undefined>,
  options: { args?: string[]; cwd?: string } = {},
): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY, ...(options.args ?? [])], {
      env: { PATH: process.env["PATH"], ...env } as NodeJS.ProcessEnv,
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

describe("built db:migrate entry (real process, real Postgres)", () => {
  const baseUrl = requireTestDatabaseUrl();
  const scratch: ScratchDatabase[] = [];
  const tempFolders: string[] = [];
  let journal: JournalEntry[];

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

  /** Migrates the database up to the first `count` journal entries with the Drizzle migrator, as an older release would have. */
  async function migrateUpTo(database: ScratchDatabase, count: number): Promise<void> {
    const folder = await mkdtemp(join(tmpdir(), "fluxkit-entry-migrations-"));
    tempFolders.push(folder);
    await mkdir(join(folder, "meta"));
    const entries = journal.slice(0, count);
    await writeFile(
      join(folder, "meta/_journal.json"),
      JSON.stringify({ version: "7", dialect: "postgresql", entries }),
    );
    for (const entry of entries) {
      await writeFile(
        join(folder, `${entry.tag}.sql`),
        await readFile(join(MIGRATIONS, `${entry.tag}.sql`), "utf8"),
      );
    }
    const pool = new pg.Pool({ connectionString: database.url });
    try {
      await migrate(drizzle(pool), { migrationsFolder: folder });
    } finally {
      await pool.end();
    }
  }

  function expectNoSecrets(outcome: Outcome, urls: string[]): void {
    const output = `${outcome.stdout}${outcome.stderr}`;
    for (const url of urls) {
      const { password } = new URL(url);
      expect(output).not.toContain(url);
      if (password !== "") {
        expect(output).not.toContain(password);
        expect(output).not.toContain(decodeURIComponent(password));
      }
    }
  }

  beforeAll(async () => {
    if (!existsSync(ENTRY)) {
      throw new Error(`${ENTRY} does not exist: run "pnpm build" first (pnpm test does).`);
    }
    journal = (
      JSON.parse(await readFile(join(MIGRATIONS, "meta/_journal.json"), "utf8")) as {
        entries: JournalEntry[];
      }
    ).entries;
  });

  afterAll(async () => {
    for (const database of scratch) await database.drop();
    for (const folder of tempFolders) await rm(folder, { recursive: true, force: true });
  });

  it("migrates a fresh database, names it, lists every migration and exits 0", async () => {
    const database = await freshDatabase();

    const outcome = await runEntry({ DATABASE_URL: database.url });

    expect(outcome.code).toBe(0);
    expect(outcome.stderr).toBe("");
    expect(outcome.stdout).toBe(
      [
        `Migrating database "${database.name}"`,
        `Applied ${journal.length} migrations:`,
        ...journal.map((entry) => `  ${entry.tag}`),
        "",
      ].join("\n"),
    );
    expect(await appliedRows(database)).toEqual(journal.map((entry) => entry.when));
    for (const table of [
      "health_check",
      "product",
      "variant",
      "admin_user",
      "admin_session",
      "media_upload",
      "shipping_method",
      "shipment",
      "email_message",
      "customer_auth_token",
    ]) {
      expect(await tableExists(database, table), table).toBe(true);
    }
    expectNoSecrets(outcome, [database.url, baseUrl]);
  });

  it("is a no-op on the second run and says so", async () => {
    const database = await freshDatabase();
    await runEntry({ DATABASE_URL: database.url });
    const before = await appliedRows(database);

    const outcome = await runEntry({ DATABASE_URL: database.url });

    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toBe(
      `Migrating database "${database.name}"\nDatabase is up to date (${journal.length} migrations)\n`,
    );
    expect(await appliedRows(database)).toEqual(before);
  });

  it("applies only 0002 to 0007 to a database migrated up to 0001", async () => {
    const database = await freshDatabase();
    await migrateUpTo(database, 2);
    expect(await tableExists(database, "admin_user")).toBe(false);

    const outcome = await runEntry({ DATABASE_URL: database.url });

    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toBe(
      `Migrating database "${database.name}"\nApplied 6 migrations:\n  0002_admin_auth\n  0003_pricing_inventory\n  0004_cart_customers_orders\n  0005_media_upload\n  0006_shipping\n  0007_email\n`,
    );
    expect(await appliedRows(database)).toEqual(journal.map((entry) => entry.when));
    expect(await tableExists(database, "admin_user")).toBe(true);
  });

  it("exits 1 with a clear message when DATABASE_URL is missing", async () => {
    const outcome = await runEntry({});
    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toMatch(/Migration failed\./);
    expect(outcome.stderr).toMatch(/DATABASE_URL/);
  });

  it("exits 1 on an argument and touches nothing", async () => {
    const database = await freshDatabase();
    const outcome = await runEntry({ DATABASE_URL: database.url }, { args: ["--down"] });
    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toMatch(/takes no arguments/);
    expect(await tableExists(database, "health_check")).toBe(false);
  });

  it("exits 1 for an unreachable database and prints no password or connection string", async () => {
    const url = "postgres://migrator:s3cr3t%2Fpw%40x@127.0.0.1:1/some_db";
    const outcome = await runEntry({ DATABASE_URL: url });
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toMatch(/Migration failed\./);
    expect(outcome.stderr).toMatch(/ECONNREFUSED/);
    expectNoSecrets(outcome, [url]);
    expect(`${outcome.stdout}${outcome.stderr}`).not.toContain("s3cr3t");
  });

  it("refuses a database that is ahead of the code with exit 1 and changes nothing", async () => {
    const database = await freshDatabase();
    await runEntry({ DATABASE_URL: database.url });
    const newest = Math.max(...journal.map((entry) => entry.when));
    await query(
      database,
      'insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)',
      ["from-a-newer-release", newest + 1000],
    );
    const before = await appliedRows(database);

    const outcome = await runEntry({ DATABASE_URL: database.url });

    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toMatch(/newer than this code/);
    expect(outcome.stderr).toContain(database.name);
    expect(outcome.stdout).not.toMatch(/up to date/);
    expect(await appliedRows(database)).toEqual(before);
  });

  it("applies every migration exactly once when two processes start together", async () => {
    const database = await freshDatabase();

    const [first, second] = await Promise.all([
      runEntry({ DATABASE_URL: database.url }),
      runEntry({ DATABASE_URL: database.url }),
    ]);

    expect([first.code, second.code]).toEqual([0, 0]);
    expect(`${first.stderr}${second.stderr}`).toBe("");
    const applied = [first, second].map((outcome) =>
      outcome.stdout.includes("Applied") ? "applied" : "nothing",
    );
    expect(applied.sort()).toEqual(["applied", "nothing"]);
    expect(await appliedRows(database)).toEqual(journal.map((entry) => entry.when));
  });

  it("finds the migrations folder from another working directory", async () => {
    const database = await freshDatabase();
    const elsewhere = await mkdtemp(join(tmpdir(), "fluxkit-cwd-"));
    tempFolders.push(elsewhere);

    const fromTemp = await runEntry({ DATABASE_URL: database.url }, { cwd: elsewhere });
    const fromRoot = await runEntry({ DATABASE_URL: database.url }, { cwd: "/" });

    expect(fromTemp.code).toBe(0);
    expect(fromTemp.stdout).toMatch(/Applied \d+ migrations:/);
    expect(fromRoot.code).toBe(0);
    expect(fromRoot.stdout).toMatch(/Database is up to date/);
    expect(await appliedRows(database)).toEqual(journal.map((entry) => entry.when));
  });
});
