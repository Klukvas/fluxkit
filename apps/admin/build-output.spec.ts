import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ADMIN_SECURITY_HEADERS } from "./security-headers";
import { LOCALE_STORAGE_KEY } from "./src/i18n/locale-preference";
import { LAZY_FILES, eagerMessages } from "./src/messages";
import { ADMIN_BASE_PATH } from "./src/router/base-path";

/**
 * Checks of the BUILT SPA (`vite build`, run by `pnpm build`; the root `pnpm test` builds first). Without `dist/` this
 * fails instead of skipping: an unchecked build must not pass. Plan step 4b: no inline script (the CSP has
 * `script-src 'self'`), no external URL, every asset under the base path, one chunk per area, an entry budget, no zod,
 * the UI language as the only storage use.
 */

const dist = join(import.meta.dirname, "dist");

/**
 * The JavaScript loaded before any area: the entry chunk and its static imports. Measured 2026-10-19 (step 4b): 392 050
 * bytes raw, 120 027 gzip (React and React DOM about 218 KB, react-router about 95 KB, the shell, the UI library, the admin
 * client and both message catalogues the rest). The budget leaves about 12 % headroom; raising it is a decision for the PR
 * that needs it, with the new measurement. Step 5 (catalog dictionaries): 439 481 bytes raw, 129 557 gzip, because its uk
 * and en messages (47 KB) were merged into the entry. Step 6a loads each area's messages with the area (one small chunk
 * per file and language): 398 093 bytes raw, 121 328 gzip with the same areas; the budget stays, about 10 % above that.
 */
const INITIAL_JS_BUDGET = { raw: 440_000, gzip: 135_000 };

/** Every lazily loaded area module of the route table. */
const AREA_MODULES = [
  "src/areas/account/account-page.tsx",
  "src/areas/products/index.tsx",
  "src/areas/catalog-dictionaries/index.tsx",
  "src/areas/orders/index.tsx",
  "src/areas/customers/index.tsx",
  "src/areas/users/index.tsx",
];

interface ManifestChunk {
  file: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}

function read(path: string): string {
  if (!existsSync(path)) {
    throw new Error(
      `${path} is missing: run \`pnpm build\` (or \`pnpm --filter @fluxkit/admin build\`) first.`,
    );
  }
  return readFileSync(path, "utf8");
}

const html = read(join(dist, "index.html"));
const manifest = JSON.parse(read(join(dist, ".vite", "manifest.json"))) as Record<
  string,
  ManifestChunk
>;
const assets = readdirSync(join(dist, "assets"));
const scripts = assets.filter((name) => name.endsWith(".js"));
const styles = assets.filter((name) => name.endsWith(".css"));
const asset = (name: string) => readFileSync(join(dist, "assets", name), "utf8");

function entry(): [string, ManifestChunk] {
  const found = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry === true);
  expect(found).toHaveLength(1);
  return found[0] as [string, ManifestChunk];
}

/** The entry chunk and everything it imports statically, as manifest keys. */
function initialChunks(): Set<string> {
  const [key] = entry();
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const child of manifest[name]?.imports ?? []) visit(child);
  };
  visit(key);
  return seen;
}

describe("built index.html (strict CSP: script-src 'self', no external resources)", () => {
  it("has no inline script, no inline style, no event handler attribute and no base element", () => {
    const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scriptTags.length).toBeGreaterThan(0);
    for (const [, attributes, body] of scriptTags) {
      expect(attributes, "every script has a src").toMatch(/\ssrc="/);
      expect((body as string).trim(), "no inline script body").toBe("");
    }
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toMatch(/<base\b/i);
    expect(html).not.toMatch(/javascript:/i);
  });

  it("loads every file from the SPA's own assets under the base path, nothing external", () => {
    const urls = [...html.matchAll(/\s(?:src|href)="([^"]*)"/g)].map((match) => match[1] as string);
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const url of urls)
      expect(url, url).toMatch(new RegExp(`^${ADMIN_BASE_PATH}/assets/[\\w.-]+$`));
    expect(html).not.toMatch(/https?:|\/\/[a-z]/i);
  });

  it("keeps the CSS free of external imports and URLs", () => {
    expect(styles.length).toBeGreaterThan(0);
    for (const name of styles) {
      const css = asset(name);
      expect(css, name).not.toMatch(/@import/);
      for (const match of css.matchAll(/url\(([^)]*)\)/g)) {
        expect(match[1], name).not.toMatch(/https?:|^["']?\/\//);
      }
    }
  });

  it("is meant to be served with the policy of security-headers.ts", () => {
    expect(ADMIN_SECURITY_HEADERS["Content-Security-Policy"]).toContain("script-src 'self';");
  });
});

