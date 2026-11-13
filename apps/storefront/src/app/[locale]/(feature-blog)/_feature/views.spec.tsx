import { createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  leftoverText,
  sentinelTranslator,
  textAttributes,
} from "../../../../components/test-helpers";
import { messagesByLocale } from "../../../../messages";
import { post, postList, postSummary } from "./blog-fixtures";
import { BlogListView, BlogPostView } from "./views";

const en = createTranslator(messagesByLocale.en, "en");
const hosts = ["cdn.example.com"];
const second = { ...postSummary, slug: "autumn", title: "Autumn", excerpt: null, cover: null };

function list(result: Parameters<typeof BlogListView>[0]["result"], page = 1, t = en) {
  return renderToStaticMarkup(
    <BlogListView locale="en" t={t} page={page} result={result} imageHosts={hosts} />,
  );
}

describe("BlogListView", () => {
  it("lists the posts as cards: a heading link, the date, the excerpt and the cover in its frame", () => {
    const html = list({ kind: "ok", list: postList([postSummary, second]), pageCount: 1 });
    expect(html).toContain('<h1 class="font-display text-3xl font-bold text-foreground">Blog</h1>');
    expect(html).toContain('<ul aria-label="Posts"');
    expect(html.match(/<article/g)).toHaveLength(2);
    expect(html).toMatch(
      /<h2[^>]*><a[^>]*href="\/en\/blog\/spring-care"[^>]*>Spring care<\/a><\/h2>/,
    );
    expect(html).toContain('<time dateTime="2026-11-01T09:00:00.000Z">November 1, 2026</time>');
    expect(html).toContain("How to look after linen in spring.");
    expect(html).toMatch(
      /<div class="aspect-video overflow-hidden bg-muted"><img alt="Folded linen"/,
    );
    expect(html).toContain('loading="lazy"');
    // One cover only: a post without one has no frame.
    expect(html.match(/aspect-video/g)).toHaveLength(1);
    expect(html).not.toContain('aria-label="Blog pages"');
  });

  it("links the pages with an accessible navigation when there is more than one", () => {
    const html = list({ kind: "ok", list: postList([postSummary], 30, 2), pageCount: 3 }, 2);
    expect(html).toContain('<nav aria-label="Blog pages">');
    expect(html).toContain('href="/en/blog" rel="prev"');
    expect(html).toContain('href="/en/blog?page=3" rel="next"');
    expect(html).toContain('aria-current="page"');
  });

  it("says when there is no post yet and links the catalog, and shows an inline error on an outage", () => {
    const empty = list({ kind: "ok", list: postList([]), pageCount: 0 });
    expect(empty).toContain("No posts yet");
    expect(empty).toContain('href="/en/catalog"');
    expect(empty).not.toContain("<ul");
    const outage = list({ kind: "unavailable" });
    expect(outage).toContain('role="status"');
    expect(outage).toContain("The posts could not be loaded right now.");
    expect(outage).not.toContain("No posts yet");
  });

  it("takes every text from the messages", () => {
    const t = sentinelTranslator();
    for (const result of [
      { kind: "ok", list: postList([postSummary, second], 30), pageCount: 3 } as const,
      { kind: "ok", list: postList([]), pageCount: 0 } as const,
      { kind: "unavailable" } as const,
    ]) {
      const html = list(result, 1, t).replaceAll(postSummary.title, "").replaceAll("Autumn", "");
      const withoutData = html
        .replaceAll(postSummary.excerpt ?? "", "")
        .replace(/November \d+, \d+/g, "");
      // The breadcrumbs' separator is the one non-message character (`@fluxkit/ui` `Breadcrumbs`).
      expect(leftoverText(withoutData).replaceAll("/", "").trim()).toBe("");
      for (const value of textAttributes(withoutData)) {
        expect(value === "" || value === "Folded linen" || value.startsWith("§"), value).toBe(true);
      }
    }
  });
});

describe("BlogPostView", () => {
  it("renders the title, the date, the eager cover, the body with locale links and a link back", () => {
    const html = renderToStaticMarkup(
      <BlogPostView locale="en" t={en} post={post} imageHosts={hosts} />,
    );
    expect(html).toContain('<nav aria-label="Breadcrumb"');
    expect(html).toContain('href="/en/blog"');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(">Spring care</h1>");
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchPriority="high"');
    expect(html).toContain('width="1600" height="900"');
    expect(html).toMatch(/<h2[^>]*>Washing<\/h2>/);
    expect(html).toMatch(/<a [^>]*href="\/en\/catalog"[^>]*>catalog<\/a>/);
    expect(html).toContain("<strong>Dry flat</strong>");
    expect(html).toContain(">All posts</a>");
  });

  it("shows the placeholder for a cover of a host that is not allowed, and a decorative cover without alt text", () => {
    const html = renderToStaticMarkup(
      <BlogPostView
        locale="en"
        t={en}
        post={{
          ...post,
          cover: { url: "https://elsewhere.example/c.webp", width: 10, height: 10, alt: null },
        }}
        imageHosts={hosts}
      />,
    );
    expect(html).not.toContain("elsewhere.example");
    expect(html).not.toContain("<img");
  });

  it("renders nothing of a body as HTML: tags in the text stay text", () => {
    const html = renderToStaticMarkup(
      <BlogPostView
        locale="en"
        t={en}
        post={{
          ...post,
          title: "<b>Bold</b>",
          content: {
            type: "document",
            children: [
              { type: "paragraph", children: [{ type: "text", value: "<script>x</script>" }] },
            ],
          },
        }}
        imageHosts={hosts}
      />,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});
