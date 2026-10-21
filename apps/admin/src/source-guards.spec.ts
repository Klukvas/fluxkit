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

/**
 * The string literals that end up as rendered text when `expression` is rendered: the expression itself, the branches
 * of a conditional, the right side of `&&` (both sides of `||` and `??`), array items, and template literals (their text
 * parts). Never a condition, a call argument (`t("key")`), a property key or a comparison operand.
 */
function renderedLiterals(expression: ts.Expression): (ts.StringLiteral | ts.TemplateLiteral)[] {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return [expression];
  }
  if (ts.isTemplateExpression(expression)) return [expression];
  if (ts.isParenthesizedExpression(expression)) return renderedLiterals(expression.expression);
  if (ts.isConditionalExpression(expression)) {
    return [...renderedLiterals(expression.whenTrue), ...renderedLiterals(expression.whenFalse)];
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken)
      return renderedLiterals(expression.right);
    if (
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return [...renderedLiterals(expression.left), ...renderedLiterals(expression.right)];
    }
    return [];
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap((element) =>
      ts.isExpression(element) && !ts.isSpreadElement(element) ? renderedLiterals(element) : [],
    );
  }
  return [];
}

/** The literal text of a rendered literal (the text parts of a template literal). */
function literalText(literal: ts.StringLiteral | ts.TemplateLiteral): string {
  if (ts.isStringLiteral(literal) || ts.isNoSubstitutionTemplateLiteral(literal))
    return literal.text;
  return [literal.head.text, ...literal.templateSpans.map((span) => span.literal.text)].join("");
}

/**
 * JSX text, text attributes and literals rendered from JSX expressions (children and text attributes: `{"x"}`,
 * `{busy ? "Saving" : t("save")}`, `{failed && "Failed"}`, `` {`${n} items`} ``) with letters in a .tsx file: each one
 * is user-facing text that bypasses i18n. Expressions of other attributes (`className`, `id`, `href`, ...) are not text.
 */
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
  const report = (expression: ts.Expression) => {
    for (const literal of renderedLiterals(expression)) {
      const value = literalText(literal);
      if (letters.test(value)) found.push(`{${literal.getText(file)}}`);
    }
  };
  function visit(node: ts.Node): void {
    if (ts.isJsxText(node) && letters.test(node.text)) found.push(node.text.trim());
    if (ts.isJsxAttribute(node) && textAttributes.has(node.name.getText(file))) {
      const value = node.initializer;
      if (value !== undefined && ts.isStringLiteral(value) && letters.test(value.text)) {
        found.push(`${node.name.getText(file)}="${value.text}"`);
      }
      if (value !== undefined && ts.isJsxExpression(value) && value.expression !== undefined) {
        report(value.expression);
      }
    }
    if (
      ts.isJsxExpression(node) &&
      node.parent !== undefined &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      node.expression !== undefined
    ) {
      report(node.expression);
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

  it("the hardcoded-text check finds text in conditionals, && and template literals inside JSX (step 13 review, G02)", () => {
    const sample = [
      "const a = (",
      '  <p aria-label={open ? "Close menu" : t("x")}>',
      '    {signingOut ? "Signing out" : t("shell.signOut")}',
      '    {failed && "Failed"}',
      '    {name ?? "Unknown"}',
      "    {`${count} items`}",
      '    {["One", t("two")]}',
      "  </p>",
      ");",
    ].join("\n");
    expect(hardcodedText("sample.tsx", sample)).toEqual([
      '{"Close menu"}',
      '{"Signing out"}',
      '{"Failed"}',
      '{"Unknown"}',
      "{`${count} items`}",
      '{"One"}',
    ]);
  });

  it("the hardcoded-text check leaves keys, conditions, comparisons and non-text attributes alone", () => {
    const sample = [
      "const a = (",
      '  <p className={busy ? "opacity-50" : "block"} id={`row-${id}`} href={"/products"}>',
      '    {status === "draft" ? t("products.draft") : null}',
      '    {t(busy ? "shell.signingOut" : "shell.signOut", { name: "x" })}',
      "    {`${a} – ${b}`}",
      '    {"§"}',
      "  </p>",
      ");",
    ].join("\n");
    expect(hardcodedText("sample.tsx", sample)).toEqual([]);
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
    // Scaling a decimal by a power of ten (`* 10 ** exponent`, `Math.pow(10, ...)`) is float money math too, even when
    // `Math.round` hides the error for small values; money text goes through `lib/money-input.ts` (BigInt) only.
    const floatMoney =
      /\/\s*100\b|\*\s*100\b|toFixed\(|parseFloat\(|Math\.round\([^)]*amount|\b10\s*\*\*|Math\.pow\(\s*10\b/;
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