describe("route chunks and the entry budget", () => {
  it("builds every area as its own lazy chunk, outside the initial load", () => {
    const initial = initialChunks();
    const initialFiles = new Set([...initial].map((key) => manifest[key]?.file));
    const [, entryChunk] = entry();
    for (const module of AREA_MODULES) {
      const chunk = manifest[module];
      expect(chunk, module).toBeDefined();
      expect(chunk?.isDynamicEntry, module).toBe(true);
      expect(initialFiles.has(chunk?.file), `${module} is loaded on start`).toBe(false);
      expect(entryChunk.dynamicImports ?? [], module).toContain(module);
    }
  });

  it(`keeps the initial JavaScript under ${INITIAL_JS_BUDGET.raw} bytes raw and ${INITIAL_JS_BUDGET.gzip} gzip`, () => {
    let raw = 0;
    let gzip = 0;
    for (const key of initialChunks()) {
      const file = manifest[key]?.file as string;
      const content = readFileSync(join(dist, file));
      raw += content.length;
      gzip += gzipSync(content, { level: 9 }).length;
    }
    expect(raw).toBeGreaterThan(100_000);
    expect(raw).toBeLessThanOrEqual(INITIAL_JS_BUDGET.raw);
    expect(gzip).toBeLessThanOrEqual(INITIAL_JS_BUDGET.gzip);
  });
});

describe("message chunks", () => {
  it("keeps the lazy message files out of the initial JavaScript, each in its own chunk per language", () => {
    const initialCode = [...initialChunks()]
      .map((key) => manifest[key]?.file as string)
      .filter((file) => file.endsWith(".js"))
      .map((file) => readFileSync(join(dist, file), "utf8"))
      .join("\n");
    for (const file of LAZY_FILES) {
      for (const locale of ["uk", "en"] as const) {
        const source = `src/messages/${locale}/${file}.json`;
        const chunk = manifest[source];
        expect(chunk?.isDynamicEntry, source).toBe(true);
        const messages = JSON.parse(
          readFileSync(join(import.meta.dirname, source), "utf8"),
        ) as Record<string, string>;
        // A text that an eager file also has (the same sentence in two places) is in the entry legitimately.
        const eagerValues = new Set(Object.values(eagerMessages[locale]));
        const values = Object.values(messages).filter(
          (value) => value.length > 20 && !eagerValues.has(value),
        );
        expect(values.length, source).toBeGreaterThan(5);
        for (const value of values) {
          expect(
            initialCode.includes(JSON.stringify(value).slice(1, -1)),
            `${source}: ${value}`,
          ).toBe(false);
        }
      }
    }
  });
});

describe("bundle content", () => {
  it("contains no zod (the admin does not import @fluxkit/core)", () => {
    for (const name of scripts) expect(asset(name), name).not.toMatch(/\$ZodType|ZodError|\bzod\b/);
  });

  it("uses localStorage once, for the UI language only", () => {
    const uses = scripts.flatMap((name) =>
      [...asset(name).matchAll(/localStorage/g)].map(() => name),
    );
    expect(uses).toHaveLength(1);
    expect(asset(uses[0] as string)).toContain(LOCALE_STORAGE_KEY);
  });

  it("touches sessionStorage only inside react-router (its view-transition read; the SPA writes nothing there)", () => {
    for (const name of scripts) {
      const text = asset(name);
      if (text.includes("sessionStorage")) expect(text, name).toContain("remix-router-transitions");
    }
    for (const name of scripts) expect(asset(name), name).not.toMatch(/document\.cookie/);
  });
});
