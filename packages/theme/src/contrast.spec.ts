import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// WCAG 2.x contrast (https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio), pure code, no dependency.
// tokens.css uses 6-digit hex colors only; any other format fails loudly instead of being skipped.
const tokensCss = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");
const [lightBlock, darkBlock] = tokensCss.split('[data-theme="dark"]') as [string, string];

function tokenValues(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/(--fk-color-[a-z-]+)\s*:\s*([^;]+);/g)].map((match) => [
      match[1] as string,
      (match[2] as string).trim(),
    ]),
  );
}

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) {
    throw new Error(`Unsupported color format "${hex}": use a 6-digit hex color in tokens.css`);
  }
  const [r, g, b] = [match[1], match[2], match[3]].map((part) =>
    channel(Number.parseInt(part as string, 16)),
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

const textMinimum = 4.5;
const nonTextMinimum = 3;

// [foreground token, background token, minimum ratio]
const pairs: [string, string, number][] = [
  ["foreground", "background", textMinimum],
  ["primary-foreground", "primary", textMinimum],
  ["muted-foreground", "muted", textMinimum],
  ["danger", "background", textMinimum],
  ["success", "background", textMinimum],
  ["warning", "background", textMinimum],
  ["ring", "background", nonTextMinimum],
  ["danger", "muted", textMinimum],
  ["success", "muted", textMinimum],
  ["warning", "muted", textMinimum],
  // Used by components, once missing from this list (review M3): a rebrand could break them unnoticed.
  ["muted-foreground", "background", textMinimum],
  ["foreground", "muted", textMinimum],
  ["ring", "muted", nonTextMinimum],
  ["primary", "background", nonTextMinimum],
  ["primary", "muted", nonTextMinimum],
  // WCAG 1.4.11: the border that identifies an input, textarea, select or checkbox. `border` stays decorative.
  ["border-input", "background", nonTextMinimum],
  ["border-input", "muted", nonTextMinimum],
];

// Pairs components use on purpose WITHOUT a contrast requirement, each with its reason.
const decorative: [string, string, string][] = [
  [
    "border",
    "background",
    "outline of cards, badges, buttons and dividers: the content is identified by its text, not by the line",
  ],
  ["border", "muted", "outline of cards and alerts"],
];

describe("contrast helper", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("rejects color formats it cannot parse", () => {
    expect(() => luminance("rgb(1 2 3)")).toThrow(/Unsupported color format/);
    expect(() => luminance("#fff")).toThrow(/Unsupported color format/);
  });
});

describe("token contrast (WCAG 2.x)", () => {
  for (const [theme, block] of [
    ["light", lightBlock],
    ["dark", darkBlock],
  ] as const) {
    const values = tokenValues(block);
    for (const [foreground, background, minimum] of pairs) {
      it(`${theme}: ${foreground} on ${background} is at least ${minimum}:1`, () => {
        const foregroundValue = values.get(`--fk-color-${foreground}`);
        const backgroundValue = values.get(`--fk-color-${background}`);
        expect(foregroundValue, `--fk-color-${foreground} is not defined`).toBeDefined();
        expect(backgroundValue, `--fk-color-${background} is not defined`).toBeDefined();
        const ratio = contrastRatio(foregroundValue as string, backgroundValue as string);
        expect(ratio, `${foregroundValue} on ${backgroundValue}`).toBeGreaterThanOrEqual(minimum);
      });
    }
  }
});

// Every foreground/background pair the components use must be listed above (or be decorative with a reason). Found by reading
// the class strings of packages/ui, apps/storefront and apps/admin: in a string with a `bg-<token>` the pair is (text/border/outline/ring
// token, that background); without one it is the page `background`. A pair of a token with itself (a selected option's
// primary border on a primary fill) has no contrast to measure.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const scannedRoots = ["packages/ui/src", "apps/storefront/src", "apps/admin/src"];
const colorTokens = [...tokenValues(lightBlock).keys()].map((name) =>
  name.replace("--fk-color-", ""),
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.spec\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Exported for its own test below. */
export function usedPairs(source: string, tokens: readonly string[]): Set<string> {
  const used = new Set<string>();
  // Longest names first, so `muted-foreground` is not read as `muted`.
  const ordered = [...tokens].sort((a, b) => b.length - a.length);
  const read = (classes: string[], prefix: string): string[] =>
    classes.flatMap((name) => {
      const bare = name.split(":").pop() as string;
      for (const token of ordered) {
        if (bare === `${prefix}-${token}` || bare.startsWith(`${prefix}-${token}/`)) return [token];
      }
      return [];
    });
  for (const match of source.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
    const classes = (match[2] as string).split(/\s+/);
    const foregrounds = ["text", "border", "outline", "ring"].flatMap((prefix) =>
      read(classes, prefix),
    );
    if (foregrounds.length === 0) continue;
    const backgrounds = read(classes, "bg");
    for (const foreground of foregrounds) {
      for (const background of backgrounds.length === 0 ? ["background"] : backgrounds) {
        if (foreground !== background) used.add(`${foreground} on ${background}`);
      }
    }
  }
  return used;
}

describe("pairs the components use", () => {
  const covered = new Set([
    ...pairs.map(([foreground, background]) => `${foreground} on ${background}`),
    ...decorative.map(([foreground, background]) => `${foreground} on ${background}`),
  ]);

  it("reads class strings (the scanner itself)", () => {
    expect(
      [
        ...usedPairs(
          `"bg-muted text-muted-foreground hover:border-danger/50 text-sm"`,
          colorTokens,
        ),
      ].sort(),
    ).toEqual(["danger on muted", "muted-foreground on muted"].sort());
    expect([...usedPairs(`"text-foreground outline-ring"`, colorTokens)].sort()).toEqual([
      "foreground on background",
      "ring on background",
    ]);
    expect([...usedPairs(`"bg-primary border-primary"`, colorTokens)]).toEqual([]);
  });

  it("scans every root with at least one source file (a renamed folder must not drop out silently)", () => {
    for (const root of scannedRoots) {
      expect(sourceFiles(join(repoRoot, root)).length, root).toBeGreaterThan(0);
    }
  });

  it("finds the pairs of the real components", () => {
    const found = new Set(
      scannedRoots.flatMap((root) =>
        sourceFiles(join(repoRoot, root)).flatMap((file) => [
          ...usedPairs(readFileSync(file, "utf8"), colorTokens),
        ]),
      ),
    );
    expect(found.has("foreground on background")).toBe(true);
    expect(found.has("muted-foreground on background")).toBe(true);
    expect(found.has("border-input on background")).toBe(true);
    const uncovered = [...found].filter((pair) => !covered.has(pair));
    expect(
      uncovered,
      "add these pairs to `pairs` (with a minimum) or to `decorative` (with a reason)",
    ).toEqual([]);
  });
});
