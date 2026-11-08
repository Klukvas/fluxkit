import { NestFactory } from "@nestjs/core";
import { loadEnv } from "@fluxkit/config";
import {
  DEFAULT_SEED_DATASET,
  seedDatasets,
  type CatalogSeed,
  type SeedDatasetName,
} from "@fluxkit/seeds";
import { AppModule } from "../app.module.js";
import { mediaConfigOf } from "../app.factory.js";
import { prepareDefaultMediaDirectory } from "../media/media-directory.js";
import { toPricingConfig } from "../common/pricing-config.js";
import { ProblemException } from "../common/problem.js";
import {
  DEFAULT_SHIPPING_PROVIDERS_DIR,
  loadShippingProviders,
  type LoadedShippingProvider,
} from "../shipping/registry/index.js";
import { CatalogSeeder, SEED_ENTITY_KINDS, type SeedSummary } from "./catalog-seeder.js";

export const ALLOW_PRODUCTION_FLAG = "--allow-production";
export const DATASET_FLAG = "--dataset";

function isDatasetName(name: string): name is SeedDatasetName {
  return Object.hasOwn(seedDatasets, name);
}

/**
 * The dataset named by `--dataset <name>` (or `--dataset=<name>`): `coffee` (the demo shop, the default of `pnpm seed`) or
 * `test` (the test fixture of `pnpm seed:test`, the e2e suites and the feature matrix). A missing or unknown name fails
 * before anything is touched: a typo must not silently seed the other catalog.
 */
export function datasetOf(argv: readonly string[]): SeedDatasetName {
  const names = Object.keys(seedDatasets).join(", ");
  let chosen: string | undefined;
  for (const [index, argument] of argv.entries()) {
    if (argument === DATASET_FLAG) {
      chosen = argv[index + 1];
      if (chosen === undefined || chosen.startsWith("--")) {
        throw new Error(`${DATASET_FLAG} needs a dataset name: one of ${names}.`);
      }
    } else if (argument.startsWith(`${DATASET_FLAG}=`)) {
      chosen = argument.slice(DATASET_FLAG.length + 1);
    }
  }
  if (chosen === undefined) {
    return DEFAULT_SEED_DATASET;
  }
  if (!isDatasetName(chosen)) {
    throw new Error(`Unknown seed dataset "${chosen}": use one of ${names}.`);
  }
  return chosen;
}

/** Database names the seed accepts without the flag: throwaway databases only. */
const SEEDABLE_DATABASE_SUFFIXES = ["_test", "_dev", "_demo", "_local"] as const;

function databaseNameOf(databaseUrl: string): string | undefined {
  try {
    return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  } catch {
    // An unparseable URL has no known name: the guard then refuses, and loadEnv reports the URL itself otherwise.
    return undefined;
  }
}

/**
 * The seed creates demo products, so it must not run against a production database by accident. Two checks,
 * and `--allow-production` is the single override for both:
 * - `NODE_ENV` (the variable the API uses) must not be `production` (compared trimmed and case-insensitively);
 * - when `DATABASE_URL` is set, the database name must end in `_test`, `_dev`, `_demo` or `_local`.
 *   A missing `DATABASE_URL` is not judged here: `loadEnv` fails loudly on it afterwards.
 */
export function assertSeedAllowed(
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): void {
  if (argv.includes(ALLOW_PRODUCTION_FLAG)) {
    return;
  }
  if ((env["NODE_ENV"] ?? "").trim().toLowerCase() === "production") {
    throw new Error(
      `Refusing to seed demo data: NODE_ENV is "production". Pass ${ALLOW_PRODUCTION_FLAG} only if you really want demo data in this database.`,
    );
  }
  const databaseUrl = env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl === "") {
    return;
  }
  const name = databaseNameOf(databaseUrl);
  if (
    name === undefined ||
    !SEEDABLE_DATABASE_SUFFIXES.some((suffix) => name.toLowerCase().endsWith(suffix))
  ) {
    throw new Error(
      `Refusing to seed demo data: the database name ${name === undefined ? "could not be read from DATABASE_URL" : `"${name}"`} does not end in ${SEEDABLE_DATABASE_SUFFIXES.join(", ")}. Pass ${ALLOW_PRODUCTION_FLAG} only if you really want demo data in this database.`,
    );
  }
}

