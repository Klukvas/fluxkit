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
// Radii are ROLES (plan 2026-11-08-design-changeability.md, T3): `rounded-control`, `rounded-card`, `rounded-panel`,
// `rounded-overlay`, `rounded-media`, so a rebrand changes one role in tokens.css instead of a size step shared by unrelated parts. The scale classes
// (`rounded-sm|md|lg`) stay mapped for forks (additive contract) but the template's own code uses them only through
// `radiusExceptions` below. `rounded-full` is a shape (a pill or a circle) and `rounded-none` no radius: neither is a brand value.
const typeSteps = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl"];
const radiusRoles = ["control", "card", "panel", "overlay", "media"];
const radiusSteps = [...radiusRoles, "full", "none"];
const shadowSteps = ["card", "raised", "overlay", "none"];

interface RadiusException {
  /** Repository-relative path. */
  file: string;
  /** The scale class kept (`rounded-sm|md|lg`, variants stripped). */
  className: string;
  /** Exact number of uses in the file: one more (a new button with `rounded-md`) fails the guard. */
  count: number;
  reason: string;
}

/**
 * Raw scale radii the template still uses on purpose, each with its count and reason (plan 2026-11-08 T3). Only small marks
 * are left (owner decision 2026-11-09: inline panels got the `panel` role, these stay): moving one to a role would change
 * pixels at the default tokens. Keep the list short; a new entry needs a reason a reviewer can check.
 */
// The small mark step (now 0.375rem) has no role: a native checkbox and the focus ring of a text link are smaller than a control, a count or
// discount badge is a mark inside text, a flag or a 48px thumbnail is smaller than media.
const SMALL_CONTROL =
  "Small radius: smaller than the control role (1.5rem); no role for this step (owner, 2026-11-09)";
const SMALL_MARK =
  "Small radius badge inside text: no role covers marks (owner decision 2026-11-09)";
const SMALL_MEDIA = "Small radius picture (flag, 48px thumbnail): the media role is 1rem";

const radiusExceptions: RadiusException[] = [
  { file: "packages/ui/src/badge.tsx", className: "rounded-sm", count: 1, reason: SMALL_MARK },
  { file: "packages/ui/src/price-text.tsx", className: "rounded-sm", count: 1, reason: SMALL_MARK },
  {
    file: "packages/ui/src/checkbox.tsx",
    className: "rounded-sm",
    count: 1,
    reason: SMALL_CONTROL,
  },
  {
    file: "apps/storefront/src/app/globals.css",
    className: "rounded-sm",
    count: 1,
    reason: SMALL_MEDIA,
  },
  {
    file: "apps/storefront/src/components/cards/grid-card.tsx",
    className: "rounded-sm",
    count: 1,
    reason: SMALL_CONTROL,
  },
  {
    file: "apps/storefront/src/components/cards/list-card.tsx",
    className: "rounded-sm",
    count: 1,
    reason: SMALL_CONTROL,
  },
  {
    file: "apps/admin/src/areas/orders/order-detail-view.tsx",
    className: "rounded-sm",
    count: 1,
    reason: SMALL_MEDIA,
  },
];

/** A class name without its variants: the part after the last colon outside brackets and parentheses. */
function withoutVariants(name: string): string {
  let depth = 0;
  let start = 0;
  for (let index = 0; index < name.length; index += 1) {
    const char = name[index];
    if (char === "[" || char === "(") depth += 1;
    else if (char === "]" || char === ")") depth -= 1;
    else if (char === ":" && depth === 0) start = index + 1;
  }
  return name.slice(start);
}

/** Class names of every quoted string in a source, without their variants (`md:hover:shadow-raised` -> `shadow-raised`). */
function quotedClasses(source: string): string[] {
  return [...source.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].flatMap((match) =>
    (match[2] as string)
      .split(/\s+/)
      .map(withoutVariants)
      .filter((name) => name !== ""),
  );
}

/** Class names of the `@apply` rules of a stylesheet, without their variants (the `.fk-*` classes of globals.css). */
function appliedClasses(source: string): string[] {
  return [...source.matchAll(/@apply\s+([^;]+);/g)].flatMap((match) =>
    (match[1] as string)
      .split(/\s+/)
      .map(withoutVariants)
      .filter((name) => name !== ""),
  );
}

