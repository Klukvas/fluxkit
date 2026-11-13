/**
 * The route rules of a feature slice (plan docs/plans/2026-11-13-blog.md, E5), read from the files on disk. Used by the specs
 * only (`route-structure.spec.ts` on the real app, `slice-rules.spec.ts` on the fixture slice); never imported by a page.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/** The route group of a slice; the name follows `FEATURES_ENABLED` (`packages/config/src/features.ts`). */
const SLICE_GROUP = /^\(feature-([a-z][a-z0-9-]*)\)$/;
/** The extensions Next accepts for a route file. */
const ROUTE_FILE_EXTENSIONS = ["tsx", "ts", "jsx", "js"];
const LOADING_FILES = ROUTE_FILE_EXTENSIONS.map((extension) => `loading.${extension}`);
const PAGE_FILES = ROUTE_FILE_EXTENSIONS.map((extension) => `page.${extension}`);

export interface FeatureSlice {
  /** The feature name, `<name>` of `(feature-<name>)`. */
  name: string;
  /** The slice folder. */
  directory: string;
}

/** Every `(feature-...)` group directly under `localeRoot` (`app/[locale]`), malformed names included (`name` `null`). */
export function findFeatureSlices(
  localeRoot: string,
): (FeatureSlice | { name: null; directory: string })[] {
  return readdirSync(localeRoot)
    .filter((entry) => entry.startsWith("(feature-"))
    .filter((entry) => statSync(join(localeRoot, entry)).isDirectory())
    .sort()
    .map((entry) => ({
      name: SLICE_GROUP.exec(entry)?.[1] ?? null,
      directory: join(localeRoot, entry),
    }));
}

function filesNamed(directory: string, names: readonly string[]): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return filesNamed(path, names);
    return names.includes(entry) ? [path] : [];
  });
}

/** The pages of a slice (its private `_feature` folder holds none that route). */
export function slicePages(slice: { directory: string }): string[] {
  return filesNamed(slice.directory, PAGE_FILES)
    .filter(
      (page) =>
        !relative(slice.directory, page)
          .split(/[\\/]/)
          .some((part) => part.startsWith("_")),
    )
    .sort();
}

/** The pages of every slice under `localeRoot`, relative to it (for `route-structure.spec.ts`). */
export function featureSlicePages(localeRoot: string): string[] {
  return findFeatureSlices(localeRoot).flatMap((slice) =>
    slicePages(slice).map((page) => relative(localeRoot, page)),
  );
}

/**
 * The first URL segment below the locale of a page (`(feature-blog)/blog/[slug]/page.tsx` -> `blog`): route groups and
 * nothing else are skipped. `null` for a page at the group's root (it would be the home page).
 */
export function firstUrlSegment(localeRoot: string, page: string): string | null {
  const segments = relative(localeRoot, dirname(page))
    .split(/[\\/]/)
    .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment));
  return segments[0] ?? null;
}

/** The first URL segments of the app's own pages (every page under `localeRoot` outside the slices). */
export function coreFirstSegments(localeRoot: string): Set<string> {
  const segments = new Set<string>();
  for (const entry of readdirSync(localeRoot)) {
    const path = join(localeRoot, entry);
    if (entry.startsWith("(feature-") || !statSync(path).isDirectory()) continue;
    for (const page of filesNamed(path, PAGE_FILES)) {
      const segment = firstUrlSegment(localeRoot, page);
      if (segment !== null && !segment.startsWith("[")) segments.add(segment);
    }
  }
  return segments;
}

/**
 * Whether every exported entry of a page (the page itself and `generateMetadata`) is an async function whose first statement
 * is `await requireFeature("<name>");`: the feature is checked before anything else, any feature API call included.
 */
export function gatesEveryEntry(source: string, name: string): boolean {
  // An entry this check cannot read (an arrow function, a re-export, a sync page) is refused rather than skipped.
  if (
    /export\s+(const|let|var)\s+generateMetadata|export\s+default\s+(?!async\s+function)/.test(
      source,
    )
  ) {
    return false;
  }
  const entries = source.match(/export\s+(default\s+)?(async\s+)?function\s+\w*/g) ?? [];
  const relevant = entries.filter((entry) => /default|generateMetadata$/.test(entry));
  const gate = new RegExp(
    String.raw`export\s+(default\s+)?async\s+function\s+\w*\s*\([^)]*\)\s*(:\s*[^{]+)?\{\s*await\s+requireFeature\(\s*"${name}"\s*\)\s*;`,
    "g",
  );
  const gated = source.match(gate) ?? [];
  return relevant.length > 0 && gated.length === relevant.length;
}

/**
 * Every rule a slice breaks (empty when none): a malformed group name; no `layout.tsx`; no manifest `_feature/feature.ts` or no
 * `_feature/messages/<locale>.json`; a `loading.tsx` inside the slice or above it (a page must answer a real 404); a page whose
 * entries do not start with `await requireFeature("<name>")`; a page whose first URL segment is dynamic, missing, or one of
 * `reserved` (a shop page slug or a path the app or the template owns).
 */
export function featureSliceProblems(
  localeRoot: string,
  options: { locales: readonly string[]; reserved: ReadonlySet<string> },
): string[] {
  const problems: string[] = [];
  const above = [localeRoot, dirname(localeRoot)].filter((directory) =>
    LOADING_FILES.some((file) => existsSync(join(directory, file))),
  );
  for (const slice of findFeatureSlices(localeRoot)) {
    const where = relative(localeRoot, slice.directory);
    if (slice.name === null) {
      problems.push(`${where}: a slice is "(feature-<name>)" with <name> a feature name`);
      continue;
    }
    const name = slice.name;
    if (!existsSync(join(slice.directory, "layout.tsx"))) problems.push(`${where}: no layout.tsx`);
    if (!existsSync(join(slice.directory, "_feature", "feature.ts"))) {
      problems.push(`${where}: no manifest _feature/feature.ts`);
    }
    for (const locale of options.locales) {
      if (!existsSync(join(slice.directory, "_feature", "messages", `${locale}.json`))) {
        problems.push(`${where}: no _feature/messages/${locale}.json`);
      }
    }
    for (const loading of [...filesNamed(slice.directory, LOADING_FILES), ...above]) {
      problems.push(
        `${where}: a loading view at ${relative(localeRoot, loading) || "."} hides a 404`,
      );
    }
    const pages = slicePages(slice);
    if (pages.length === 0) problems.push(`${where}: no page`);
    for (const page of pages) {
      const path = relative(localeRoot, page);
      if (!gatesEveryEntry(readFileSync(page, "utf8"), name)) {
        problems.push(
          `${path}: the page and its generateMetadata must start with await requireFeature("${name}");`,
        );
      }
      const segment = firstUrlSegment(localeRoot, page);
      if (segment === null || segment.startsWith("[")) {
        problems.push(`${path}: a slice's pages start with a static path segment of their own`);
      } else if (options.reserved.has(segment)) {
        problems.push(
          `${path}: the path segment "${segment}" is a shop page slug or a path the storefront owns`,
        );
      }
    }
  }
  return problems;
}
