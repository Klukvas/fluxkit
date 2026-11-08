import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { seedDatasets } from "@fluxkit/seeds";
import { datasetOf, formatSummary, runSeedCommand } from "./seed-command.js";
import { DEFAULT_SEED_ASSETS_DIR, SEED_ENTITY_KINDS, type SeedSummary } from "./catalog-seeder.js";

// No database: the dataset is chosen from the arguments before anything is touched.
describe("seed dataset selection (--dataset)", () => {
  it("defaults to the coffee demo and accepts both spellings of the flag", () => {
    expect(datasetOf([])).toBe("coffee");
    expect(datasetOf(["--allow-production"])).toBe("coffee");
    expect(datasetOf(["--dataset", "test"])).toBe("test");
    expect(datasetOf(["--dataset=test"])).toBe("test");
    expect(datasetOf(["--dataset", "coffee", "--allow-production"])).toBe("coffee");
  });

  it("refuses an unknown or a missing name instead of seeding the other catalog", () => {
    expect(() => datasetOf(["--dataset", "tests"])).toThrow(/Unknown seed dataset "tests"/);
    expect(() => datasetOf(["--dataset=toString"])).toThrow(/Unknown seed dataset/);
    expect(() => datasetOf(["--dataset"])).toThrow(/needs a dataset name/);
    expect(() => datasetOf(["--dataset", "--allow-production"])).toThrow(/needs a dataset name/);
  });

  it("fails before reading the environment or the database", async () => {
    await expect(runSeedCommand(["--dataset", "nope"], {})).rejects.toThrow(/Unknown seed dataset/);
  });

  it("names the dataset in the summary", () => {
    const zero = Object.fromEntries(
      SEED_ENTITY_KINDS.map((kind) => [kind, 0]),
    ) as SeedSummary["created"];
    const summary: SeedSummary = {
      created: zero,
      existing: zero,
      variantsCreated: 0,
      skippedShippingMethods: [],
      synonymGroups: { searchEnabled: false, created: 0, existing: 0, skippedLocales: [] },
      images: { uploadsEnabled: false, uploaded: 0, existingWithoutImages: [] },
    };
    expect(formatSummary(summary, "test").split("\n")[0]).toBe("Seed finished (dataset test).");
    expect(formatSummary(summary).split("\n")[0]).toBe("Seed finished.");
  });
});

describe("seed pictures of both datasets", () => {
  it("every file a dataset names is committed in seeds/assets; the coffee ones within the 40 KB budget", () => {
    for (const [name, seed] of Object.entries(seedDatasets)) {
      const files = [
        ...seed.products.flatMap((product) => product.media.map((item) => item.file)),
        ...seed.banners.flatMap((banner) => [
          banner.image,
          ...(banner.localeImages ?? []).map((image) => image.file),
        ]),
      ];
      expect(files.length, name).toBeGreaterThan(0);
      for (const file of files) {
        const path = join(DEFAULT_SEED_ASSETS_DIR, file);
        expect(existsSync(path), `${name}: ${file}`).toBe(true);
        if (name === "coffee") expect(statSync(path).size, file).toBeLessThanOrEqual(40_000);
      }
    }
  });
});
