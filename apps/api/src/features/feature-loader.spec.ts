import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFeatures } from "./feature-loader.js";

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
});
