import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findEnabledFeatures, loadFeatures } from "./feature-loader.js";

describe("loadFeatures", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fluxkit-features-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeFeature(folder: string, name: string, body: string): Promise<void> {
    const featureDir = join(dir, folder);
    await mkdir(featureDir, { recursive: true });
    await writeFile(
      join(featureDir, "package.json"),
      JSON.stringify({
        name: `x-${folder}`,
        type: "module",
        main: "index.js",
        fluxkit: { feature: name },
      }),
    );
    await writeFile(join(featureDir, "index.js"), body);
  }

  it("loads nothing and touches nothing when no features are enabled (folder may not exist at all)", async () => {
    expect(await loadFeatures({ enabled: [], featuresDir: join(dir, "does-not-exist") })).toEqual(
      [],
    );
  });

  it("loads an enabled feature by manifest name, regardless of folder name", async () => {
    await writeFeature("_sample", "sample", "export class M {}\nexport const featureModule = M;\n");
    const loaded = await loadFeatures({ enabled: ["sample"], featuresDir: dir });
    expect(loaded.map((feature) => feature.name)).toEqual(["sample"]);
  });

  it("does not load features that are present but disabled", async () => {
    await writeFeature("other", "other", "throw new Error('must not be imported');\n");
    expect(await loadFeatures({ enabled: [], featuresDir: dir })).toEqual([]);
  });

  it("fails loudly when an enabled feature is missing (deleted folder)", async () => {
    await expect(loadFeatures({ enabled: ["gone"], featuresDir: dir })).rejects.toThrow(
      /Feature "gone" is enabled/,
    );
  });

  it("fails loudly when the feature does not export featureModule", async () => {
    await writeFeature("bad", "bad", "export const nope = 1;\n");
    await expect(loadFeatures({ enabled: ["bad"], featuresDir: dir })).rejects.toThrow(
      /must export "featureModule"/,
    );
  });

  it("rejects a manifest whose main escapes the feature folder", async () => {
    await writeFeature("evil", "evil", "export const featureModule = class {};\n");
    await writeFile(
      join(dir, "evil", "package.json"),
      JSON.stringify({ type: "module", main: "../outside.js", fluxkit: { feature: "evil" } }),
    );
    await expect(loadFeatures({ enabled: ["evil"], featuresDir: dir })).rejects.toThrow(
      /must stay inside/,
    );
  });

  it("rejects two packages declaring the same feature name", async () => {
    await writeFeature("one", "dup", "export const featureModule = class {};\n");
    await writeFeature("two", "dup", "export const featureModule = class {};\n");
    await expect(loadFeatures({ enabled: ["dup"], featuresDir: dir })).rejects.toThrow(
      /declared twice/,
    );
  });

  it("rejects an invalid manifest feature name, naming the file", async () => {
    await writeFeature("Upper", "Upper", "export const featureModule = class {};\n");
    await expect(loadFeatures({ enabled: ["upper"], featuresDir: dir })).rejects.toThrow(
      /Invalid feature name "Upper" in .*package\.json/,
    );
  });

  it("reports a feature's migrations folder only when it has a journal", async () => {
    await writeFeature("plain", "plain", "export const featureModule = class {};\n");
    await writeFeature("tables", "tables", "export const featureModule = class {};\n");
    await mkdir(join(dir, "tables", "drizzle", "meta"), { recursive: true });
    await writeFile(join(dir, "tables", "drizzle", "meta", "_journal.json"), '{"entries":[]}');
    await mkdir(join(dir, "plain", "drizzle"), { recursive: true });

    const loaded = await loadFeatures({ enabled: ["plain", "tables"], featuresDir: dir });

    expect(loaded.map(({ name, migrationsFolder }) => ({ name, migrationsFolder }))).toEqual([
      { name: "plain", migrationsFolder: undefined },
      { name: "tables", migrationsFolder: join(dir, "tables", "drizzle") },
    ]);
  });

  it("carries the personalDataInventory export as found, and nothing when there is none", async () => {
    await writeFeature(
      "inventoried",
      "inventoried",
      "export const featureModule = class {};\nexport const personalDataInventory = { t: {} };\n",
    );
    await writeFeature("bare", "bare", "export const featureModule = class {};\n");
    const [inventoried, bare] = await loadFeatures({
      enabled: ["inventoried", "bare"],
      featuresDir: dir,
    });
    expect(inventoried?.personalDataInventory).toEqual({ t: {} });
    expect(bare !== undefined && "personalDataInventory" in bare).toBe(false);
  });

  it("finds enabled packages without importing them", async () => {
    await writeFeature("untouched", "untouched", "throw new Error('must not be imported');\n");
    const found = await findEnabledFeatures({ enabled: ["untouched"], featuresDir: dir });
    expect(found.map((manifest) => manifest.name)).toEqual(["untouched"]);
    await expect(findEnabledFeatures({ enabled: ["absent"], featuresDir: dir })).rejects.toThrow(
      /Feature "absent" is enabled/,
    );
  });

  it("rejects a manifest name longer than 32 characters (its migrations table would not fit)", async () => {
    const long = "a".repeat(33);
    await writeFeature("long", long, "export const featureModule = class {};\n");
    await expect(loadFeatures({ enabled: [long], featuresDir: dir })).rejects.toThrow(
      /Invalid feature name "a{33}".*at most 32 characters/,
    );
  });

  it("names the file when a package.json cannot be parsed", async () => {
    await mkdir(join(dir, "broken"), { recursive: true });
    await writeFile(join(dir, "broken", "package.json"), "{ not json");
    await expect(loadFeatures({ enabled: ["anything"], featuresDir: dir })).rejects.toThrow(
      /Cannot parse .*broken.*package\.json/,
    );
  });
});
