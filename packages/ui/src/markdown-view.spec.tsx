import { describe, expect, it } from "vitest";
import { MarkdownView, type MarkdownViewLinkProps } from "./markdown-view";
import type {
  MarkdownViewBlock,
  MarkdownViewDocument,
  MarkdownViewInline,
} from "./markdown-view-types";
import { textStyles } from "./styles";
import { first, render, tags, text } from "./test-helpers";

const t = (value: string): MarkdownViewInline => ({ type: "text", value });
const p = (...children: MarkdownViewInline[]): MarkdownViewBlock => ({
  type: "paragraph",
  children,
});
const doc = (...children: MarkdownViewBlock[]): MarkdownViewDocument => ({
  type: "document",
  children,
});
const link = (kind: "path" | "https", href: string, label = "go"): MarkdownViewInline => ({
  type: "link",
  kind,
  href,
  children: [t(label)],
});

function view(document: MarkdownViewDocument, localePrefix = "/uk"): string {
  return render(<MarkdownView document={document} localePrefix={localePrefix} />);
}

describe("MarkdownView, blocks and inline nodes", () => {
  it("renders every node as its semantic element", () => {
    const markup = view(
      doc(
        { type: "heading", level: 2, children: [t("Two")] },
        { type: "heading", level: 3, children: [t("Three")] },
        { type: "heading", level: 4, children: [t("Four")] },
        p(
          t("a "),
          { type: "emphasis", children: [t("em")] },
          { type: "strong", children: [t("strong")] },
          { type: "inlineCode", value: "x()" },
          { type: "break" },
          t("b"),
        ),
        { type: "codeBlock", value: "line 1\n  line 2" },
        { type: "blockquote", children: [p(t("quoted"))] },
        {
          type: "list",
          ordered: false,
          start: 1,
          items: [
            { type: "listItem", children: [p(t("one"))] },
            {
              type: "listItem",
              children: [
                p(t("two")),
                {
                  type: "list",
                  ordered: true,
                  start: 1,
                  items: [{ type: "listItem", children: [p(t("inner"))] }],
                },
              ],
            },
          ],
        },
        { type: "list", ordered: true, start: 3, items: [{ type: "listItem", children: [] }] },
        { type: "thematicBreak" },
      ),
    );
    expect(tags(markup, "h1")).toHaveLength(0);
    expect(first(markup, "h2").attributes["class"]).toBe(textStyles.sectionTitle);
    expect(first(markup, "h3").attributes["class"]).toBe(textStyles.subsectionTitle);
    expect(first(markup, "h4").attributes["class"]).toBe(textStyles.itemTitle);
    expect(markup).toContain("<em>em</em>");
    expect(markup).toContain("<strong>strong</strong>");
    expect(markup).toMatch(/<code[^>]*>x\(\)<\/code>/);
    expect(markup).toContain("<br/>");
    expect(markup).toMatch(/<pre[^>]*><code>line 1\n {2}line 2<\/code><\/pre>/);
    expect(tags(markup, "blockquote")).toHaveLength(1);
    expect(tags(markup, "ul")).toHaveLength(1);
    expect(tags(markup, "ol")).toHaveLength(2);
    expect(tags(markup, "li")).toHaveLength(4);
    expect(tags(markup, "ol")[0]?.attributes["start"]).toBeUndefined();
    expect(tags(markup, "ol")[1]?.attributes["start"]).toBe("3");
    expect(tags(markup, "hr")).toHaveLength(1);
    expect(text(markup)).toBe(
      "Two Three Four a em strong x() b line 1 line 2 quoted one two inner",
    );
  });

  it("lets a scrollable code block be reached with the keyboard", () => {
    const pre = first(view(doc({ type: "codeBlock", value: "x" })), "pre");
    expect(pre.attributes["tabindex"]).toBe("0");
  });

  it("renders nothing for an empty document, and wraps blocks in one container with the given classes", () => {
    const markup = render(<MarkdownView document={doc()} localePrefix="/uk" className="extra" />);
    expect(tags(markup, "div")).toHaveLength(1);
    expect(first(markup, "div").attributes["class"]).toContain("extra");
    expect(text(markup)).toBe("");
  });

  it("escapes text: markup in a text, code or code block value is never an element", () => {
    const hostile = '<script>alert(1)</script><img src=x onerror="alert(1)">';
    const markup = view(
      doc(p(t(hostile), { type: "inlineCode", value: hostile }), {
        type: "codeBlock",
        value: hostile,
      }),
    );
    expect(tags(markup, "script")).toHaveLength(0);
    expect(tags(markup, "img")).toHaveLength(0);
    expect(markup).toContain("&lt;script&gt;");
  });

  it("ignores a node type it does not know (a newer API) instead of failing", () => {
    const unknown = { type: "table", rows: [] } as unknown as MarkdownViewBlock;
    const unknownInline = { type: "image", src: "/x.png" } as unknown as MarkdownViewInline;
    const markup = view(doc(unknown, p(t("a"), unknownInline)));
    expect(text(markup)).toBe("a");
    expect(tags(markup, "img")).toHaveLength(0);
  });
});

