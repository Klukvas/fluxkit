import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app.factory.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import {
  FIXTURE_FEATURES_DIR,
  NOTEBOOK_DOWN_SQL,
  NOTEBOOK_MIGRATIONS,
} from "../test/notebook-feature.js";
import { createScratchDatabase, type ScratchDatabase } from "../test/scratch-database.js";
import {
  MigrateFailure,
  MigrateRefusal,
  MigrateUsageError,
  formatMigrateResult,
  migrationsFolder,
  runMigrateCommand,
} from "./migrate-command.js";
import { featureMigrationsTable, readJournal } from "./migration-journal.js";

const FEATURE_TABLE = `drizzle.${featureMigrationsTable("notebook")}`;

describe("feature migrations (ADR 0049, fixture `notebook`; real Postgres)", () => {
  const scratch: ScratchDatabase[] = [];
  const tempFolders: string[] = [];
  const io = { log: () => undefined };

  async function freshDatabase(): Promise<ScratchDatabase> {
    const database = await createScratchDatabase();
    scratch.push(database);
    return database;
  }

  async function query<T extends pg.QueryResultRow>(
    url: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      return (await client.query<T>(sql, params)).rows;
    } finally {
      await client.end();
    }
  }

  async function exists(url: string, name: string): Promise<boolean> {
    const rows = await query<{ name: string | null }>(url, "select to_regclass($1) as name", [
      name,
    ]);
    return rows[0]?.name !== null;
  }

  async function featureRows(url: string): Promise<number[]> {
    const rows = await query<{ created_at: string }>(
      url,
      `select created_at from ${FEATURE_TABLE} order by created_at`,
    );
    return rows.map((row) => Number(row.created_at));
  }

  function migrateWithNotebook(url: string, extra: Record<string, string> = {}) {
    return runMigrateCommand(
      [],
      { DATABASE_URL: url, FEATURES_ENABLED: "notebook", ...extra },
      io,
      { featuresDir: FIXTURE_FEATURES_DIR },
    );
  }

  afterAll(async () => {
    // Leave the shared database core-only (the reset spec ends with the fixture migrated): the schema specs drop core tables
    // by name, which the fixture's foreign key to media_upload blocks.
    await ensureMigrated();
    for (const database of scratch) await database.drop();
    for (const folder of tempFolders) await rm(folder, { recursive: true, force: true });
  });

  describe("pnpm db:migrate", () => {
    it("applies the core journal, then the enabled feature's into its own table", async () => {
      const database = await freshDatabase();
      const journal = await readJournal(NOTEBOOK_MIGRATIONS.folder);
      const core = await readJournal(migrationsFolder);

      const result = await migrateWithNotebook(database.url);

      expect(result.applied).toEqual(core.map((entry) => entry.tag));
      expect(result.features).toEqual([
        { name: "notebook", applied: ["0000_fixture_note"], total: journal.length },
      ]);
      expect(await exists(database.url, "public.fixture_note")).toBe(true);
      expect(await featureRows(database.url)).toEqual(journal.map((entry) => entry.when));
      // The core table records the core journal only.
      const coreRows = await query(database.url, 'select 1 from "drizzle"."__drizzle_migrations"');
      expect(coreRows).toHaveLength(core.length);
      expect(formatMigrateResult(result).split("\n").slice(-2)).toEqual([
        'Feature "notebook": applied 1 migration:',
        "  0000_fixture_note",
      ]);

      const second = await migrateWithNotebook(database.url);
      expect(second.applied).toEqual([]);
      expect(second.features).toEqual([{ name: "notebook", applied: [], total: journal.length }]);
      expect(formatMigrateResult(second)).toBe(
        `Database is up to date (${core.length} migrations)\nFeature "notebook" is up to date (1 migration)`,
      );
    });

    it("never migrates a disabled feature (no table, no migrations table)", async () => {
      const database = await freshDatabase();
      const result = await runMigrateCommand([], { DATABASE_URL: database.url }, io, {
        featuresDir: FIXTURE_FEATURES_DIR,
      });
      expect(result.features).toEqual([]);
      expect(await exists(database.url, "public.fixture_note")).toBe(false);
      expect(await exists(database.url, FEATURE_TABLE)).toBe(false);
    });

    it("skips an enabled feature that ships no migrations", async () => {
      const database = await freshDatabase();
      const result = await runMigrateCommand(
        [],
        { DATABASE_URL: database.url, FEATURES_ENABLED: "sample" },
        io,
        { featuresDir: FIXTURE_FEATURES_DIR },
      );
      expect(result.features).toEqual([]);
    });

    it("refuses an enabled feature without a package before touching the database", async () => {
      const database = await freshDatabase();
      const error: unknown = await runMigrateCommand(
        [],
        { DATABASE_URL: database.url, FEATURES_ENABLED: "gone" },
        io,
        { featuresDir: FIXTURE_FEATURES_DIR },
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(MigrateUsageError);
      expect((error as Error).message).toMatch(/Feature "gone" is enabled.*Nothing was changed/);
      expect(await exists(database.url, "public.health_check")).toBe(false);
    });

    it("refuses a feature table that is ahead of its journal, before applying anything, core included", async () => {
      const database = await freshDatabase();
      // Core migrated up to 0001 only, so a run that did not refuse first would apply the rest of core.
      const partial = await mkdtemp(join(tmpdir(), "fluxkit-feature-mig-"));
      tempFolders.push(partial);
      await mkdir(join(partial, "meta"));
      const entries = JSON.parse(
        await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
      ) as { entries: { tag: string }[] };
      const firstTwo = entries.entries.slice(0, 2);
      await writeFile(
        join(partial, "meta/_journal.json"),
        JSON.stringify({ version: "7", dialect: "postgresql", entries: firstTwo }),
      );
      for (const entry of firstTwo) {
        await writeFile(
          join(partial, `${entry.tag}.sql`),
          await readFile(join(migrationsFolder, `${entry.tag}.sql`), "utf8"),
        );
      }
      await runMigrateCommand([], { DATABASE_URL: database.url }, io, {
        migrationsFolder: partial,
      });
      await query(
        database.url,
        `create table ${FEATURE_TABLE} (id serial primary key, hash text not null, created_at bigint)`,
      );
      await query(database.url, `insert into ${FEATURE_TABLE} (hash, created_at) values ($1, $2)`, [
        "from-a-newer-release",
        Date.now() * 10,
      ]);

      const error: unknown = await migrateWithNotebook(database.url).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(MigrateRefusal);
      expect((error as Error).message).toMatch(
        /Refusing to migrate feature "notebook" of database ".*": it has migrations that are newer than this code/,
      );
      expect(await exists(database.url, "public.admin_user")).toBe(false);
      expect(await exists(database.url, "public.fixture_note")).toBe(false);
    });

    it("leaves the core migrated when a feature migration fails, and a re-run completes the feature", async () => {
      const database = await freshDatabase();
      const featuresDir = await mkdtemp(join(tmpdir(), "fluxkit-failing-feature-"));
      tempFolders.push(featuresDir);
      const drizzleDir = join(featuresDir, "flaky", "drizzle");
      await mkdir(join(drizzleDir, "meta"), { recursive: true });
      await writeFile(
        join(featuresDir, "flaky", "package.json"),
        JSON.stringify({ type: "module", fluxkit: { feature: "flaky" } }),
      );
      await writeFile(
        join(drizzleDir, "meta", "_journal.json"),
        JSON.stringify({
          version: "7",
          dialect: "postgresql",
          entries: [{ idx: 0, version: "7", when: 1, tag: "0000_flaky", breakpoints: true }],
        }),
      );
      const sql = join(drizzleDir, "0000_flaky.sql");
      await writeFile(
        sql,
        'create table "flaky_note" ("id" integer references "no_such_table"("id"));',
      );
      const env = { DATABASE_URL: database.url, FEATURES_ENABLED: "flaky" };
      const core = await readJournal(migrationsFolder);

      const error: unknown = await runMigrateCommand([], env, io, { featuresDir }).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(MigrateFailure);
      expect((error as Error).message).toMatch(/no_such_table/);
      // Core and features run in separate transactions: the core part stays applied, the feature part rolled back.
      expect(await exists(database.url, "public.health_check")).toBe(true);
      expect(await exists(database.url, "public.flaky_note")).toBe(false);

      await writeFile(sql, 'create table "flaky_note" ("id" integer primary key);');
      const rerun = await runMigrateCommand([], env, io, { featuresDir });

      expect(rerun.applied).toEqual([]);
      expect(rerun.total).toBe(core.length);
      expect(rerun.features).toEqual([{ name: "flaky", applied: ["0000_flaky"], total: 1 }]);
      expect(await exists(database.url, "public.flaky_note")).toBe(true);
    });

    it("goes up, down, up, down with the feature's hand-written down migration and its foreign key", async () => {
      const database = await freshDatabase();
      const down = await readFile(NOTEBOOK_DOWN_SQL, "utf8");
      const foreignKey = () =>
        query(database.url, "select 1 from pg_constraint where conname = $1", [
          "fixture_note_cover_upload_id_fkey",
        ]);

      for (let round = 0; round < 2; round += 1) {
        await migrateWithNotebook(database.url);
        expect(await exists(database.url, "public.fixture_note")).toBe(true);
        expect(await foreignKey()).toHaveLength(1);

        await query(database.url, down);
        expect(await exists(database.url, "public.fixture_note")).toBe(false);
        expect(await foreignKey()).toHaveLength(0);
        expect(await featureRows(database.url)).toEqual([]);
      }
    });
  });

  describe("API startup", () => {
    it("refuses to start while an enabled feature has unapplied migrations, naming the feature only", async () => {
      const database = await freshDatabase();
      await runMigrateCommand([], { DATABASE_URL: database.url }, io);
      const env = {
        databaseUrl: database.url,
        enabledFeatures: ["notebook"],
        featuresDir: FIXTURE_FEATURES_DIR,
      };

      const error: unknown = await createApp(env, { logLevels: [] }).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(
        /Enabled features have migrations that are not applied: "notebook" \(0000_fixture_note\)/,
      );
      expect((error as Error).message).not.toContain(database.name);

      await migrateWithNotebook(database.url);
      const app = await createApp(env, { logLevels: [] });
      await app.close();
    });

    it("refuses to start when an enabled feature's table records a migration newer than this code", async () => {
      const database = await freshDatabase();
      await migrateWithNotebook(database.url);
      await query(database.url, `insert into ${FEATURE_TABLE} (hash, created_at) values ($1, $2)`, [
        "from-a-newer-release",
        Date.now() * 10,
      ]);

      const error: unknown = await createApp(
        {
          databaseUrl: database.url,
          enabledFeatures: ["notebook"],
          featuresDir: FIXTURE_FEATURES_DIR,
        },
        { logLevels: [] },
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(
        /Enabled features have migrations that are newer than this code: "notebook" \(newest recorded created_at \d+\)/,
      );
      expect((error as Error).message).not.toMatch(/not applied/);
      expect((error as Error).message).not.toContain(database.name);
    });
  });

  describe("the test database reset (apps/api/src/test/migrate.ts)", () => {
    it("adds a feature's tables for a run with it and removes them for a run without it", async () => {
      const url = requireTestDatabaseUrl();
      await ensureMigrated([NOTEBOOK_MIGRATIONS]);
      expect(await exists(url, "public.fixture_note")).toBe(true);
      expect(await exists(url, FEATURE_TABLE)).toBe(true);

      await ensureMigrated();
      expect(await exists(url, "public.fixture_note")).toBe(false);
      expect(await exists(url, FEATURE_TABLE)).toBe(false);
      expect(await exists(url, "public.media_upload")).toBe(true);

      await ensureMigrated([NOTEBOOK_MIGRATIONS]);
      expect(await exists(url, "public.fixture_note")).toBe(true);
    });
  });
});
