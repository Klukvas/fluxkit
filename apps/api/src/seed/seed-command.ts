import { NestFactory } from "@nestjs/core";
import { loadEnv } from "@fluxkit/config";
import { catalogSeed, type CatalogSeed } from "@fluxkit/seeds";
import { AppModule } from "../app.module.js";
import { ProblemException } from "../common/problem.js";
import { CatalogSeeder, SEED_ENTITY_KINDS, type SeedSummary } from "./catalog-seeder.js";

export const ALLOW_PRODUCTION_FLAG = "--allow-production";

/**
 * The seed creates demo products, so it must not run against a production database by accident. It looks at the
 * same `NODE_ENV` the API uses; an explicit flag is the only way around it.
 */
export function assertSeedAllowed(
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): void {
  if (env["NODE_ENV"] === "production" && !argv.includes(ALLOW_PRODUCTION_FLAG)) {
    throw new Error(
      `Refusing to seed demo data: NODE_ENV is "production". Pass ${ALLOW_PRODUCTION_FLAG} only if you really want demo data in this database.`,
    );
  }
}

export function formatSummary(summary: SeedSummary): string {
  const lines = SEED_ENTITY_KINDS.map(
    (kind) =>
      `  ${kind.padEnd(13)} created ${String(summary.created[kind]).padStart(3)}, existing ${String(summary.existing[kind]).padStart(3)}`,
  );
  return [
    "Seed finished.",
    ...lines,
    `  variants      created ${String(summary.variantsCreated).padStart(3)} (with new products)`,
  ].join("\n");
}

/** A problem exception has a generic message; the field errors say what is wrong. */
export function describeError(error: unknown): string {
  if (error instanceof ProblemException) {
    return `${error.code}: ${error.detail}\n${JSON.stringify(error.errors ?? [], null, 2)}\n${error.stack ?? ""}`;
  }
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

export interface RunSeedCommandOptions {
  /** Tests only: replaces the demo catalog. */
  seed?: CatalogSeed;
}

/**
 * Boots the real application module as a standalone Nest context (no HTTP server), seeds through the admin
 * services and closes the context. Throws on any failure; the caller decides the exit code.
 */
export async function runSeedCommand(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  options: RunSeedCommandOptions = {},
): Promise<SeedSummary> {
  assertSeedAllowed(env, argv);
  const config = loadEnv(env);
  const app = await NestFactory.createApplicationContext(
    AppModule.register({
      databaseUrl: config.databaseUrl,
      // Optional features are not part of the demo catalog and must not run side effects while seeding.
      features: [],
      locale: { defaultLocale: config.defaultLocale, locales: config.locales },
    }),
    { logger: ["error", "warn"] },
  );
  try {
    return await CatalogSeeder.fromContext(app).run(options.seed ?? catalogSeed);
  } finally {
    await app.close();
  }
}
