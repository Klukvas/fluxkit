import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locales } from "@fluxkit/ui";
import { afterEach, describe, expect, it } from "vitest";
import { feature as fixtureFeature } from "./fixtures/app/[locale]/(feature-notebook)/_feature/feature";
import { generatedFeatures } from "./registry.generated";
import { featureNavigation, featureRegistryProblems, storefrontFeatures } from "./registry";
import type { RegisteredFeature, StorefrontFeature } from "./types";

const generator = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "scripts",
  "generate-feature-registry.mjs",
);
const realApp = join(import.meta.dirname, "..", "app");
const fixtureApp = join(import.meta.dirname, "fixtures", "app");

const scratch: string[] = [];
afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function scratchDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "storefront-registry-"));
  scratch.push(directory);
  return directory;
}

function generate(appDir: string, outFile: string) {
  return spawnSync(process.execPath, [generator, "--app", appDir, "--out", outFile], {
    encoding: "utf8",
  });
}

describe("feature registry generator (scripts/generate-feature-registry.mjs, plan E6)", () => {
  it("writes an empty registry when no slice is on disk", () => {
    const appDir = scratchDirectory();
    mkdirSync(join(appDir, "[locale]", "(site)"), { recursive: true });
    const outFile = join(scratchDirectory(), "registry.generated.ts");
    const result = generate(appDir, outFile);
    expect(result.status, result.stderr).toBe(0);
    const source = readFileSync(outFile, "utf8");
    expect(source).toContain("export const generatedFeatures: readonly RegisteredFeature[] = [];");
    expect(source).not.toMatch(/import \{ feature/);
  });

  it("imports each slice's manifest, in name order, and the registry it writes loads", async () => {
    const appDir = scratchDirectory();
    const slice = join(fixtureApp, "[locale]", "(feature-notebook)");
    cpSync(slice, join(appDir, "[locale]", "(feature-notebook)"), { recursive: true });
    cpSync(slice, join(appDir, "[locale]", "(feature-atlas)"), { recursive: true });
    // Its type imports (`./types`) are erased, so the registry loads from anywhere.
    const outFile = join(scratchDirectory(), "registry.generated.ts");
    const result = generate(appDir, outFile);
    expect(result.status, result.stderr).toBe(0);
    const source = readFileSync(outFile, "utf8");
    expect(source.indexOf("(feature-atlas)")).toBeLessThan(source.indexOf("(feature-notebook)"));
    const loaded = (await import(outFile)) as { generatedFeatures: RegisteredFeature[] };
    expect(loaded.generatedFeatures.map((entry) => entry.folder)).toEqual(["atlas", "notebook"]);
    expect(loaded.generatedFeatures.map((entry) => entry.feature.name)).toEqual([
      "notebook",
      "notebook",
    ]);
    // The copy named "atlas" still says "notebook": the registry check refuses it.
    expect(featureRegistryProblems(loaded.generatedFeatures)).toContain(
      "the manifest of (feature-atlas) is named \"notebook\": a slice's name is its folder's",
    );
  });

  it("leaves an unchanged registry file alone (no rebuild or reload for nothing)", () => {
    const appDir = scratchDirectory();
    mkdirSync(join(appDir, "[locale]"), { recursive: true });
    const outFile = join(scratchDirectory(), "registry.generated.ts");
    expect(generate(appDir, outFile).status).toBe(0);
    const before = statSync(outFile).mtimeMs;
    writeFileSync(join(appDir, "unrelated.txt"), "x");
    expect(generate(appDir, outFile).status).toBe(0);
    expect(statSync(outFile).mtimeMs).toBe(before);
  });

  it("fails, naming the folder, on a slice without its manifest and on a malformed slice name", () => {
    const noManifest = scratchDirectory();
    mkdirSync(join(noManifest, "[locale]", "(feature-notes)", "notes"), { recursive: true });
    const outFile = join(scratchDirectory(), "registry.generated.ts");
    const missing = generate(noManifest, outFile);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/\(feature-notes\) has no manifest _feature\/feature\.ts/);

    const badName = scratchDirectory();
    mkdirSync(join(badName, "[locale]", "(feature-Notes)", "_feature"), { recursive: true });
    const refused = generate(badName, outFile);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/\(feature-Notes\): a feature slice is "\(feature-<name>\)"/);
  });

  it("is what the app's registry was generated from: the slices of src/app (none upstream)", () => {
    const outFile = join(scratchDirectory(), "registry.generated.ts");
    execFileSync(process.execPath, [generator, "--app", realApp, "--out", outFile]);
    const expected = readFileSync(outFile, "utf8").replace(/from "[^"]*\/app\//g, 'from "');
    const actual = readFileSync(join(import.meta.dirname, "registry.generated.ts"), "utf8").replace(
      /from "[^"]*\/app\//g,
      'from "',
    );
    expect(actual).toBe(expected);
  });
});

