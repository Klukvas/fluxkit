import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });
}

const root = import.meta.dirname;
// Test helpers are imported by specs only; they hold sentinel strings, not UI.
const sources = sourceFiles(root)
  .filter((path) => !/(^|\/)test-helpers\.ts$/.test(path))
  .map((path) => ({ path: relative(root, path), text: readFileSync(path, "utf8") }));

/** The source without comments, so a rule is not satisfied (or broken) by prose. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, "$1");

/** JSX text and text attributes with letters in a .tsx file: each one is user-facing text that bypasses i18n. */
function hardcodedText(path: string, text: string): string[] {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const textAttributes = new Set([
    "aria-label",
    "title",
    "placeholder",
    "alt",
    "aria-description",
    "label",
  ]);
  const letters = /\p{L}/u;
  function visit(node: ts.Node): void {
    if (ts.isJsxText(node) && letters.test(node.text)) found.push(node.text.trim());
    if (
      ts.isJsxAttribute(node) &&
      textAttributes.has(node.name.getText(file)) &&
      node.initializer !== undefined &&
      ts.isStringLiteral(node.initializer) &&
      letters.test(node.initializer.text)
    ) {
      found.push(`${node.name.getText(file)}="${node.initializer.text}"`);
    }
    if (
      ts.isJsxExpression(node) &&
      node.parent !== undefined &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      node.expression !== undefined &&
      (ts.isStringLiteral(node.expression) ||
        ts.isNoSubstitutionTemplateLiteral(node.expression)) &&
      letters.test(node.expression.text)
    ) {
      found.push(`{"${node.expression.text}"}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

describe("source guards (AGENTS.md sections 2.2, 2.3 and 11; plan, Security (admin side))", () => {
  it("finds the sources it guards", () => {
    expect(sources.length).toBeGreaterThan(30);
    expect(sources.filter((file) => file.path.endsWith(".tsx")).length).toBeGreaterThan(15);
  });

  it("has no hardcoded user-facing text in components (all of it goes through the translator)", () => {
    const offenders = sources
      .filter((file) => file.path.endsWith(".tsx"))
      .flatMap((file) =>
        hardcodedText(file.path, file.text).map((text) => `${file.path}: ${text}`),
      );
    expect(offenders).toEqual([]);
  });

  it("the hardcoded-text check itself finds text, text attributes and string children", () => {
    const sample = `const a = <p title="Hello">Save <b>{"now"}</b>{t("x")}{"§"}</p>;`;
    expect(hardcodedText("sample.tsx", sample)).toEqual(['title="Hello"', "Save", '{"now"}']);
  });

  it("never sets raw HTML (dangerouslySetInnerHTML)", () => {
    for (const file of sources) {
      expect(file.text, file.path).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML\s*=|outerHTML\s*=/,
      );
    }
  });

  it('gives every <form> method="post" and no action, so a submit before the script runs never puts values in a URL', () => {
    const forms = sources.flatMap((file) =>
      [...file.text.matchAll(/<form\b(?:[^>]|=>)*>/g)].map((match) => ({
        path: file.path,
        tag: match[0],
      })),
    );
    expect(forms.length).toBeGreaterThanOrEqual(2);
    for (const form of forms) {
      expect(form.tag, `${form.path}: a form without method="post"`).toMatch(/\bmethod="post"/);
      expect(form.tag, `${form.path}: a form must not name an action`).not.toMatch(/\baction=/);
    }
  });

  it("keeps only the UI language in browser storage, read in one place; no cookie, sessionStorage or IndexedDB", () => {
    const storage = sources.filter((file) => /\blocalStorage\b/.test(code(file.text)));
    expect(storage.map((file) => file.path)).toEqual([join("i18n", "i18n-context.tsx")]);
    expect(code(storage[0]?.text ?? "")).toMatch(
      /browserStorage = \(\): StorageLike => window\.localStorage;/,
    );
    for (const file of sources) {
      expect(code(file.text), file.path).not.toMatch(
        /\b(sessionStorage|indexedDB)\b|document\.cookie/,
      );
    }
  });

  it("calls fetch only through the one admin client", () => {
    const callers = sources.filter((file) => /\bfetch\(/.test(code(file.text)));
    expect(callers.map((file) => file.path)).toEqual([join("lib", "api.ts")]);
    for (const file of sources) {
      expect(code(file.text), file.path).not.toMatch(
        /\bXMLHttpRequest\b|\bEventSource\b|\bWebSocket\b/,
      );
    }
  });

  it("writes document.title and <html lang> in one place each", () => {
    const titles = sources.filter((file) => /document\.title\s*=/.test(code(file.text)));
    expect(titles.map((file) => file.path)).toEqual([join("i18n", "use-document-title.ts")]);
    const langs = sources.filter((file) => /documentElement\.lang\s*=/.test(code(file.text)));
    expect(langs.map((file) => file.path)).toEqual([join("i18n", "i18n-context.tsx")]);
  });

  it("navigates only through safe builders and the session model", () => {
    for (const file of sources) {
      expect(code(file.text), file.path).not.toMatch(
        /window\.location\s*(=|\.(href|assign|replace))/,
      );
    }
    const redirects = sources.flatMap((file) =>
      [...code(file.text).matchAll(/<Navigate to=\{([^}]*)\}/g)].map((match) => ({
        path: file.path,
        to: match[1] as string,
        text: code(file.text),
      })),
    );
    expect(redirects.length).toBe(2);
    for (const redirect of redirects) {
      if (redirect.to === "target") {
        expect(redirect.text, redirect.path).toMatch(/const target = safeNextPath\(/);
      } else {
        expect(redirect.to, redirect.path).toMatch(/^loginPath\(/);
      }
    }
    const navigateCalls = sources.flatMap((file) =>
      [...code(file.text).matchAll(/\bnavigate\(([^,)]*)/g)].map(
        (match) => `${file.path}: ${match[1]}`,
      ),
    );
    expect(navigateCalls).toEqual([`${join("session", "session-context.tsx")}: redirectTo`]);
  });

  it("does not import core or the server configuration into the browser bundle", () => {
    for (const file of sources) {
      expect(file.text, file.path).not.toMatch(/from ["']@fluxkit\/(core|config)["']/);
    }
  });

  it("does no floating point money math", () => {
    const floatMoney = /\/\s*100\b|\*\s*100\b|toFixed\(|parseFloat\(|Math\.round\([^)]*amount/;
    for (const file of sources) {
      expect(floatMoney.test(code(file.text)), `${file.path} looks like float money math`).toBe(
        false,
      );
    }
  });

  it("never names a niche-specific option or attribute (they are data)", () => {
    const niche = /["'`](size|sizes|color|colour|colors|material|weight|flavor|pack)["'`]/i;
    for (const file of sources) expect(niche.test(file.text), file.path).toBe(false);
  });

  it("never logs a password, a form value or a request body", () => {
    for (const file of sources) {
      for (const call of code(file.text).matchAll(/console\.\w+\([^;]*\)/gs)) {
        expect(call[0], `${file.path} logs ${call[0]}`).not.toMatch(/password|values|body|email/i);
      }
    }
  });
});
