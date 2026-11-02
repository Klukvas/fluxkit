import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { themeModes } from "./index.js";
import {
  darkSchemeMedia,
  parseTokenBlocks,
  themeSelectors,
  tokenBlock,
  type TokenBlock,
} from "./token-blocks.js";

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
const tokensCss = read("tokens.css");
const tailwindCss = read("tailwind.css");

const blocks = parseTokenBlocks(tokensCss);
const lightBlock = tokenBlock(blocks, themeSelectors.light);
const darkBlock = tokenBlock(blocks, themeSelectors.dark);

function definedTokens(block: TokenBlock): string[] {
  return [...block.tokens.keys()].sort();
}

describe("design tokens", () => {
  it("defines the same token names in the light and dark themes", () => {
    expect(definedTokens(darkBlock)).toEqual(definedTokens(lightBlock));
    expect(definedTokens(lightBlock).length).toBeGreaterThan(5);
  });

  it("maps only tokens that exist (no dangling var() in tailwind.css)", () => {
    const defined = new Set(definedTokens(lightBlock));
    const used = [...tailwindCss.matchAll(/var\((--fk-[a-z0-9-]+)\)/g)].map(
      (match) => match[1] as string,
    );
    expect(used.length).toBeGreaterThan(5);
    for (const name of used) {
      expect(
        defined.has(name),
        `${name} is used in tailwind.css but not defined in tokens.css`,
      ).toBe(true);
    }
  });

  it("maps every color token to a Tailwind utility color of the same name", () => {
    const colorTokens = definedTokens(lightBlock).filter((name) => name.startsWith("--fk-color-"));
    for (const name of colorTokens) {
      const utility = name.replace("--fk-color-", "--color-");
      expect(tailwindCss, `${name} has no ${utility} mapping`).toContain(
        `${utility}: var(${name});`,
      );
    }
  });

  it("defines the status and focus tokens added for the storefront", () => {
    const defined = definedTokens(lightBlock);
    for (const name of ["--fk-color-success", "--fk-color-warning", "--fk-color-ring"]) {
      expect(defined).toContain(name);
    }
  });
});

describe("theme modes (design batch B)", () => {
  const systemBlock = tokenBlock(blocks, themeSelectors.system, darkSchemeMedia);

  it("has exactly the light, dark and system blocks (nothing else can restyle a page)", () => {
    expect(blocks.map((block) => [block.selector, block.media])).toEqual([
      [themeSelectors.light, null],
      [themeSelectors.dark, null],
      [themeSelectors.system, darkSchemeMedia],
    ]);
  });

  it('follows the OS dark setting only on a page that opted in with data-theme="system" (the admin keeps light)', () => {
    for (const block of blocks.filter((candidate) => candidate.media !== null)) {
      expect(block.selector).toBe(themeSelectors.system);
      expect(block.media).toBe(darkSchemeMedia);
    }
    expect(tokensCss).not.toMatch(/@media[^{]*\{\s*:root/);
  });

  it("gives the system block the dark value of every token whose dark value differs from light, and nothing else", () => {
    const differing = [...darkBlock.tokens].filter(
      ([name, value]) => lightBlock.tokens.get(name) !== value,
    );
    expect(differing.length).toBeGreaterThan(10);
    expect([...systemBlock.tokens]).toEqual(differing);
  });

  it("sets color-scheme, so native controls, scrollbars and select popups follow the theme", () => {
    expect(lightBlock.properties.get("color-scheme")).toBe("light");
    expect(darkBlock.properties.get("color-scheme")).toBe("dark");
    expect(systemBlock.properties.get("color-scheme")).toBe("dark");
  });

  it("exports the three modes a page may set", () => {
    expect([...themeModes]).toEqual(["light", "dark", "system"]);
  });
});

describe("token block parser", () => {
  it("reads top-level and media blocks with their declarations", () => {
    const parsed = parseTokenBlocks(
      `/* c */ :root, [x] { --a: 1; color-scheme: light; }\n@media (m) { [y] { --a: 2; } }`,
    );
    expect(parsed.map((block) => [block.selector, block.media])).toEqual([
      [":root, [x]", null],
      ["[y]", "(m)"],
    ]);
    expect(parsed[0]?.tokens.get("--a")).toBe("1");
    expect(parsed[0]?.properties.get("color-scheme")).toBe("light");
  });

  it("refuses shapes it does not know", () => {
    expect(() => parseTokenBlocks(":root { a { --b: 1; } }")).toThrow(/Unexpected rule shape/);
    expect(() => parseTokenBlocks(":root { nonsense }")).toThrow(/Unreadable declaration/);
  });
});
