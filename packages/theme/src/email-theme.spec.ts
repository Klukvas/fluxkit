import { describe, expect, it } from "vitest";
import { emailTheme } from "./email-theme.js";
import { emailTheme as exported } from "./index.js";
import { literalCopyFile, storefrontTokens } from "./theme-run.testing.js";

// The guard of ADR 0031 decision 14: `emailTheme` holds the resolved LIGHT values of the storefront's EFFECTIVE tokens
// (`tokens.css` plus the fork-owned `brand-overrides.css`), so a rebrand cannot leave mail in the old colors. Mail clients
// cannot read CSS, so the values are literals in `email-theme.ts`; each failure names the values to write there.
const literalFile = literalCopyFile("email-theme.ts");

function lightTokens(): Map<string, string> {
  return storefrontTokens.light;
}

/**
 * A token's font stack as mail can use it: a fork's own face is a `var(--font-...)` of `next/font/local`
 * (`apps/storefront/src/config/fonts.ts`), which only exists on the web page; mail keeps the fallback stack after it.
 */
function mailFontStack(stack: string): string {
  return stack
    .replace(
      /var\(--font-[a-z0-9-]+(?:,\s*([^()]*))?\)/gi,
      (_, fallback: string | undefined) => fallback?.trim() ?? "",
    )
    .split(",")
    .map((family) => family.trim())
    .filter((family) => family !== "")
    .join(", ");
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

// Tokens mail does not use, each with its reason; every other light token must be in `emailTheme`.
const notInMail: Record<string, string> = {
  ...Object.fromEntries(
    [
      ...["fast", "base", "slow"].map((step) => `--fk-motion-duration-${step}`),
      ...["standard", "emphasized", "spring"].map((step) => `--fk-motion-ease-${step}`),
    ].map((name) => [name, "mail has no transitions or animations"]),
  ),
  "--fk-color-border-input": "mail has no form controls",
  "--fk-color-ring": "mail has no keyboard focus to show",
  "--fk-color-danger-foreground": "mail has no count badge or other text on a danger fill",
  "--fk-color-accent":
    "mail has no banner card and no other accent surface (adding it to mail would change the `EmailTheme` contract)",
  "--fk-color-accent-foreground": "mail has no text on an accent fill",
  "--fk-shadow-card": "box-shadow is not supported by common mail clients",
  "--fk-shadow-raised": "box-shadow is not supported by common mail clients",
  "--fk-shadow-overlay": "box-shadow is not supported by common mail clients",
  "--fk-space-unit": "mail has its own px spacing (`emailTheme.space`)",
  ...Object.fromEntries(
    ["control", "card", "panel", "overlay", "media"].map((role) => [
      `--fk-radius-${role}`,
      "mail keeps the scale radii of `emailTheme.radius` (known limit: adding roles would change the `EmailTheme` contract)",
    ]),
  ),
  "--fk-font-display":
    "mail headings use `emailTheme.font.sans`: a fork's display face is a self-hosted web font that mail clients would not load (the `EmailTheme` contract stays unchanged)",
  ...Object.fromEntries(
    ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl"].flatMap((step) => [
      [`--fk-font-size-${step}`, "mail has its own px font sizes (`emailTheme.fontSize`)"],
      [`--fk-line-height-${step}`, "mail has its own line height (`emailTheme.lineHeight`)"],
    ]),
  ),
};

