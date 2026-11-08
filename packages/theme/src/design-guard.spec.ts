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
    // `font-display` (headings, plan 2026-11-08 T1) next to the body and code stacks.
    for (const family of ["sans", "mono", "display"]) {
      expect(tailwindCss).toContain(`--font-${family}: var(--fk-font-${family});`);
    }
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

// Heading roles (plan 2026-11-08-design-changeability.md, T1): every heading of the shared UI library and the storefront takes its
// typography from a `textStyles` role of `@fluxkit/ui`, so a redesign (a display font, another size) changes one place. A heading
// with no class, or with visibility classes only (`sr-only`, `lg:hidden`), has nothing to restyle. Known limits: the admin
// (`apps/admin`, 71 headings) is not scanned yet; classes passed through spread props (`{...props}`) and dynamic tags with
// another name than `Heading` (`const Title = level`) are not inspected; a role held in a const is refused, not followed.
const headingRoots = ["packages/ui/src", "apps/storefront/src"].map((path) => join(repoRoot, path));
const stylesSource = readFileSync(join(repoRoot, "packages/ui/src/styles.ts"), "utf8");
const textRoles = new Set(
  [
    ...(
      /export const textStyles = \{([\s\S]*?)\} as const;/.exec(stylesSource)?.[1] ?? ""
    ).matchAll(/^\s+([a-zA-Z]+):/gm),
  ].map((match) => match[1] as string),
);

interface TagClass {
  tag: string;
  /** The raw `className` value (`"..."` or `{...}`), or null when the tag has none. */
  className: string | null;
}

/** Reads a balanced `{...}` or a quoted string starting at `start`; returns its end (exclusive). */
function skipValue(source: string, start: number): number {
  const open = source[start];
  if (open === '"' || open === "'") return source.indexOf(open, start + 1) + 1;
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index] as string;
    if (quote !== null) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error(`Unbalanced attribute value near "${source.slice(start, start + 40)}"`);
}

/** The opening tags of `tags` in a JSX source with their `className`. */
function tagClasses(source: string, tags: RegExp): TagClass[] {
  const found: TagClass[] = [];
  for (const match of source.matchAll(new RegExp(`<(${tags.source})(?=[\\s>/])`, "g"))) {
    let index = (match.index ?? 0) + match[0].length;
    let className: string | null = null;
    for (;;) {
      const char = source[index];
      if (char === undefined) throw new Error(`Unclosed <${match[1] as string}>`);
      if (char === ">" || (char === "/" && source[index + 1] === ">")) break;
      if (char === "{" || char === '"' || char === "'") {
        index = skipValue(source, index);
        continue;
      }
      if (source.startsWith("className=", index)) {
        const start = index + "className=".length;
        index = skipValue(source, start);
        className = source.slice(start, index);
        continue;
      }
      index += 1;
    }
    found.push({ tag: match[1] as string, className });
  }
  return found;
}

const visibilityOnly = /^(?:[a-z0-9-]+:)*(?:sr-only|not-sr-only|hidden)$/;

/** Why a tag's classes bypass the text roles, or null when they are fine. */
function roleProblem({ className }: TagClass): string | null {
  if (className === null) return null;
  const literal = /^["']([^"']*)["']$/.exec(className);
  if (literal) {
    const classes = (literal[1] as string).split(/\s+/).filter((name) => name !== "");
    return classes.every((name) => visibilityOnly.test(name))
      ? null
      : `literal classes ${className} (use a textStyles role)`;
  }
  const roles = [...className.matchAll(/\btextStyles\.([a-zA-Z]+)/g)].map(
    (match) => match[1] as string,
  );
  if (roles.length === 0) {
    return `classes ${className} do not use a role: write inline textStyles.<role> in the className (a role held in a const is not checked)`;
  }
  const unknown = roles.filter((role) => !textRoles.has(role));
  if (unknown.length > 0) return `unknown textStyles role ${unknown.join(", ")}`;
  const typography = extraClasses(className).filter((name) => unprefixedTypography.test(name));
  return typography.length === 0
    ? null
    : `typography ${typography.join(", ")} next to a role (put it in the role, or prefix it: sm:, md:, hover:)`;
}

// Extras next to a role may add layout, focus and visibility, and responsive or state-prefixed sizes (`md:text-4xl` on the hero,
// `sm:text-3xl` on the order page). An unprefixed size, weight, family, colour or line height would override the role.
const unprefixedTypography =
  /^(?:text-(?:xs|sm|base|lg|\d?xl|foreground|muted-foreground|primary(?:-foreground)?|accent(?:-foreground)?|danger(?:-foreground)?|success|warning)|font-(?:sans|mono|display|thin|light|normal|medium|semibold|bold|extrabold|black)|leading-\S+|tracking-\S+)$/;

