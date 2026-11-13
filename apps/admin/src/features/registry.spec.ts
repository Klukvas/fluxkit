import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileLoader, LAZY_FILE_LOADERS } from "../messages";
import type { AdminFeatureManifest, FeatureRoute } from "./manifest";
import { checkManifest, FeatureSliceError } from "./manifest-rules";
import { ADMIN_FEATURES, featureMessageLoaders, featuresFrom } from "./registry";

const page = () => Promise.reject(new Error("not loaded in this test"));

function route(overrides: Partial<FeatureRoute> = {}): FeatureRoute {
  return {
    id: "feature.notes.list",
    path: "/features/notes",
    permission: "catalog.read",
    titleKey: "features.notes.title",
    load: page,
    ...overrides,
  };
}

function manifest(overrides: Partial<AdminFeatureManifest> = {}): AdminFeatureManifest {
  return {
    name: "notes",
    routes: [route()],
    navigation: {
      group: "storefront",
      labelKey: "features.notes.nav",
      routeId: "feature.notes.list",
    },
    messages: {
      uk: () => Promise.resolve({ "features.notes.nav": "Нотатки" }),
      en: () => Promise.resolve({ "features.notes.nav": "Notes" }),
    },
    ...overrides,
  };
}

const PATH = "./notes/feature.ts";

describe("the manifest rules (E8)", () => {
  it("accepts a well-formed manifest", () => {
    expect(() => checkManifest(PATH, manifest())).not.toThrow();
  });

  const refused: [string, string, AdminFeatureManifest | undefined][] = [
    ["a file outside a slice folder", "./feature.ts", manifest()],
    ["no `feature` export", PATH, undefined],
    ["a name other than the folder", PATH, manifest({ name: "other" })],
    ["no route", PATH, manifest({ routes: [] })],
    [
      "a route id without the feature prefix",
      PATH,
      manifest({ routes: [route({ id: "feature.blog.list" })] }),
    ],
    [
      "a route id with more parts",
      PATH,
      manifest({ routes: [route({ id: "feature.notes.a.b" })] }),
    ],
    ["a path outside /features/<name>", PATH, manifest({ routes: [route({ path: "/notes" })] })],
    [
      "a path that only starts like it",
      PATH,
      manifest({ routes: [route({ path: "/features/notesx" })] }),
    ],
    ["a core title key", PATH, manifest({ routes: [route({ titleKey: "page.home.title" })] })],
    [
      "two routes with one id",
      PATH,
      manifest({ routes: [route(), route({ path: "/features/notes/new" })] }),
    ],
    [
      "two routes with one path",
      PATH,
      manifest({ routes: [route(), route({ id: "feature.notes.other" })] }),
    ],
    [
      "an unknown navigation group",
      PATH,
      manifest({
        navigation: {
          group: "marketing" as "storefront",
          labelKey: "features.notes.nav",
          routeId: "feature.notes.list",
        },
      }),
    ],
    [
      "a core navigation label",
      PATH,
      manifest({
        navigation: {
          group: "storefront",
          labelKey: "nav.group.catalog",
          routeId: "feature.notes.list",
        },
      }),
    ],
    [
      "a navigation entry naming a route it does not have",
      PATH,
      manifest({
        navigation: {
          group: "storefront",
          labelKey: "features.notes.nav",
          routeId: "feature.notes.new",
        },
      }),
    ],
  ];
  for (const [what, path, value] of refused) {
    it(`refuses ${what}`, () => {
      expect(() => checkManifest(path, value)).toThrow(FeatureSliceError);
    });
  }

  it("names the file and the problem", () => {
    expect(() => checkManifest(PATH, manifest({ name: "other" }))).toThrow(
      'Admin feature manifest ./notes/feature.ts: name "other" must equal its folder name "notes".',
    );
  });
});

describe("the registry", () => {
  it("returns the manifests by name and checks them (in development and tests)", () => {
    const found = featuresFrom({
      "./zeta/feature.ts": {
        feature: manifest({
          name: "zeta",
          routes: [
            route({ id: "feature.zeta.list", path: "/features/zeta", titleKey: "features.zeta.t" }),
          ],
          navigation: {
            group: "sales",
            labelKey: "features.zeta.nav",
            routeId: "feature.zeta.list",
          },
        }),
      },
      [PATH]: { feature: manifest() },
    });
    expect(found.map((feature) => feature.name)).toEqual(["notes", "zeta"]);
    expect(() => featuresFrom({ "./x/feature.ts": { feature: manifest() } })).toThrow(
      FeatureSliceError,
    );
    expect(featuresFrom({})).toEqual([]);
  });

  it("finds every slice folder of the build, and every manifest passes the rules", () => {
    const root = import.meta.dirname;
    const folders = readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory());
    expect(ADMIN_FEATURES.map((feature) => feature.name)).toEqual([...folders].sort());
    for (const feature of ADMIN_FEATURES) {
      expect(() => checkManifest(`./${feature.name}/feature.ts`, feature)).not.toThrow();
    }
  });

  it("loads a feature's messages under its file id and refuses a key outside its namespace", async () => {
    const good = featureMessageLoaders([manifest()]);
    const load = createFileLoader(LAZY_FILE_LOADERS, good);
    await expect(load("feature:notes", "en")).resolves.toEqual({ "features.notes.nav": "Notes" });
    await expect(load("feature:other", "en")).rejects.toThrow(
      'No loader for the message file "feature:other"',
    );
    const bad = featureMessageLoaders([
      manifest({
        messages: {
          uk: () => Promise.resolve({ "nav.group.catalog": "Каталог" }),
          en: () => Promise.resolve({ "features.notes.nav": " " }),
        },
      }),
    ]);
    const loadBad = createFileLoader(LAZY_FILE_LOADERS, bad);
    await expect(loadBad("feature:notes", "uk")).rejects.toThrow(
      'Message "nav.group.catalog" of feature notes (uk) must start with "features.notes."',
    );
    await expect(loadBad("feature:notes", "en")).rejects.toThrow("must be a non-empty string");
  });
});

// ------------------------------------------------------------------ boundaries the import graph cannot see

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("feature slice boundaries", () => {
  const src = join(import.meta.dirname, "..");

  it("reaches the slices only through the registry's glob (dependency-cruiser checks the static imports)", () => {
    const globs = sourceFiles(src)
      .filter((file) => /import\.meta\.glob[<(]/.test(readFileSync(file, "utf8")))
      .map((file) => relative(src, file));
    expect(globs).toEqual([join("features", "registry.ts")]);
  });
});