describe("emailTheme", () => {
  const tokens = lightTokens();

  it("is exported from the package entry point", () => {
    expect(exported).toBe(emailTheme);
  });

  it("uses the effective light value of the token of the same name for every color", () => {
    const expected = Object.fromEntries(
      Object.keys(emailTheme.color).map((name) => [name, tokens.get(`--fk-color-${kebab(name)}`)]),
    );
    for (const [name, value] of Object.entries(expected)) {
      expect(value, `--fk-color-${kebab(name)} is not defined in tokens.css`).toBeDefined();
    }
    expect(
      { ...emailTheme.color },
      `update the literals in ${literalFile}: color: ${JSON.stringify(expected)}`,
    ).toEqual(expected);
  });

  it("uses the token font stacks (without a self-hosted web font, which mail clients do not load)", () => {
    const expected = {
      sans: mailFontStack(tokens.get("--fk-font-sans") ?? ""),
      mono: mailFontStack(tokens.get("--fk-font-mono") ?? ""),
    };
    expect(
      { ...emailTheme.font },
      `update the literals in ${literalFile}: font: ${JSON.stringify(expected)}`,
    ).toEqual(expected);
  });

  it("drops the web font variables of `config/fonts.ts` from a stack, and keeps the fallbacks", () => {
    expect(mailFontStack("var(--font-body), ui-sans-serif, system-ui, sans-serif")).toBe(
      "ui-sans-serif, system-ui, sans-serif",
    );
    expect(mailFontStack("ui-monospace, monospace")).toBe("ui-monospace, monospace");
    expect(mailFontStack("var(--font-body)")).toBe("");
    expect(mailFontStack("var(--font-template-sans, ui-sans-serif), system-ui, sans-serif")).toBe(
      "ui-sans-serif, system-ui, sans-serif",
    );
    expect(mailFontStack("var(--font-body, )")).toBe("");
  });

  it("uses the effective token radii, resolved from rem to px (16px per rem)", () => {
    const expected = Object.fromEntries(
      Object.keys(emailTheme.radius).map((name) => {
        const token = tokens.get(`--fk-radius-${name}`);
        const rem = /^([0-9.]+)rem$/.exec(token ?? "");
        expect(rem, `--fk-radius-${name} must be in rem`).not.toBeNull();
        return [name, `${String(Number(rem?.[1]) * 16)}px`];
      }),
    );
    expect(
      { ...emailTheme.radius },
      `update the literals in ${literalFile}: radius: ${JSON.stringify(expected)}`,
    ).toEqual(expected);
  });

  it("covers every light token except the ones mail does not use (each with a reason)", () => {
    const covered = new Set([
      ...Object.keys(emailTheme.color).map((name) => `--fk-color-${kebab(name)}`),
      ...Object.keys(emailTheme.font).map((name) => `--fk-font-${name}`),
      ...Object.keys(emailTheme.radius).map((name) => `--fk-radius-${name}`),
    ]);
    const missing = [...tokens.keys()].filter((name) => !covered.has(name) && !(name in notInMail));
    expect(missing, "add these tokens to emailTheme or to notInMail with a reason").toEqual([]);
    for (const name of Object.keys(notInMail)) {
      expect(tokens.has(name), `${name} in notInMail is not a token any more`).toBe(true);
    }
  });

  it("holds only values mail clients understand: 6-digit hex colors, px sizes, no CSS variables", () => {
    for (const value of Object.values(emailTheme.color)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
    for (const group of [emailTheme.radius, emailTheme.space, emailTheme.fontSize]) {
      for (const value of Object.values(group)) {
        expect(value).toMatch(/^[0-9]+px$/);
      }
    }
    expect(emailTheme.lineHeight).toMatch(/^[0-9]+(\.[0-9]+)?$/);
    expect(Number.isSafeInteger(emailTheme.contentWidth)).toBe(true);
    expect(emailTheme.contentWidth).toBeGreaterThanOrEqual(320);
    expect(emailTheme.contentWidth).toBeLessThanOrEqual(640);
    // Nothing that could leave an inline `style="..."` attribute or load anything.
    const leaves = Object.values(emailTheme).flatMap((group) =>
      typeof group === "object" ? Object.values(group) : [group],
    );
    for (const value of leaves) {
      expect(String(value)).not.toMatch(/var\(|url\(|expression\(|[;<>"\\]/);
    }
  });

  it("is deeply frozen (a template cannot change the theme for the next mail)", () => {
    expect(Object.isFrozen(emailTheme)).toBe(true);
    for (const group of Object.values(emailTheme)) {
      if (typeof group === "object") {
        expect(Object.isFrozen(group)).toBe(true);
      }
    }
  });
});
