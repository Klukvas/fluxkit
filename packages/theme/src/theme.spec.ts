import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { themeModes } from "./index.js";
import { adminTokens, storefrontTokens } from "./theme-run.testing.js";
import {
  darkSchemeMedia,
  reducedMotionMedia,
  effectiveTokens,
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

/** Colours and shadows differ between the themes; every other token (fonts, radii, type scale, spacing) is the same in both. */
const themedToken = /^--fk-(color|shadow)-/;
const nonColourPrefixes = [
  "--fk-font-",
  "--fk-radius-",
  "--fk-space-",
  "--fk-line-height-",
  "--fk-motion-",
];

describe("design tokens", () => {
  it("defines every non-colour token once, in the light block only (dark and system inherit it from :root)", () => {
    const nonColour = definedTokens(lightBlock).filter((name) => !themedToken.test(name));
    expect(nonColour.length).toBeGreaterThan(10);
    for (const name of nonColour) {
      expect(
        nonColourPrefixes.some((prefix) => name.startsWith(prefix)),
        `${name} is neither a colour, a shadow nor a known non-colour token`,
      ).toBe(true);
    }
    for (const block of blocks.filter(
      (candidate) => candidate !== lightBlock && candidate.media !== reducedMotionMedia,
    )) {
      const repeated = definedTokens(block).filter((name) => !themedToken.test(name));
      expect(repeated, `${block.selector} repeats non-colour tokens of the light block`).toEqual(
        [],
      );
    }
  });

  it("gives the dark block exactly the colour and shadow names of the light block", () => {
    const lightThemed = definedTokens(lightBlock).filter((name) => themedToken.test(name));
    expect(lightThemed.length).toBeGreaterThan(10);
    expect(definedTokens(darkBlock)).toEqual(lightThemed);
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

  it("defaults the display (heading) font to the body font", () => {
    // The template's value. A fork that gives headings their own face changes `--fk-font-display` and passes; one that changes
    // only the body face is told to decide the headings too (they would silently stay in the old system stack).
    // This literal must equal the template's `--fk-font-sans` (and `--fk-font-display`) in tokens.css: change all three together.
    // Read on the storefront's EFFECTIVE light values: a fork sets fonts in its overrides file, not in tokens.css.
    const templateDisplay = "var(--font-template-sans, ui-sans-serif), system-ui, sans-serif";
    const display = storefrontTokens.light.get("--fk-font-display");
    const sans = storefrontTokens.light.get("--fk-font-sans");
    expect(sans).toBeDefined();
    expect(display).toBeDefined();
    expect(
      display !== templateDisplay || display === sans,
      "--fk-font-sans changed but --fk-font-display is still the template's stack: set it as well",
    ).toBe(true);
  });

  it("defines the radius roles as literal rem values, not as a var() of the size steps", () => {
    // Plan 2026-11-08 T3: a literal per role, so a rebrand of one role (`--fk-radius-card: 0`) restyles only that role, and mail
    // and the parsers keep reading plain values.
    for (const role of ["control", "card", "panel", "overlay", "media"]) {
      expect(lightBlock.tokens.get(`--fk-radius-${role}`), role).toMatch(/^[0-9.]+rem$/);
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

  it("has exactly three theme blocks and the reduced-motion accessibility block", () => {
    expect(blocks.map((block) => [block.selector, block.media])).toEqual([
      [themeSelectors.light, null],
      [themeSelectors.dark, null],
      [themeSelectors.system, darkSchemeMedia],
      ["html:root", reducedMotionMedia],
    ]);
  });

  it('follows the OS dark setting only on a page that opted in with data-theme="system" (the admin keeps light)', () => {
    for (const block of blocks.filter(
      (candidate) => candidate.media !== null && candidate.media !== reducedMotionMedia,
    )) {
      expect(block.selector).toBe(themeSelectors.system);
      expect(block.media).toBe(darkSchemeMedia);
    }
    expect(tokensCss).not.toMatch(/@media[^{]*\{\s*:root/);
  });

  it("gives the system block exactly the dark block (same names, values and order)", () => {
    expect(darkBlock.tokens.size).toBeGreaterThan(10);
    expect([...systemBlock.tokens]).toEqual([...darkBlock.tokens]);
  });

  it("writes the system block byte for byte like the dark block (a rebrand copies it)", () => {
    const body = (pattern: RegExp): string => {
      const match = pattern.exec(tokensCss);
      expect(match, String(pattern)).not.toBeNull();
      return (match?.[1] as string)
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .join("\n");
    };
    expect(body(/\[data-theme="system"\] \{([^}]*)\}/)).toBe(
      body(/^\[data-theme="dark"\] \{([^}]*)\}/m),
    );
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

describe("effective values (the cascade of tokens.css and an overrides file)", () => {
  const overrides = (css: string) => [...blocks, ...parseTokenBlocks(css)];
  const light = ':root, [data-theme="light"] { --fk-color-primary: #111111; --fk-radius-card: 0; }';
  const dark = '[data-theme="dark"] { --fk-color-primary: #222222; }';
  const system =
    '@media (prefers-color-scheme: dark) { [data-theme="system"] { --fk-color-primary: #222222; } }';
  const primary = (css: string, state: Parameters<typeof effectiveTokens>[1]) =>
    effectiveTokens(overrides(css), state).get("--fk-color-primary");

  it("equals the tokens.css blocks without overrides (light, dark, system on either device, no attribute)", () => {
    expect(effectiveTokens(blocks, { theme: "light", osDark: true })).toEqual(lightBlock.tokens);
    expect(effectiveTokens(blocks, { theme: null, osDark: false })).toEqual(lightBlock.tokens);
    expect(effectiveTokens(blocks, { theme: "system", osDark: false })).toEqual(lightBlock.tokens);
    expect(effectiveTokens(blocks, { theme: "dark", osDark: false })).toEqual(
      new Map([...lightBlock.tokens, ...darkBlock.tokens]),
    );
    expect(effectiveTokens(blocks, { theme: "system", osDark: true })).toEqual(
      new Map([...lightBlock.tokens, ...darkBlock.tokens]),
    );
  });

  it("lets an override win over tokens.css in each mode: the later rule of equal specificity", () => {
    const all = `${light}\n${dark}\n${system}`;
    expect(primary(all, { theme: "light", osDark: false })).toBe("#111111");
    expect(primary(all, { theme: "dark", osDark: false })).toBe("#222222");
    expect(primary(all, { theme: "system", osDark: false })).toBe("#111111");
    expect(primary(all, { theme: "system", osDark: true })).toBe("#222222");
    // A light-only token (a radius) reaches every mode: dark and system inherit it from :root.
    expect(
      effectiveTokens(overrides(all), { theme: "dark", osDark: false }).get("--fk-radius-card"),
    ).toBe("0");
  });

  it("shows why a light colour override needs its dark and system rules: alone it wins on dark pages too", () => {
    expect(primary(light, { theme: "dark", osDark: false })).toBe("#111111");
    expect(primary(light, { theme: "system", osDark: true })).toBe("#111111");
  });

  it("refuses selectors and media of another shape (another specificity would make source order meaningless)", () => {
    expect(() =>
      effectiveTokens(overrides("html { --fk-radius-card: 0; }"), {
        theme: "light",
        osDark: false,
      }),
    ).toThrow(/Unknown selector "html"/);
    expect(() =>
      effectiveTokens(overrides('[data-theme="dark"], .x { --fk-radius-card: 0; }'), {
        theme: "dark",
        osDark: false,
      }),
    ).toThrow(/Unknown selector ".x"/);
    expect(() =>
      effectiveTokens(overrides("@media print { :root { --fk-radius-card: 0; } }"), {
        theme: "light",
        osDark: false,
      }),
    ).toThrow(/Unknown media query/);
  });
});

/**
 * The admin's font tokens that name a web font variable of the storefront (`var(--font-...)` from `next/font` in
 * `config/fonts.ts` or `lib/template-fonts.ts`): without an internal fallback the whole `font-family` declaration is invalid
 * there and the browser falls back to its default serif face (Times New Roman), not to the stack after the `var()`.
 */
export function adminWebFontProblems(tokens: Map<string, string>): string[] {
  return [...tokens]
    .filter(
      ([name, value]) =>
        name.startsWith("--fk-font-") &&
        [...value.matchAll(/var\(--font-[a-z0-9-]+(?:,([^()]*))?\)/gi)].some(
          (match) => !match[1]?.trim(),
        ),
    )
    .map(
      ([name, value]) =>
        `${name} reaches the admin as "${value}", but the admin has no var(--font-*) (the storefront's next/font): ` +
        `restate ${name} in packages/theme/src/admin-overrides.css without it (a self-hosted @font-face there, or the fallback stack)`,
    );
}

describe("admin font tokens (the admin follows the shop's overrides, ADR 0047)", () => {
  it("names no storefront web font variable without an internal fallback", () => {
    expect(adminWebFontProblems(adminTokens)).toEqual([]);
  });

  it("accepts a non-empty var fallback, but rejects an absent or empty one", () => {
    expect(
      adminWebFontProblems(
        new Map([
          ["--fk-font-sans", "var(--font-template-sans, ui-sans-serif), system-ui, sans-serif"],
        ]),
      ),
    ).toEqual([]);
    for (const value of ["var(--font-body)", "var(--font-body,)", "var(--font-body,   )"]) {
      expect(adminWebFontProblems(new Map([["--fk-font-sans", value]]))).toHaveLength(1);
    }
  });

  it("finds a storefront web font variable and names the file to fix (the check itself)", () => {
    const problems = adminWebFontProblems(
      new Map([
        ["--fk-font-display", "var(--font-display-face), ui-serif, serif"],
        ["--fk-font-sans", "ui-sans-serif, system-ui, sans-serif"],
        ["--fk-color-primary", "#000000"],
      ]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^--fk-font-display reaches the admin/);
    expect(problems[0]).toMatch(
      /restate --fk-font-display in packages\/theme\/src\/admin-overrides.css/,
    );
  });
});

describe("motion contract", () => {
  it("defines exactly six motion tokens in light and maps them to Tailwind", () => {
    const durations = ["fast", "base", "slow"];
    const easings = ["standard", "emphasized", "spring"];
    expect(definedTokens(lightBlock).filter((name) => name.startsWith("--fk-motion-"))).toEqual(
      [
        ...durations.map((step) => `--fk-motion-duration-${step}`),
        ...easings.map((step) => `--fk-motion-ease-${step}`),
      ].sort(),
    );
    for (const step of easings) {
      expect(tailwindCss).toContain(`--ease-${step}: var(--fk-motion-ease-${step});`);
    }
    for (const step of durations) {
      expect(tailwindCss).toContain(
        `@utility duration-${step} {\n  --tw-duration: var(--fk-motion-duration-${step});\n  transition-duration: var(--fk-motion-duration-${step});\n}`,
      );
    }
    expect(tailwindCss).toContain("--default-transition-duration: var(--fk-motion-duration-fast);");
    expect(tailwindCss).toContain(
      "--default-transition-timing-function: var(--fk-motion-ease-standard);",
    );
  });

  it("zeroes exactly the three durations with specificity higher than fork overrides", () => {
    const reduced = tokenBlock(blocks, "html:root", reducedMotionMedia);
    expect([...reduced.properties]).toEqual([]);
    expect([...reduced.tokens]).toEqual(
      ["fast", "base", "slow"].map((step) => [`--fk-motion-duration-${step}`, "0ms"]),
    );
    expect(
      effectiveTokens(blocks, { theme: "light", osDark: false }).get("--fk-motion-duration-fast"),
    ).toBe("150ms");
  });
});
