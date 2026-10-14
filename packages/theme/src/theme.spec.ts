import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
const tokensCss = read("tokens.css");
const tailwindCss = read("tailwind.css");

function definedTokens(block: string): string[] {
  return [...block.matchAll(/(--fk-[a-z0-9-]+)\s*:/g)].map((match) => match[1] as string).sort();
}

describe("design tokens", () => {
  const [lightBlock, darkBlock] = tokensCss.split('[data-theme="dark"]') as [string, string];

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
});
