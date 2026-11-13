import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../../database/schema/index.js";
import { coreInventory } from "./index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const SKIPPED = new Set([
  "node_modules",
  "dist",
  ".next",
  "coverage",
  "test-results",
  "playwright-report",
]);

function sourceFiles(directory: string, pattern: RegExp): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return found;
  }
  for (const name of entries) {
    if (SKIPPED.has(name)) continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path, pattern));
    else if (pattern.test(name)) found.push(path);
  }
  return found;
}

const isSpec = (path: string) => /\.(spec|e2e)\.tsx?$/.test(path);
const text = (path: string) => readFileSync(path, "utf8");
const rel = (path: string) => relative(ROOT, path);

/** `import { a, b as c } from "<path>"` statements, as [names, path]. */
function namedImports(source: string): { names: string[]; from: string }[] {
  const imports: { names: string[]; from: string }[] = [];
  for (const match of source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)) {
    const names = (match[1] ?? "")
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/)[0] ?? "")
      .filter((name) => name !== "");
    imports.push({ names, from: match[2] ?? "" });
  }
  return imports;
}

describe("seeds write no personal data (plan row X9)", () => {
  const seedFiles = [
    ...sourceFiles(join(ROOT, "apps/api/src/seed"), /\.ts$/),
    ...sourceFiles(join(ROOT, "seeds/src"), /\.ts$/),
  ].filter((path) => !isSpec(path));
  const tableByExport = new Map<string, string>();
  for (const [exportName, value] of Object.entries(schema)) {
    if (is(value, PgTable)) tableByExport.set(exportName, getTableConfig(value).name);
  }
  const holdsPersonalData = (table: string): boolean =>
    Object.values(coreInventory[table] ?? {}).some(
      (entry) =>
        entry.class === "personal" || entry.class === "staff" || entry.class === "free_text",
    );

  it("finds the seed sources (the checks below are not vacuous)", () => {
    expect(seedFiles.length).toBeGreaterThan(5);
    expect(tableByExport.size).toBeGreaterThan(40);
  });

  it("imports no table that holds personal, staff or free-text data", () => {
    const offenders: string[] = [];
    for (const file of seedFiles) {
      for (const { names, from } of namedImports(text(file))) {
        if (!/database\/schema/.test(from)) continue;
        for (const name of names) {
          const table = tableByExport.get(name);
          if (table !== undefined && holdsPersonalData(table))
            offenders.push(`${rel(file)}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("imports no service of the customer, order, payment, shipment, email or auth areas", () => {
    const offenders: string[] = [];
    for (const file of seedFiles) {
      for (const { from } of namedImports(text(file))) {
        if (
          /\/(customers|orders|payments|email|auth|cart|shipping\/(shipments|store))\//.test(from)
        ) {
          offenders.push(`${rel(file)}: ${from}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("test data uses reserved example domains only (plan row X7)", () => {
  const files = [
    ...sourceFiles(join(ROOT, "apps/api/src/test"), /\.ts$/),
    ...sourceFiles(join(ROOT, "apps/api/src/seed"), /\.ts$/),
    ...sourceFiles(join(ROOT, "apps/storefront/e2e"), /\.tsx?$/),
    ...sourceFiles(join(ROOT, "apps/admin/e2e"), /\.tsx?$/),
    ...sourceFiles(join(ROOT, "seeds/src"), /\.ts$/),
  ];
  // Numeric hosts are database URLs with credentials (`user:password@127.0.0.1`), not mailboxes.
  const RESERVED =
    /^((.+\.)?(example\.(com|net|org)|[^.]+\.test|[^.]+\.invalid|localhost)|[0-9.]+)$/i;

  it("finds the files (the check below is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("has no email address on a real domain", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const match of text(file).matchAll(
        /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g,
      )) {
        const domain = match[1] ?? "";
        if (!RESERVED.test(domain)) offenders.push(`${rel(file)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

const DECLARES_TABLES = /drizzle-orm\/pg-core|pgTable\(/;
const FEATURE_SCHEMA = /^packages\/features\/([^/]+)\/src\/schema\.ts$/;
const EXPORTS_INVENTORY =
  /export\s+(?:const|let|var)\s+personalDataInventory\b|export\s*\{[^}]*\bpersonalDataInventory\b[^}]*\}/;

/**
 * The files (repository-relative) that may not declare tables but do. A provider never may; a feature only in its
 * `src/schema.ts`, and only when the same package's `src/index.ts` exports `personalDataInventory` (ADR 0049, E3), so
 * every feature table is classified by the feature's own inventory (merged at startup, checked by its own spec).
 */
function tableOffenders(
  files: readonly string[],
  read: (relativePath: string) => string | undefined,
): string[] {
  return files.filter((file) => {
    if (!DECLARES_TABLES.test(read(file) ?? "")) return false;
    const feature = FEATURE_SCHEMA.exec(file)?.[1];
    if (feature === undefined) return true;
    return !EXPORTS_INVENTORY.test(read(`packages/features/${feature}/src/index.ts`) ?? "");
  });
}

describe("a feature or provider package declares no database table outside the feature rule (ADR 0033 decision 3, ADR 0049)", () => {
  const files = [
    ...sourceFiles(join(ROOT, "packages/features"), /\.tsx?$/),
    ...sourceFiles(join(ROOT, "packages/providers"), /\.tsx?$/),
  ].map(rel);
  const readRepoFile = (path: string): string | undefined => {
    try {
      return text(join(ROOT, path));
    } catch {
      return undefined;
    }
  };

  // The feature matrix deletes the features (`deleted`) or the providers (`providers-deleted`) in turn, never both, so
  // only one of the two roots is guaranteed to hold files; the check needs at least one file to be a real scan.
  it("finds the packages (the check below is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("imports the Drizzle table builders only in a feature's src/schema.ts that comes with an inventory", () => {
    expect(tableOffenders(files, readRepoFile)).toEqual([]);
  });

  it("refuses a provider table, a feature table outside schema.ts and a schema.ts without an inventory", () => {
    const tree: Record<string, string> = {
      "packages/providers/x/src/schema.ts": 'import { pgTable } from "drizzle-orm/pg-core";',
      "packages/features/a/src/schema.ts": 'import { pgTable } from "drizzle-orm/pg-core";',
      "packages/features/a/src/index.ts": "export const featureModule = A;",
      "packages/features/b/src/tables.ts": 'const t = pgTable("t", {});',
      "packages/features/b/src/index.ts": "export const personalDataInventory = {};",
      "packages/features/c/src/schema.ts": 'import { pgTable } from "drizzle-orm/pg-core";',
      "packages/features/c/src/index.ts":
        "export { featureModule, personalDataInventory } from './m.js';",
      "packages/features/d/src/schema.ts": 'import { pgTable } from "drizzle-orm/pg-core";',
      "packages/features/d/src/index.ts": "export const personalDataInventory = {};",
    };
    expect(tableOffenders(Object.keys(tree), (path) => tree[path])).toEqual([
      "packages/providers/x/src/schema.ts",
      "packages/features/a/src/schema.ts",
      "packages/features/b/src/tables.ts",
    ]);
  });
});

describe("the API sets only the documented cookies (ADR 0033 decision 11)", () => {
  const sources = sourceFiles(join(ROOT, "apps/api/src"), /\.ts$/).filter(
    (path) => !isSpec(path) && !rel(path).startsWith("apps/api/src/test/"),
  );
  const COOKIE_MODULES = new Map([
    [
      "apps/api/src/auth/session-cookie.ts",
      { name: "fluxkit_admin_session", sameSite: "strict", path: "/admin" },
    ],
    [
      "apps/api/src/customers/auth/customer-session-cookie.ts",
      { name: "fluxkit_customer_session", sameSite: "lax", path: "/store" },
    ],
    ["apps/api/src/cart/cart-cookie.ts", { name: "fluxkit_cart", sameSite: "lax", path: "/store" }],
  ]);

  it("writes a cookie only in the three cookie modules", () => {
    const writers = sources
      .filter((path) => /\.(cookie|clearCookie)\(|["']set-cookie["']/i.test(text(path)))
      .map(rel)
      .sort();
    expect(writers).toEqual([...COOKIE_MODULES.keys()].sort());
  });

  it("gives each cookie its documented name, HttpOnly, SameSite and path", () => {
    for (const [path, expected] of COOKIE_MODULES) {
      const source = text(join(ROOT, path));
      expect(source, path).toContain(`"${expected.name}"`);
      expect(source, path).toContain("httpOnly: true");
      expect(source, path).toContain(`sameSite: "${expected.sameSite}"`);
      expect(source, path).toContain(`path: "${expected.path}"`);
      expect(source.match(/_COOKIE_NAME\s*=/g) ?? [], path).toHaveLength(1);
    }
  });

  it("names no other cookie anywhere in the API", () => {
    const named = new Set<string>();
    for (const path of sources) {
      for (const match of text(path).matchAll(/["'`](fluxkit_[a-z_]+)["'`]/g)) {
        named.add(match[1] ?? "");
      }
    }
    expect([...named].sort()).toEqual([
      "fluxkit_admin_session",
      "fluxkit_cart",
      "fluxkit_customer_session",
    ]);
  });
});
