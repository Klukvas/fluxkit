import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { emailTheme } from "./email-theme.js";
import { emailTheme as exported } from "./index.js";

// The guard of ADR 0031 decision 14: `emailTheme` holds the resolved LIGHT values of tokens.css, so a rebrand of the
// tokens cannot leave mail in the old colors.
const tokensCss = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");
const [lightBlock] = tokensCss.split('[data-theme="dark"]') as [string, string];

function lightTokens(): Map<string, string> {
  return new Map(
    [...lightBlock.matchAll(/(--fk-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [
      match[1] as string,
      (match[2] as string).trim(),
    ]),
  );
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

// Tokens mail does not use, each with its reason; every other light token must be in `emailTheme`.
const notInMail: Record<string, string> = {
  "--fk-color-border-input": "mail has no form controls",
  "--fk-color-ring": "mail has no keyboard focus to show",
  "--fk-shadow-card": "box-shadow is not supported by common mail clients",
};

describe("emailTheme", () => {
  const tokens = lightTokens();

  it("is exported from the package entry point", () => {
    expect(exported).toBe(emailTheme);
  });

  it("uses the light value of the token of the same name for every color", () => {
    for (const [name, value] of Object.entries(emailTheme.color)) {
      const token = `--fk-color-${kebab(name)}`;
      expect(tokens.get(token), `${token} is not defined in tokens.css`).toBeDefined();
      expect(value, token).toBe(tokens.get(token));
    }
  });

  it("uses the token font stacks", () => {
    expect(emailTheme.font.sans).toBe(tokens.get("--fk-font-sans"));
    expect(emailTheme.font.mono).toBe(tokens.get("--fk-font-mono"));
  });

  it("uses the token radii, resolved from rem to px (16px per rem)", () => {
    for (const [name, value] of Object.entries(emailTheme.radius)) {
      const token = tokens.get(`--fk-radius-${name}`);
      const rem = /^([0-9.]+)rem$/.exec(token ?? "");
      expect(rem, `--fk-radius-${name} must be in rem`).not.toBeNull();
      expect(value).toBe(`${String(Number(rem?.[1]) * 16)}px`);
    }
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
