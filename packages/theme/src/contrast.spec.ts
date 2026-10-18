import { readFileSync } from "node:fs";
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
