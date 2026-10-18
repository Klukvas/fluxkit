import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// AGENTS.md section 2.2: no hardcoded colors, fonts or arbitrary design values in components or apps.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const roots = ["packages/ui/src", "apps/storefront/src", "apps/admin/src"].map((path) =>
  join(repoRoot, path),
);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return files(full);
    }
    return /\.(tsx?|css)$/.test(entry) ? [full] : [];
  });
}

const forbidden: [string, RegExp][] = [
  ["hex color", /#[0-9a-fA-F]{3,8}\b/],
  ["rgb()/hsl()/oklch() color", /\b(rgb|rgba|hsl|hsla|oklch)\(/],
  [
    "Tailwind palette color (use semantic tokens)",
    /\b(bg|text|border|ring|fill|stroke|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(-\d{2,3})?\b/,
  ],
  ["arbitrary Tailwind value", /\b[a-z-]+-\[[^\]]+\]/],
  ["inline style attribute", /\bstyle=\{\{/],
];

const sources = roots.flatMap(files);

describe("design guard", () => {
  it("scans real files", () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  for (const [label, pattern] of forbidden) {
    it(`no ${label} in components or apps`, () => {
      const offenders = sources.filter((file) => pattern.test(readFileSync(file, "utf8")));
      expect(offenders.map((file) => file.replace(repoRoot, ""))).toEqual([]);
    });
  }
});

// Colors must come from the token names mapped in tailwind.css (`--color-<name>`), so a class such as
// `bg-brand` or `text-teal` that the palette regex does not know is still rejected.
const tailwindCss = readFileSync(join(repoRoot, "packages/theme/src/tailwind.css"), "utf8");
const colorNames = new Set(
  [...tailwindCss.matchAll(/--color-([a-z-]+):/g)].map((match) => match[1] as string),
);
const colorPrefixes =
  "bg|text|border|ring|outline|fill|stroke|divide|placeholder|accent|caret|decoration|shadow";
const colorUtility = new RegExp(
  `(?<![\\w-])(?:[a-z-]+:)*(${colorPrefixes})-((?:[trblxyse]-)?)([a-z0-9][a-z0-9./-]*)`,
  "g",
);
// Same prefixes, but the value is a size, alignment, width or keyword, not a color.
const notAColor =
  /^([trblxyse]|xs|sm|base|lg|xl|[2-9]xl|left|center|right|start|end|justify|wrap|nowrap|balance|pretty|ellipsis|clip|none|inherit|current|transparent|solid|dashed|dotted|inset|card|\d+|\d+\/\d+)$/;

function nonTokenColorClasses(source: string): string[] {
  return [...source.matchAll(colorUtility)]
    .map((match) => ({ whole: match[0], value: (match[3] as string).replace(/\/\d+$/, "") }))
    .filter(({ value }) => !colorNames.has(value) && !notAColor.test(value))
    .map(({ whole }) => whole);
}

describe("design guard, token-only color classes", () => {
  it("knows the color token names", () => {
    expect(colorNames.has("primary")).toBe(true);
    expect(colorNames.has("ring")).toBe(true);
  });

  it("accepts token colors, sizes and state variants", () => {
    const source = `"bg-primary text-sm text-primary-foreground/80 border-t-border ring-2 ring-ring hover:bg-muted shadow-card"`;
    expect(nonTokenColorClasses(source)).toEqual([]);
  });

  it("rejects colors that are not tokens", () => {
    expect(nonTokenColorClasses(`"bg-brand"`)).toEqual(["bg-brand"]);
    expect(nonTokenColorClasses(`"focus:ring-teal"`)).toEqual(["focus:ring-teal"]);
    expect(nonTokenColorClasses(`"text-red-500"`)).toEqual(["text-red-500"]);
  });

  it("finds no non-token color classes in components or apps", () => {
    const offenders = sources.flatMap((file) =>
      nonTokenColorClasses(readFileSync(file, "utf8")).map(
        (name) => `${file.replace(repoRoot, "")}: ${name}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe("design guard, patterns catch known violations", () => {
  const samples: Record<string, string> = {
    "hex color": `className="text-[#ff0000]"`,
    "rgb()/hsl()/oklch() color": `color: oklch(0.5 0.1 200)`,
    "Tailwind palette color (use semantic tokens)": `"bg-green-500"`,
    "arbitrary Tailwind value": `"p-[13px]"`,
    "inline style attribute": `<div style={{ color: "x" }} />`,
  };
  for (const [label, pattern] of forbidden) {
    it(`flags a sample for ${label}`, () => {
      expect(pattern.test(samples[label] as string)).toBe(true);
    });
  }
});
