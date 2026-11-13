import { describe, expect, it } from "vitest";
import type { FeatureCallContext } from "../../../../lib/store-data";
import {
  InvalidBlogResponseError,
  getPostCall,
  listPostsCall,
  parseMarkdownDocument,
  parsePost,
  sitemapCall,
} from "./blog-api";
import { jsonResponse, post, postList, postSummary, problemResponse } from "./blog-fixtures";

interface Sent {
  url: string;
  init: RequestInit;
}

function contextAnswering(
  response: Response,
  sent: Sent[] = [],
  baseUrl = "http://api.internal:3000/",
) {
  const signal = new AbortController().signal;
  const context: FeatureCallContext = {
    baseUrl,
    fetch: async (url, init) => {
      sent.push({ url, init });
      return response;
    },
    options: {
      signal,
      fetchOptions: { next: { revalidate: 60, tags: ["store", "feature:blog"] } },
    },
  };
  return { context, signal };
}

describe("the blog's store calls", () => {
  it("asks for one list page in the locale with the page size, a GET with the cache settings and the signal", async () => {
    const sent: Sent[] = [];
    const { context, signal } = contextAnswering(
      jsonResponse(postList([postSummary], 13, 2)),
      sent,
    );
    const result = await listPostsCall("uk", 2)(context);
    expect(result).toEqual({ ok: true, status: 200, data: postList([postSummary], 13, 2) });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(
      "http://api.internal:3000/store/blog/posts?locale=uk&page=2&limit=12",
    );
    expect(sent[0]?.init).toMatchObject({
      method: "GET",
      redirect: "manual",
      signal,
      next: { revalidate: 60, tags: ["store", "feature:blog"] },
    });
  });

  it("asks for one post by its encoded slug and hands a 404 problem back as a failed result", async () => {
    const sent: Sent[] = [];
    const { context } = contextAnswering(problemResponse(404, "not_found"), sent);
    const result = await getPostCall("en", "spring-care")(context);
    expect(sent[0]?.url).toBe("http://api.internal:3000/store/blog/posts/spring-care?locale=en");
    expect(result).toMatchObject({ ok: false, status: 404, problem: { code: "not_found" } });
  });

  it("reads the sitemap with its locales and the truncation flag", async () => {
    const body = {
      items: [
        { slug: "spring-care", updatedAt: "2026-11-02T10:30:00.000Z", locales: ["uk", "en"] },
      ],
      truncated: false,
    };
    const { context } = contextAnswering(jsonResponse(body));
    expect(await sitemapCall(context)).toEqual({ ok: true, status: 200, data: body });
  });

  it("refuses an answer that is not the documented one, naming the operation and never a value", async () => {
    const page = (item: unknown) => jsonResponse({ items: [item], total: 1, page: 1, limit: 12 });
    const html = { "Content-Type": "text/html" };
    const odd: [string, () => Response][] = [
      ["html", () => new Response("<html>gateway</html>", { status: 200, headers: html })],
      [
        "redirect",
        () =>
          new Response(null, { status: 302, headers: { Location: "https://elsewhere.example/" } }),
      ],
      ["error page", () => new Response("<html>502</html>", { status: 502, headers: html })],
      [
        "broken json",
        () => new Response("{", { status: 200, headers: { "Content-Type": "application/json" } }),
      ],
      [
        "broken problem",
        () =>
          new Response("{}", {
            status: 404,
            headers: { "Content-Type": "application/problem+json" },
          }),
      ],
      ["a field of the wrong type", () => page({ ...postSummary, title: 7 })],
      ["a bad time", () => page({ ...postSummary, publishedAt: "soon" })],
      [
        "a bad cover",
        () => page({ ...postSummary, cover: { url: "x", width: 0, height: 1, alt: null } }),
      ],
    ];
    for (const [name, response] of odd) {
      const failure = await listPostsCall(
        "uk",
        1,
      )(contextAnswering(response()).context).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure, name).toBeInstanceOf(InvalidBlogResponseError);
      expect((failure as Error).message, name).toMatch(/^GET \/store\/blog\/posts: /);
      expect((failure as Error).message, name).not.toMatch(/gateway|soon|elsewhere/);
    }
  });
});

describe("parsePost", () => {
  it("keeps the documented fields of a post and its parsed body", () => {
    expect(parsePost(JSON.parse(JSON.stringify(post)) as unknown)).toEqual(post);
  });

  it("refuses a body that is not a Markdown document, naming the field", () => {
    expect(() => parsePost({ ...post, content: "<p>html</p>" })).toThrow(
      "content is not an object.",
    );
    expect(() => parsePost({ ...post, content: { type: "html", children: [] } })).toThrow(
      'content.type is not "document".',
    );
    expect(() =>
      parseMarkdownDocument({
        type: "document",
        children: [{ type: "heading", level: 1, children: [] }],
      }),
    ).toThrow("content.children[0].level is not 2, 3 or 4.");
    expect(() =>
      parseMarkdownDocument({
        type: "document",
        children: [
          {
            type: "paragraph",
            children: [{ type: "link", kind: "javascript", href: "/x", children: [] }],
          },
        ],
      }),
    ).toThrow('content.children[0].children[0].kind is not "path" or "https".');
  });

  it("keeps a node type of a newer API as it is (an additive contract; the renderer skips it)", () => {
    const newer = {
      type: "document",
      children: [
        { type: "table", rows: [] },
        { type: "paragraph", children: [{ type: "mention", who: "shop" }] },
      ],
    };
    expect(parseMarkdownDocument(newer)).toEqual(newer);
    expect(() => parseMarkdownDocument({ type: "document", children: [{ type: 3 }] })).toThrow(
      "content.children[0].type is not a string.",
    );
  });
});
