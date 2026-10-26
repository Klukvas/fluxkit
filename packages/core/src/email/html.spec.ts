import { describe, expect, it } from "vitest";
import { escapeHtml, html, isSafeHtml, SafeHtml, unsafeRawHtml } from "./html.js";

describe("escapeHtml", () => {
  it.each([
    ["&", "&amp;"],
    ["<", "&lt;"],
    [">", "&gt;"],
    ['"', "&quot;"],
    ["'", "&#39;"],
  ])("escapes %s as %s", (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
    expect(escapeHtml(`a${input}b${input}`)).toBe(`a${expected}b${expected}`);
  });

  it("escapes the ampersand first, so an entity in the input stays visible text", () => {
    expect(escapeHtml("&lt;script&gt;")).toBe("&amp;lt;script&amp;gt;");
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  it.each([
    ['<script>alert("x")</script>', "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"],
    ['"><img src=x onerror=alert(1)>', "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"],
    ["' onmouseover='alert(1)", "&#39; onmouseover=&#39;alert(1)"],
    ["javascript:alert(1)", "javascript:alert(1)"],
    ["<!-- x -->", "&lt;!-- x --&gt;"],
    ["</td></tr></table>", "&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;"],
  ])("neutralizes the hostile value %s", (input, expected) => {
    const escaped = escapeHtml(input);
    expect(escaped).toBe(expected);
    expect(escaped).not.toMatch(/[<>"']/);
  });

  it("leaves every other character alone (any script, emoji, newlines)", () => {
    const text = "Замовлення №12 — ціна 1 200,00 ₴ 🎉\nline two\tand `backtick` = / \\";
    expect(escapeHtml(text)).toBe(text);
    expect(escapeHtml("")).toBe("");
  });

  it("escapes a huge input quickly", () => {
    const huge = "<&>\"'".repeat(200_000);
    const started = Date.now();
    const escaped = escapeHtml(huge);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(escaped.length).toBe(200_000 * "&lt;&amp;&gt;&quot;&#39;".length);
  });

  it("throws for a non-string instead of printing `undefined` or `[object Object]`", () => {
    for (const value of [undefined, null, 1, {}, ["<"]]) {
      expect(() => escapeHtml(value as unknown as string)).toThrow(TypeError);
    }
  });
});

// Prettier formats a literal tagged `html` as embedded HTML (whitespace and `<br>` change), which would rewrite the
// exact expectations below; the alias keeps them byte for byte. Templates may use `html` itself.
const tag = html;

describe("html tagged template", () => {
  it("escapes every interpolated string by default", () => {
    const name = '<b onclick="x">Ann & Bob\'s</b>';
    expect(String(tag`<p>Hello, ${name}!</p>`)).toBe(
      "<p>Hello, &lt;b onclick=&quot;x&quot;&gt;Ann &amp; Bob&#39;s&lt;/b&gt;!</p>",
    );
  });

  it("escapes inside attribute values too (quotes cannot break out)", () => {
    const title = '" onmouseover="alert(1)';
    expect(String(tag`<td title="${title}">x</td>`)).toBe(
      '<td title="&quot; onmouseover=&quot;alert(1)">x</td>',
    );
  });

  it("keeps the template's own markup", () => {
    expect(String(tag`<table role="presentation"><tr><td>1</td></tr></table>`)).toBe(
      '<table role="presentation"><tr><td>1</td></tr></table>',
    );
  });

  it("nests: a fragment built with html is inserted as markup, not escaped twice", () => {
    const row = tag`<tr><td>${"<x>"}</td></tr>`;
    expect(String(tag`<table>${row}</table>`)).toBe("<table><tr><td>&lt;x&gt;</td></tr></table>");
  });

  it("joins arrays of values and fragments, escaping each string", () => {
    const lines = ["a<b", "c&d"].map((title) => tag`<li>${title}</li>`);
    expect(String(tag`<ul>${lines}</ul>`)).toBe("<ul><li>a&lt;b</li><li>c&amp;d</li></ul>");
    expect(String(tag`<p>${["<", 1, tag`<br>`]}</p>`)).toBe("<p>&lt;1<br></p>");
    expect(String(tag`<ul>${[]}</ul>`)).toBe("<ul></ul>");
  });

  it("prints finite numbers", () => {
    expect(String(tag`<td>${3}</td><td>${-0.5}</td>`)).toBe("<td>3</td><td>-0.5</td>");
  });

  it("inserts markup only through the explicit unsafeRawHtml marker", () => {
    expect(String(tag`<div>${unsafeRawHtml("<hr>")}</div>`)).toBe("<div><hr></div>");
  });

  it("does not accept a look-alike object as markup (the marker cannot be forged)", () => {
    const forged = { toString: () => "<script>alert(1)</script>" };
    expect(() => tag`<p>${forged}</p>`).toThrow(TypeError);
    const copied = { ...unsafeRawHtml("<hr>") };
    expect(() => tag`<p>${copied}</p>`).toThrow(TypeError);
    expect(isSafeHtml(forged)).toBe(false);
    expect(isSafeHtml(copied)).toBe(false);
    expect(isSafeHtml(tag`<p></p>`)).toBe(true);
    expect(isSafeHtml("<p></p>")).toBe(false);
    expect(() => new SafeHtml(Symbol("SafeHtml"), "<script>")).toThrow(TypeError);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a boolean", true],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a plain object", { a: 1 }],
    ["a function", () => "x"],
    ["a Date", new Date(0)],
    ["an array holding undefined", ["a", undefined]],
  ])("throws for %s (a template bug, never silently printed)", (_label, value) => {
    expect(() => tag`<p>${value}</p>`).toThrow(TypeError);
  });

  it("unsafeRawHtml takes a string only", () => {
    expect(() => unsafeRawHtml(undefined as unknown as string)).toThrow(TypeError);
  });
});
