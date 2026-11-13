import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Blog plan section 8 (ADR 0050): the UI library never sets raw HTML. Markdown reaches the page as an AST rendered with React
// elements (`MarkdownView`), so every text is escaped by React; the storefront's only raw HTML stays its JSON-LD component.
const srcDir = fileURLToPath(new URL("./", import.meta.url));
const self = "raw-html-guard.spec.ts";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx?$/.test(entry) && entry !== self ? [full] : [];
  });
}

const RAW_HTML =
  /dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write|createContextualFragment/;

describe("raw HTML guard of @fluxkit/ui", () => {
  const sources = files(srcDir);

  it("scans the library, MarkdownView included", () => {
    expect(sources.map((file) => file.replace(srcDir, ""))).toContain("markdown-view.tsx");
  });

  it("never sets raw HTML in any source or spec", () => {
    const offenders = sources.filter((file) => RAW_HTML.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => file.replace(srcDir, ""))).toEqual([]);
  });

  it("flags a sample that does", () => {
    expect(RAW_HTML.test("<div dangerouslySetInnerHTML={{ __html: body }} />")).toBe(true);
    expect(RAW_HTML.test("node.innerHTML = body")).toBe(true);
  });
});