/** A manifest built on the fixture's, with changes. */
function manifest(changes: Partial<StorefrontFeature> = {}): StorefrontFeature {
  return { ...fixtureFeature, ...changes };
}

describe("feature registry checks (features/registry.ts)", () => {
  it("accepts the fixture slice", () => {
    expect(featureRegistryProblems([{ folder: "notebook", feature: fixtureFeature }])).toEqual([]);
  });

  it("refuses a manifest named unlike its folder, a name twice, messages outside the namespace, empty or uneven", () => {
    const problems = featureRegistryProblems([
      { folder: "notes", feature: fixtureFeature },
      { folder: "notebook", feature: fixtureFeature },
      {
        folder: "notebook",
        feature: manifest({
          messages: {
            uk: {
              "features.notebook.nav": "Нотатник",
              "site.name": "x",
              "features.notebook.": "y",
            },
            en: { "features.notebook.nav": " " },
          },
        }),
      },
    ]);
    expect(problems).toEqual(
      expect.arrayContaining([
        "the manifest of (feature-notes) is named \"notebook\": a slice's name is its folder's",
        'feature "notebook" is registered twice',
        'feature "notebook": uk message "site.name" is outside its namespace "features.notebook."',
        'feature "notebook": uk message "features.notebook." is outside its namespace "features.notebook."',
        'feature "notebook": en message "features.notebook.nav" must be a non-empty string',
        'feature "notebook": the en messages do not have the same keys as the uk ones',
      ]),
    );
  });

  it("refuses a link that is not a plain storefront path, an unknown label and a repeated link", () => {
    const problems = featureRegistryProblems([
      {
        folder: "notebook",
        feature: manifest({
          navigation: [
            { placement: "header", labelKey: "features.notebook.nav", path: "https://example.com" },
            { placement: "footer", labelKey: "nav.cart", path: "/notebook" },
            { placement: "footer", labelKey: "features.notebook.nav", path: "/notebook" },
          ],
        }),
      },
    ]);
    expect(problems).toEqual([
      'feature "notebook": link "https://example.com" is not a plain storefront path',
      'feature "notebook": link "/notebook": message key "nav.cart" is not among its uk messages',
      'feature "notebook": link "/notebook": message key "nav.cart" is not among its en messages',
      'feature "notebook": footer link "/notebook" is listed twice',
    ]);
  });

  it("gives the links of the enabled slices only, per place, in registry order", () => {
    const atlas = manifest({
      name: "atlas",
      navigation: [{ placement: "footer", labelKey: "features.atlas.nav", path: "/atlas" }],
    });
    const features = [atlas, fixtureFeature];
    expect(featureNavigation(features, [], "header")).toEqual([]);
    expect(featureNavigation(features, ["notebook"], "header")).toEqual([
      { labelKey: "features.notebook.nav", href: "/notebook" },
    ]);
    expect(featureNavigation(features, ["notebook", "atlas"], "footer")).toEqual([
      { labelKey: "features.atlas.nav", href: "/atlas" },
      { labelKey: "features.notebook.nav", href: "/notebook" },
    ]);
  });

  it("registers the generated slices of the app, each manifest's messages equal to its message files (the release check reads those)", () => {
    expect(storefrontFeatures).toEqual(generatedFeatures.map((entry) => entry.feature));
    for (const { folder, feature } of generatedFeatures) {
      for (const locale of locales) {
        const file = join(
          realApp,
          "[locale]",
          `(feature-${folder})`,
          "_feature",
          "messages",
          `${locale}.json`,
        );
        expect(feature.messages[locale], file).toEqual(JSON.parse(readFileSync(file, "utf8")));
      }
    }
    for (const locale of locales) {
      const file = join(
        fixtureApp,
        "[locale]",
        "(feature-notebook)",
        "_feature",
        "messages",
        `${locale}.json`,
      );
      expect(fixtureFeature.messages[locale]).toEqual(JSON.parse(readFileSync(file, "utf8")));
    }
  });
});
