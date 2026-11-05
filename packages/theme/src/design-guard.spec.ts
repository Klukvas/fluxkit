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

  it("scans every root with at least one file, the admin app and the new admin components included", () => {
    for (const root of roots) {
      expect(files(root).length, root.replace(repoRoot, "")).toBeGreaterThan(0);
    }
    const uiFiles = files(join(repoRoot, "packages/ui/src")).map((file) =>
      file.replace(repoRoot, ""),
    );
    expect(uiFiles).toContain("packages/ui/src/data-table.tsx");
    expect(uiFiles).toContain("packages/ui/src/dialog.tsx");
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
  /^([trblxyse]|xs|sm|base|lg|xl|[2-9]xl|left|center|right|start|end|justify|wrap|nowrap|balance|pretty|ellipsis|clip|none|inherit|current|transparent|solid|dashed|dotted|inset|card|raised|overlay|\d+|\d+\/\d+|offset-\d+|linecap|linejoin|miterlimit|dasharray|dashoffset)$/;

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

  it("does not mistake the stroke geometry properties for colors", () => {
    expect(nonTokenColorClasses(`stroke-linecap: round; stroke-linejoin: round;`)).toEqual([]);
    expect(nonTokenColorClasses(`"stroke-teal"`)).toEqual(["stroke-teal"]);
    expect(nonTokenColorClasses(`"stroke-linecap-teal"`)).toEqual(["stroke-linecap-teal"]);
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

// The design kit (review D-19, plan 2026-11-03-storefront-design-a.md): sizes, radii and elevation come from tokens. tailwind.css
// maps the type scale, the spacing unit and the shadows to `--fk-*` tokens; a class outside those scales (`text-5xl`,
// `rounded-xl`, `shadow-md`) would use one of Tailwind's built-in values, which a rebrand of tokens.css cannot reach.
// `rounded-full` is a shape (a pill or a circle), not a brand value, so it is allowed without a token.
const typeSteps = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl"];
const radiusSteps = ["sm", "md", "lg", "full", "none"];
const shadowSteps = ["card", "raised", "overlay", "none"];

/** Class names of every quoted string in a source, without their variants (`md:hover:shadow-raised` -> `shadow-raised`). */
function quotedClasses(source: string): string[] {
  return [...source.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].flatMap((match) =>
    (match[2] as string)
      .split(/\s+/)
      .map((name) => name.split(":").pop() as string)
      .filter((name) => name !== ""),
  );
}

/** The classes of a source that leave the token scales. */
function offScaleClasses(source: string): string[] {
  return quotedClasses(source).filter((name) => {
    const size = /^text-(xs|sm|base|lg|\d?xl)$/.exec(name);
    if (size) return !typeSteps.includes(size[1] as string);
    const radius = /^rounded(?:-(?:[trblse]|[trbl][lr]|s[se]|e[se]))?(?:-([a-z0-9]+))?$/.exec(name);
    if (radius) return !radiusSteps.includes(radius[1] ?? "");
    const shadow = /^shadow(?:-([a-z0-9]+))?$/.exec(name);
    if (shadow) return !shadowSteps.includes(shadow[1] ?? "");
    return false;
  });
}

describe("design guard, the design kit scales", () => {
  it("maps every type step, the spacing unit, the radii and the shadows to tokens", () => {
    for (const step of typeSteps) {
      expect(tailwindCss).toContain(`--text-${step}: var(--fk-font-size-${step});`);
      expect(tailwindCss).toContain(`--text-${step}--line-height: var(--fk-line-height-${step});`);
    }
    expect(tailwindCss).toContain("--spacing: var(--fk-space-unit);");
    for (const step of shadowSteps.filter((name) => name !== "none")) {
      expect(tailwindCss).toContain(`--shadow-${step}: var(--fk-shadow-${step});`);
    }
    for (const step of radiusSteps.filter((name) => name !== "none" && name !== "full")) {
      expect(tailwindCss).toContain(`--radius-${step}: var(--fk-radius-${step});`);
    }
  });

  it("flags sizes, radii and shadows outside the scales, and nothing else", () => {
    expect(
      offScaleClasses(
        `"text-5xl md:text-9xl rounded-xl rounded-t-2xl rounded shadow-md hover:shadow-lg shadow"`,
      ),
    ).toEqual([
      "text-5xl",
      "text-9xl",
      "rounded-xl",
      "rounded-t-2xl",
      "rounded",
      "shadow-md",
      "shadow-lg",
      "shadow",
    ]);
    expect(
      offScaleClasses(
        `"text-sm lg:text-4xl text-foreground rounded-md rounded-t-lg rounded-full hover:shadow-raised shadow-overlay shadow-none"`,
      ),
    ).toEqual([]);
  });

  it("finds no size, radius or shadow outside the token scales in components or apps", () => {
    // Specs are left out: their test names are prose ("is rounded down"), not class lists.
    const styled = sources.filter((file) => !/\.spec\.tsx?$/.test(file));
    expect(styled.length).toBeGreaterThan(5);
    const offenders = styled.flatMap((file) =>
      offScaleClasses(readFileSync(file, "utf8")).map(
        (name) => `${file.replace(repoRoot, "")}: ${name}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
