/**
 * TEST FIXTURES of the blog slice's specs: API-shaped answers (`docs/api/features-blog.md`). Never imported by a page.
 */
import type { BlogPost, BlogPostList, BlogPostSummary } from "./blog-api";

export const postSummary: BlogPostSummary = {
  slug: "spring-care",
  title: "Spring care",
  excerpt: "How to look after linen in spring.",
  publishedAt: "2026-11-01T09:00:00.000Z",
  updatedAt: "2026-11-02T10:30:00.000Z",
  cover: {
    url: "https://cdn.example.com/cover.webp",
    width: 1600,
    height: 900,
    alt: "Folded linen",
  },
};

export const post: BlogPost = {
  ...postSummary,
  seoTitle: null,
  seoDescription: null,
  content: {
    type: "document",
    children: [
      { type: "heading", level: 2, children: [{ type: "text", value: "Washing" }] },
      {
        type: "paragraph",
        children: [
          { type: "text", value: "Wash it cold. See the " },
          {
            type: "link",
            kind: "path",
            href: "/catalog",
            children: [{ type: "text", value: "catalog" }],
          },
          { type: "text", value: "." },
        ],
      },
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [
          {
            type: "listItem",
            children: [
              {
                type: "paragraph",
                children: [{ type: "strong", children: [{ type: "text", value: "Dry flat" }] }],
              },
            ],
          },
        ],
      },
      { type: "codeBlock", value: "30 °C" },
    ],
  },
  locales: ["uk", "en"],
};

export function postList(items: BlogPostSummary[], total = items.length, page = 1): BlogPostList {
  return { items, total, page, limit: 12 };
}

/** A JSON answer as the API sends it. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** A problem answer as the API sends it. */
export function problemResponse(status: number, code: string): Response {
  return new Response(
    JSON.stringify({ type: "about:blank", title: "Problem", status, code, detail: "Problem." }),
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}