describe("MarkdownView, links", () => {
  it("adds the locale to a storefront path and renders it without rel", () => {
    const markup = view(doc(p(link("path", "/catalog?sort=price#top"))));
    const anchor = first(markup, "a");
    expect(anchor.attributes["href"]).toBe("/uk/catalog?sort=price#top");
    expect(anchor.attributes["rel"]).toBeUndefined();
    expect(anchor.attributes["target"]).toBeUndefined();
  });

  it("links the root path to the locale's home", () => {
    expect(first(view(doc(p(link("path", "/")))), "a").attributes["href"]).toBe("/uk");
    expect(first(view(doc(p(link("path", "/"))), ""), "a").attributes["href"]).toBe("/");
  });

  it("renders an https address as it is, with rel=noopener noreferrer", () => {
    const anchor = first(view(doc(p(link("https", "https://example.com/a?b=1")))), "a");
    expect(anchor.attributes["href"]).toBe("https://example.com/a?b=1");
    expect(anchor.attributes["rel"]).toBe("noopener noreferrer");
  });

  it("hands storefront paths to renderPathLink and never https addresses", () => {
    const seen: string[] = [];
    const renderPathLink = ({ href, className, children }: MarkdownViewLinkProps) => {
      seen.push(href);
      return (
        <a data-router="yes" href={href} className={className}>
          {children}
        </a>
      );
    };
    const markup = render(
      <MarkdownView
        document={doc(p(link("path", "/a"), link("https", "https://example.com")))}
        localePrefix="/en"
        renderPathLink={renderPathLink}
      />,
    );
    expect(seen).toEqual(["/en/a"]);
    expect(tags(markup, "a").map((anchor) => anchor.attributes["data-router"] ?? "plain")).toEqual([
      "yes",
      "plain",
    ]);
  });

  /** A document that did not come from the parser (a bug, a tampered cache): the renderer checks every link again. */
  const UNSAFE: readonly [string, "path" | "https", string][] = [
    ["javascript as https", "https", "javascript:alert(1)"],
    ["javascript as a path", "path", "javascript:alert(1)"],
    ["data address", "https", "data:text/html,x"],
    ["http address", "https", "http://example.com"],
    ["upper-case scheme", "https", "HTTPS://example.com"],
    ["protocol-relative path", "path", "//evil.test/x"],
    ["backslash path", "path", "/\\evil.test"],
    ["https address marked as a path", "path", "https://example.com"],
    ["path marked as https", "https", "/catalog"],
    ["https without a host", "https", "https:///x"],
    ["https with credentials", "https", "https://user@example.com"],
    ["space in a path", "path", "/a b"],
    ["raw line break", "path", "/a\nb"],
    ["raw tab", "path", "/a\tb"],
    ["raw NUL", "path", "/a\u0000"],
    ["raw C1 control", "https", "https://example.com/\u0085"],
    ["raw U+202E", "https", "https://example.com/‮gpj.exe"],
    ["raw U+2066", "path", "/a⁦"],
    ["encoded CR LF", "path", "/a%0D%0Ab"],
    ["encoded NUL", "path", "/a%00"],
    ["encoded U+202E", "https", "https://example.com/%E2%80%AE"],
    ["encoded U+2066", "path", "/a%e2%81%a6"],
    ["empty", "path", ""],
  ];

  it.each(UNSAFE)("renders the text of a link without an anchor: %s", (_name, kind, href) => {
    const markup = view(doc(p(t("see "), link(kind, href, "here"))));
    expect(tags(markup, "a")).toHaveLength(0);
    expect(text(markup)).toBe("see here");
  });

  it("refuses a locale prefix that could turn a path into another site", () => {
    for (const prefix of ["/", "//evil.test", "uk", "/uk/", "/u k", "https://evil.test"]) {
      expect(() => view(doc(p(link("path", "/a"))), prefix), prefix).toThrow(RangeError);
    }
  });
});