export function formatSummary(summary: SeedSummary, dataset?: SeedDatasetName): string {
  const lines = SEED_ENTITY_KINDS.map(
    (kind) =>
      `  ${kind.padEnd(13)} created ${String(summary.created[kind]).padStart(3)}, existing ${String(summary.existing[kind]).padStart(3)}`,
  );
  return [
    dataset === undefined ? "Seed finished." : `Seed finished (dataset ${dataset}).`,
    ...lines,
    `  variants      created ${String(summary.variantsCreated).padStart(3)} (with new products)`,
    "  shipping methods are created inactive; activate them in the admin (Shipping).",
    ...(summary.skippedShippingMethods.length === 0
      ? []
      : [
          `  skipped (provider not loaded, SHIPPING_PROVIDERS_ENABLED): ${summary.skippedShippingMethods.join(", ")}`,
        ]),
    ...synonymLines(summary.synonymGroups),
    imageLine(summary.images),
    ...(summary.images.existingWithoutImages.length === 0
      ? []
      : [
          `  images missing on existing products (never repaired by the seed, seeds/README.md): ${summary.images.existingWithoutImages.join(", ")}`,
        ]),
  ].join("\n");
}

function imageLine(images: SeedSummary["images"]): string {
  if (!images.uploadsEnabled) {
    return "  images not uploaded: MEDIA_STORAGE_DRIVER is none (products created without images, home banners not created: a banner needs a picture)";
  }
  return `  images        uploaded ${String(images.uploaded).padStart(3)} (through the media service, into MEDIA_DIR)`;
}

function synonymLines(groups: SeedSummary["synonymGroups"]): string[] {
  if (!groups.searchEnabled) {
    return ["  synonym groups not written: search is off (SEARCH_ENABLED)"];
  }
  return [
    `  synonym groups created ${String(groups.created).padStart(3)}, existing ${String(groups.existing).padStart(3)} (applied by pnpm search:reindex or the scheduler)`,
    ...(groups.skippedLocales.length === 0
      ? []
      : [`  synonym groups skipped (locale not in LOCALES): ${groups.skippedLocales.join(", ")}`]),
  ];
}

/** A problem exception has a generic message; the field errors say what is wrong. */
export function describeError(error: unknown): string {
  if (error instanceof ProblemException) {
    return `${error.code}: ${error.detail}\n${JSON.stringify(error.errors ?? [], null, 2)}\n${error.stack ?? ""}`;
  }
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

export interface RunSeedCommandOptions {
  /** Tests only: replaces the dataset that `--dataset` names. */
  seed?: CatalogSeed;
  /** Tests only: shipping provider modules mounted as if they were enabled (no package on disk is read for them). */
  extraShippingProviders?: LoadedShippingProvider[];
  /** Tests only: another directory of the seed's image files (default `<repo>/seeds/assets`). */
  assetsDir?: string;
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
  const dataset = datasetOf(argv);
  const config = loadEnv(env);
  // The enabled providers, as the API loads them: a demo method of a provider is created only when it is loaded.
  const shippingProviders = await loadShippingProviders({
    enabled: config.enabledShippingProviders,
    providersDir: DEFAULT_SHIPPING_PROVIDERS_DIR,
  });
  // The media settings of the API (`MEDIA_*`): the demo images are uploaded where the API serves them from.
  await prepareDefaultMediaDirectory(config, env);
  const app = await NestFactory.createApplicationContext(
    AppModule.register({
      databaseUrl: config.databaseUrl,
      // Optional features are not part of the demo catalog and must not run side effects while seeding.
      features: [],
      locale: { defaultLocale: config.defaultLocale, locales: config.locales },
      pricing: toPricingConfig(config),
      shippingProviders: [...shippingProviders, ...(options.extraShippingProviders ?? [])],
      // With SEARCH_ENABLED=true the seeded products are queued for the index like any admin write (`pnpm search:reindex`).
      search: config.search,
      media: mediaConfigOf(config),
    }),
    { logger: ["error", "warn"] },
  );
  try {
    return await CatalogSeeder.fromContext(app, options.assetsDir).run(
      options.seed ?? seedDatasets[dataset],
    );
  } finally {
    await app.close();
  }
}