/** The class names written in string and template literals of a className expression (interpolations and roles left out). */
function extraClasses(expression: string): string[] {
  const withoutInterpolations = expression.replace(/\$\{[^}]*\}/g, " ");
  return [...withoutInterpolations.matchAll(/(["'`])([^"'`]*)\1/g)].flatMap((match) =>
    (match[2] as string).split(/\s+/).filter((name) => name !== ""),
  );
}

function roleOffenders(tags: RegExp): string[] {
  return headingRoots
    .flatMap(files)
    .filter((file) => /\.tsx$/.test(file) && !/\.spec\.tsx$/.test(file))
    .flatMap((file) =>
      tagClasses(readFileSync(file, "utf8"), tags).flatMap((tag) => {
        const problem = roleProblem(tag);
        return problem === null ? [] : [`${file.replace(repoRoot, "")}: <${tag.tag}> ${problem}`];
      }),
    );
}

describe("design guard, heading roles", () => {
  it("knows the text roles of @fluxkit/ui", () => {
    for (const role of ["pageTitle", "sectionTitle", "subsectionTitle", "meta"]) {
      expect(textRoles.has(role), role).toBe(true);
    }
  });

  it("reads the className of opening tags (the scanner itself)", () => {
    const source = `<h2 id={x} className="text-lg font-semibold">a</h2><h1 className={cn(textStyles.pageTitle, a > b ? "x" : "y")}>b</h1><h3>c</h3><legend className={legend} />`;
    expect(tagClasses(source, /h[1-6]|legend/)).toEqual([
      { tag: "h2", className: '"text-lg font-semibold"' },
      { tag: "h1", className: '{cn(textStyles.pageTitle, a > b ? "x" : "y")}' },
      { tag: "h3", className: null },
      { tag: "legend", className: "{legend}" },
    ]);
    expect(tagClasses(`<header className="x"><Headings className="y">`, /h[1-6]|Heading/)).toEqual(
      [],
    );
  });

  it("accepts roles and visibility classes, and rejects anything else", () => {
    const check = (className: string | null) => roleProblem({ tag: "h2", className });
    expect(check(null)).toBeNull();
    expect(check('"sr-only"')).toBeNull();
    expect(check('"lg:hidden"')).toBeNull();
    expect(check("{textStyles.sectionTitle}")).toBeNull();
    expect(check("{`${textStyles.pageTitle} ${focusRing}`}")).toBeNull();
    expect(check('{titleKey === undefined ? "sr-only" : textStyles.sectionTitle}')).toBeNull();
    expect(check('"text-lg font-semibold text-foreground"')).toMatch(/literal classes/);
    expect(check('"sr-only font-bold"')).toMatch(/literal classes/);
    expect(check("{legend}")).toMatch(/inline textStyles\.<role>/);
    // A role plus unprefixed typography would override the role (review m1 of PR 242); layout, focus and prefixed sizes pass.
    expect(
      check('{cn(textStyles.pageTitle, headingLevel === "h1" ? "md:text-4xl" : null)}'),
    ).toBeNull();
    expect(check("{`${textStyles.pageTitleCompact} sm:text-3xl`}")).toBeNull();
    expect(check("{`${textStyles.sectionTitle} mb-2 max-lg:hidden line-clamp-2`}")).toBeNull();
    expect(check("{`${textStyles.pageTitle} text-3xl font-bold`}")).toMatch(
      /typography text-3xl, font-bold next to a role/,
    );
    expect(check('{cn(textStyles.meta, "px-3 font-semibold")}')).toMatch(
      /typography font-semibold next to a role/,
    );
    expect(check("{`${textStyles.itemTitle} text-foreground leading-tight`}")).toMatch(
      /typography text-foreground, leading-tight/,
    );
    expect(check("{textStyles.bannerTitle}")).toMatch(/unknown textStyles role bannerTitle/);
  });

  it("builds every JSX heading (h1 to h6) of ui and the storefront from a textStyles role", () => {
    expect(roleOffenders(/h[1-6]/)).toEqual([]);
  });

  it("builds every dynamic <Heading> and every <legend> of ui and the storefront from a textStyles role", () => {
    expect(roleOffenders(/Heading|legend/)).toEqual([]);
  });
});
