import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Design batch B (plan 2026-11-03-storefront-design-b.md): `@fluxkit/theme` gained a system mode that follows the OS dark
// setting. The admin shares the tokens but must not change: it renders `data-theme="light"`, and the BUILT stylesheet may
// follow `prefers-color-scheme` only for `[data-theme=system]`, a value the admin never sets. Reads the output of
// `vite build` (`pnpm test` builds first; turbo runs this package's build before its tests).

const appRoot = join(import.meta.dirname, "..");
const dist = join(appRoot, "dist");

function builtCss(): string {
  const assets = join(dist, "assets");
  if (!existsSync(assets)) {
    throw new Error(
      "apps/admin/dist is missing: run `pnpm build` (the root `pnpm test` does) before this spec.",
    );
  }
  const files = readdirSync(assets).filter((name) => name.endsWith(".css"));
  expect(files.length, "built CSS files").toBeGreaterThan(0);
  return files.map((name) => readFileSync(join(assets, name), "utf8")).join("\n");
}

/** The bodies of every `@media (...prefers-color-scheme...)` rule, braces balanced. */
function colorSchemeMediaBlocks(css: string): string[] {
  const blocks: string[] = [];
  for (const match of css.matchAll(/@media[^{]*prefers-color-scheme[^{]*\{/g)) {
    let depth = 1;
    let index = (match.index ?? 0) + match[0].length;
    const start = index;
    while (depth > 0 && index < css.length) {
      if (css[index] === "{") depth += 1;
      if (css[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push(css.slice(start, index - 1));
  }
  return blocks;
}

describe("the admin is not affected by the storefront's dark and system themes", () => {
  it("renders its page with data-theme=light, in the source and in the built index.html", () => {
    expect(readFileSync(join(appRoot, "index.html"), "utf8")).toMatch(
      /<html [^>]*data-theme="light"/,
    );
    expect(readFileSync(join(dist, "index.html"), "utf8")).toMatch(/<html [^>]*data-theme="light"/);
  });

  it("follows the OS colour scheme in the built CSS only for [data-theme=system]", () => {
    const blocks = colorSchemeMediaBlocks(builtCss());
    expect(blocks.length, "the tokens' system block is in the build").toBeGreaterThan(0);
    for (const block of blocks) {
      const selectors = [...block.matchAll(/([^{}]+)\{/g)].map((match) =>
        (match[1] as string).trim(),
      );
      expect(selectors.length).toBeGreaterThan(0);
      for (const selector of selectors) {
        expect(selector.replace(/["']/g, ""), "a dark rule outside the opt-in system mode").toBe(
          "[data-theme=system]",
        );
      }
    }
  });

  it("keeps the light values on the page root and color-scheme light", () => {
    const css = builtCss();
    expect(css).toMatch(/:root,\s*\[data-theme=["']?light["']?\]\s*\{[^}]*color-scheme:\s*light/);
    expect(css).toMatch(/:root,\s*\[data-theme=["']?light["']?\]\s*\{[^}]*--fk-color-background:/);
  });

  it("is the scanner itself sound (a selector outside the system mode is found)", () => {
    const blocks = colorSchemeMediaBlocks(
      "@media (prefers-color-scheme:dark){:root{--a:1}[data-theme=system]{--a:2}}",
    );
    expect(blocks).toEqual([":root{--a:1}[data-theme=system]{--a:2}"]);
  });
});