/** The classes of a source that leave the token scales (quoted class lists, and `@apply` rules of a stylesheet). */
function offScaleClasses(source: string): string[] {
  return [...quotedClasses(source), ...appliedClasses(source)].filter((name) => {
    const size = /^text-(xs|sm|base|lg|\d?xl)$/.exec(name);
    if (size) return !typeSteps.includes(size[1] as string);
    // Tailwind v4 also takes `rounded-(--var)`, `rounded-(length:--var)` and the important marker (`rounded-md!`, `!rounded-md`).
    const radius =
      /^!?rounded(?:-(?:[trblse]|[trbl][lr]|s[se]|e[se]))?(?:-([a-z0-9]+|\[[^\]]*\]|\([^)]*\)))?!?$/.exec(
        name,
      );
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
    for (const role of radiusRoles) {
      expect(tailwindCss).toContain(`--radius-${role}: var(--fk-radius-${role});`);
    }
    // The scale steps stay mapped (additive contract): a fork's own `rounded-md` keeps working.
    for (const step of ["sm", "md", "lg"]) {
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
        `"text-sm lg:text-4xl text-foreground rounded-control rounded-t-card rounded-panel md:rounded-overlay rounded-media rounded-full rounded-none hover:shadow-raised shadow-overlay shadow-none"`,
      ),
    ).toEqual([]);
  });

  it("flags the radius size steps (roles only) and arbitrary radii, in class lists and in @apply", () => {
    expect(
      offScaleClasses(
        `"rounded-sm focus:rounded-md lg:rounded-lg rounded-e-md rounded-2xl rounded-3xl rounded-[3px] rounded-(--radius-md) md:rounded-(length:--x) rounded-md! !rounded-lg hover:rounded-t-(--y)!"`,
      ),
    ).toEqual([
      "rounded-sm",
      "rounded-md",
      "rounded-lg",
      "rounded-e-md",
      "rounded-2xl",
      "rounded-3xl",
      "rounded-[3px]",
      "rounded-(--radius-md)",
      "rounded-(length:--x)",
      "rounded-md!",
      "!rounded-lg",
      "rounded-t-(--y)!",
    ]);
    expect(offScaleClasses(`"rounded-panel! md:rounded-card rounded-full!"`)).toEqual([]);
    expect(
      offScaleClasses(
        `.fk-x {\n  @apply flex rounded-md px-2 hover:bg-muted;\n}\n.fk-y {\n  @apply rounded-control rounded-panel text-sm;\n}`,
      ),
    ).toEqual(["rounded-md"]);
  });

  it("finds no size, radius or shadow outside the token scales in components or apps (radius exceptions listed)", () => {
    // Specs are left out: their test names are prose ("is rounded down"), not class lists.
    const styled = sources.filter((file) => !/\.spec\.tsx?$/.test(file));
    expect(styled.length).toBeGreaterThan(5);
    const found = new Map<string, number>();
    for (const file of styled) {
      for (const name of offScaleClasses(readFileSync(file, "utf8"))) {
        const key = `${file.replace(repoRoot, "")}: ${name}`;
        found.set(key, (found.get(key) ?? 0) + 1);
      }
    }
    const allowed = new Map(
      radiusExceptions.map(({ file, className, count }) => [`${file}: ${className}`, count]),
    );
    const offenders = [...found]
      .filter(([key, count]) => allowed.get(key) !== count)
      .map(([key, count]) => `${key} (${String(count)}x)`);
    expect(offenders).toEqual([]);
    // An exception with no use left (or a changed count) is stale: remove or correct it.
    const stale = radiusExceptions
      .filter(({ file, className, count }) => found.get(`${file}: ${className}`) !== count)
      .map(({ file, className }) => `${file}: ${className}`);
    expect(stale).toEqual([]);
  });

  it("keeps every radius exception explained and limited to a scale step", () => {
    for (const { file, className, count, reason } of radiusExceptions) {
      expect(className, file).toMatch(/^rounded-(?:sm|md|lg)$/);
      expect(count, file).toBeGreaterThan(0);
      expect(reason.length, `${file}: ${className} needs a reason`).toBeGreaterThan(20);
    }
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

// Scan class lists and @apply like the scale guards. Raw ms in globals.css belong to the motion workstream, not this PR.
function offTokenMotionClasses(source: string): string[] {
  return [...quotedClasses(source), ...appliedClasses(source)].filter((name) =>
    /^!?(?:(?:duration|delay)-(?:[0-9]+|\[[^\]]*\]|\([^)]*\))|ease-(?:\[[^\]]*\]|\([^)]*\))|ease-(?:in|out|in-out|linear))!?$/.test(
      name,
    ),
  );
}

describe("design guard, token motion classes", () => {
  it("rejects numeric and arbitrary timings and built-in easings, including variants", () => {
    expect(
      offTokenMotionClasses(
        '"duration-150 hover:duration-300 duration-[250ms] ease-[linear] delay-[1s] ease-in ease-out ease-in-out ease-linear"',
      ),
    ).toHaveLength(9);
    // Tailwind v4 custom-property values, numeric delays and important markers are timings outside the tokens too.
    expect(
      offTokenMotionClasses(
        '"duration-(--custom-time) ease-(--custom-ease) delay-(--custom-delay) delay-150 md:hover:!duration-200 ease-out!"',
      ),
    ).toHaveLength(6);
    expect(
      offTokenMotionClasses(
        '"transition duration-fast duration-base duration-slow ease-standard ease-emphasized ease-spring"',
      ),
    ).toEqual([]);
    expect(offTokenMotionClasses(".x { @apply duration-200 ease-out; }")).toEqual([
      "duration-200",
      "ease-out",
    ]);
  });
  it("finds no timings outside tokens in components and apps", () => {
    const offenders = sources
      .filter((file) => !/\.spec\.tsx?$/.test(file))
      .flatMap((file) =>
        offTokenMotionClasses(readFileSync(file, "utf8")).map(
          (name) => `${file.replace(repoRoot, "")}: ${name}`,
        ),
      );
    expect(offenders).toEqual([]);
  });
});
