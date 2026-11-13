/**
 * The route rules of a feature slice (plan docs/plans/2026-11-13-blog.md, E5), read from the files on disk. Used by the specs
 * only (`route-structure.spec.ts` on the real app, `slice-rules.spec.ts` on the fixture slice); never imported by a page. The
 * page and layout sources are read with the TypeScript compiler (a dev dependency), not with patterns: an entry a pattern
 * cannot see (a re-export, an arrow function) must be refused, not skipped.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import ts from "typescript";

/** The route group of a slice; the name follows `FEATURES_ENABLED` (`packages/config/src/features.ts`). */
const SLICE_GROUP = /^\(feature-([a-z][a-z0-9-]*)\)$/;
/** The extensions Next accepts for a route file. */
const ROUTE_FILE_EXTENSIONS = ["tsx", "ts", "jsx", "js"];
const LOADING_FILES = ROUTE_FILE_EXTENSIONS.map((extension) => `loading.${extension}`);
const PAGE_FILES = ROUTE_FILE_EXTENSIONS.map((extension) => `page.${extension}`);
/** The only file names a slice holds outside its private `_` folders. */
const SLICE_PAGE = "page.tsx";
const SLICE_LAYOUT = "layout.tsx";

/**
 * The exported functions a page may have; each must start with the gate. `generateStaticParams` is not among them: it runs at
 * build time without a request, before any gate could run.
 */
const GATED_ENTRIES: ReadonlySet<string> = new Set([
  "default",
  "generateMetadata",
  "generateViewport",
]);
/** Route segment config a page may export, each as a plain literal (no code runs). */
const SEGMENT_CONFIG: ReadonlySet<string> = new Set([
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
]);

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

/** Every file of a slice outside its private folders (a folder whose name starts with `_` is never routed). */
function routedFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return entry.startsWith("_") ? [] : routedFiles(path);
    return [path];
  });
}

/** Every folder of a slice outside its private folders. */
function routedFolders(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (!statSync(path).isDirectory() || entry.startsWith("_")) return [];
    return [path, ...routedFolders(path)];
  });
}

/** The pages of a slice (its private `_feature` folder holds none that route). */
export function slicePages(slice: { directory: string }): string[] {
  return routedFiles(slice.directory)
    .filter((path) => PAGE_FILES.includes(basename(path)))
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

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function modifierFlags(node: ts.Declaration): ts.ModifierFlags {
  return ts.getCombinedModifierFlags(node);
}

/** Whether a function body starts with `await requireFeature("<name>");`. */
function startsWithGate(body: ts.Block | undefined, name: string): boolean {
  const first = body?.statements[0];
  if (first === undefined || !ts.isExpressionStatement(first)) return false;
  const awaited = first.expression;
  if (!ts.isAwaitExpression(awaited) || !ts.isCallExpression(awaited.expression)) return false;
  const call = awaited.expression;
  const [argument] = call.arguments;
  return (
    ts.isIdentifier(call.expression) &&
    call.expression.text === "requireFeature" &&
    call.arguments.length === 1 &&
    argument !== undefined &&
    ts.isStringLiteral(argument) &&
    argument.text === name
  );
}

function isPlainLiteral(node: ts.Expression | undefined): boolean {
  return (
    node !== undefined &&
    (ts.isStringLiteral(node) ||
      ts.isNumericLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword)
  );
}

/**
 * What is wrong with the exports of a slice's page (empty when nothing is). Allowed: `export default async function`, `export
 * async function generateMetadata` and `generateViewport`, each with `await requireFeature("<name>");` as its FIRST statement;
 * route segment config (`dynamic`, `revalidate`, ...) as a plain literal; type exports. Refused: any other exported function,
 * `generateStaticParams` included, any other exported value, `export { ... }`, `export ... from`, `export * from` and `export
 * default <expression>`, so that nothing of the page runs before the gate.
 */
export function pageGateProblems(source: string, name: string): string[] {
  const problems: string[] = [];
  let hasDefault = false;
  for (const statement of parse(source).statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.isTypeOnly) {
        problems.push(
          "`export { ... }` and `export ... from` are refused: declare each entry in the page itself",
        );
      }
    } else if (ts.isExportAssignment(statement)) {
      problems.push(
        "`export default <expression>` is refused: write `export default async function`",
      );
    } else if (ts.isFunctionDeclaration(statement)) {
      const flags = modifierFlags(statement);
      if ((flags & ts.ModifierFlags.Export) === 0) continue;
      const entry =
        (flags & ts.ModifierFlags.Default) !== 0 ? "default" : (statement.name?.text ?? "");
      if (entry === "default") hasDefault = true;
      if (!GATED_ENTRIES.has(entry)) {
        problems.push(
          `exported function ${entry} is refused (a page exports only the page, generateMetadata and generateViewport)`,
        );
      } else if ((flags & ts.ModifierFlags.Async) === 0) {
        problems.push(
          `${entry} must be an async function starting with await requireFeature("${name}");`,
        );
      } else if (!startsWithGate(statement.body, name)) {
        problems.push(`${entry} must start with await requireFeature("${name}");`);
      }
    } else if (ts.isVariableStatement(statement)) {
      const exported =
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false;
      if (!exported) continue;
      for (const declaration of statement.declarationList.declarations) {
        const declared = ts.isIdentifier(declaration.name) ? declaration.name.text : "(pattern)";
        if (!SEGMENT_CONFIG.has(declared)) {
          problems.push(
            `exported value ${declared} is refused (a page exports only its gated functions and route segment config)`,
          );
        } else if (!isPlainLiteral(declaration.initializer)) {
          problems.push(`route segment config ${declared} must be a plain literal`);
        }
      }
    } else if (
      (ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
      (modifierFlags(statement) & ts.ModifierFlags.Export) !== 0
    ) {
      problems.push("an exported class or enum is refused in a page");
    }
  }
  if (!hasDefault) problems.push("no `export default async function`: a page is one");
  return problems;
}

/** What is wrong with a slice's layout: it re-exports the default of `(site)/layout` and does nothing else. */
export function layoutProblems(source: string): string[] {
  const statements = parse(source).statements;
  const [only] = statements;
  const isReexport =
    statements.length === 1 &&
    only !== undefined &&
    ts.isExportDeclaration(only) &&
    !only.isTypeOnly &&
    only.moduleSpecifier !== undefined &&
    ts.isStringLiteral(only.moduleSpecifier) &&
    only.moduleSpecifier.text.endsWith("(site)/layout") &&
    only.exportClause !== undefined &&
    ts.isNamedExports(only.exportClause) &&
    only.exportClause.elements.length === 1 &&
    only.exportClause.elements[0]?.name.text === "default" &&
    only.exportClause.elements[0]?.propertyName === undefined;
  return isReexport
    ? []
    : [
        'the layout must be exactly `export { default } from "../(site)/layout";` (the locale check, nothing that runs before the gate)',
      ];
}

/**
 * Every rule a slice breaks (empty when none):
 * - a malformed group name; no manifest `_feature/feature.ts` or no `_feature/messages/<locale>.json`;
 * - outside its private `_` folders, any file but `layout.tsx` at its root and `page.tsx` files: a route handler, a metadata
 *   image or sitemap file, `default.tsx`, `template.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx` or a nested layout would
 *   run without the gate (the not-found view is the app's own, `[locale]/not-found.tsx`); a parallel `@slot` or intercepting
 *   `(.)` folder likewise;
 * - a layout that is not the `(site)` re-export; a `loading.tsx` above the slice (a page must answer a real 404);
 * - a page whose exports are not gated (`pageGateProblems`);
 * - a page whose first URL segment is dynamic, missing, or one of `reserved` (a shop page slug or a path the app owns).
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
    const layout = join(slice.directory, SLICE_LAYOUT);
    if (!existsSync(layout)) {
      problems.push(`${where}: no layout.tsx`);
    } else {
      for (const problem of layoutProblems(readFileSync(layout, "utf8"))) {
        problems.push(`${where}/layout.tsx: ${problem}`);
      }
    }
    if (!existsSync(join(slice.directory, "_feature", "feature.ts"))) {
      problems.push(`${where}: no manifest _feature/feature.ts`);
    }
    for (const locale of options.locales) {
      if (!existsSync(join(slice.directory, "_feature", "messages", `${locale}.json`))) {
        problems.push(`${where}: no _feature/messages/${locale}.json`);
      }
    }
    for (const folder of routedFolders(slice.directory)) {
      const base = basename(folder);
      if (base.startsWith("@") || base.startsWith("(.")) {
        problems.push(
          `${relative(localeRoot, folder)}: parallel and intercepting routes are refused in a slice (they would render without the gate)`,
        );
      }
    }
    for (const file of routedFiles(slice.directory)) {
      const path = relative(slice.directory, file);
      const isRootLayout = path === SLICE_LAYOUT;
      const isPage = basename(file) === SLICE_PAGE;
      if (!isRootLayout && !isPage) {
        problems.push(
          `${relative(localeRoot, file)}: only layout.tsx (at the slice's root) and page.tsx route in a slice; anything else would run without the gate (private files go in _feature/)`,
        );
      }
    }
    for (const loading of above) {
      problems.push(
        `${where}: a loading view at ${relative(localeRoot, loading) || "."} hides a 404`,
      );
    }
    const pages = slicePages(slice);
    if (pages.length === 0) problems.push(`${where}: no page`);
    for (const page of pages) {
      const path = relative(localeRoot, page);
      for (const problem of pageGateProblems(readFileSync(page, "utf8"), name)) {
        problems.push(`${path}: ${problem}`);
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
