import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureData } from "../../../../features/types";
import { StoreUnavailableError, createStoreData } from "../../../../lib/store-data";
import { loadBlogList, loadBlogPost } from "./blog-data";
import { jsonResponse, post, postList, postSummary, problemResponse } from "./blog-fixtures";

/** The blog's reads against a fake API that answers each request with the next response of `answers`. */
function blogData(
  answers: (() => Response | Promise<Response>)[],
  inits: RequestInit[] = [],
): FeatureData {
  let next = 0;
  const data = createStoreData({
    baseUrl: () => "http://api.internal:3000",
    fetch: async (_url, init) => {
      inits.push(init);
      const answer = answers[next];
      next += 1;
      if (answer === undefined) throw new Error("no more answers");
      return answer();
    },
  });
  return { read: (operation, call, read) => data.featureRead("blog", operation, call, read) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadBlogList", () => {
  it("gives a page of posts and the number of pages, read through the 60 s data cache", async () => {
    const inits: RequestInit[] = [];
    const data = blogData([() => jsonResponse(postList([postSummary], 25, 1))], inits);
    expect(await loadBlogList(data, "uk", 1)).toEqual({
      kind: "ok",
      list: postList([postSummary], 25, 1),
      pageCount: 3,
    });
    expect(inits[0]).toMatchObject({ next: { revalidate: 60, tags: ["store", "feature:blog"] } });
  });

  it("sends a page past the last one to the last page, and page 2 of an empty blog to page 1", async () => {
    expect(
      await loadBlogList(blogData([() => jsonResponse(postList([], 25, 4))]), "uk", 4),
    ).toEqual({ kind: "beyond_last_page", lastPage: 3 });
    expect(await loadBlogList(blogData([() => jsonResponse(postList([], 0, 2))]), "uk", 2)).toEqual(
      { kind: "beyond_last_page", lastPage: 1 },
    );
    expect(await loadBlogList(blogData([() => jsonResponse(postList([], 0, 1))]), "uk", 1)).toEqual(
      { kind: "ok", list: postList([], 0, 1), pageCount: 0 },
    );
  });

  it("shows the inline error on an outage or a broken answer, and throws on a refused request", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const answer of [
      () => problemResponse(503, "unavailable"),
      () => Promise.reject(new TypeError("fetch failed")),
      () => jsonResponse({ items: "none" }),
    ]) {
      expect(await loadBlogList(blogData([answer]), "uk", 1)).toEqual({ kind: "unavailable" });
    }
    await expect(
      loadBlogList(blogData([() => problemResponse(400, "validation_failed")]), "uk", 1),
    ).rejects.toThrow("GET /store/blog/posts answered 400 validation_failed.");
  });
});

describe("loadBlogPost", () => {
  it("gives the post, or null for the API's 404, never through the data cache", async () => {
    const inits: RequestInit[] = [];
    expect(
      await loadBlogPost(blogData([() => jsonResponse(post)], inits), "uk", "spring-care"),
    ).toEqual(post);
    // Next's data cache keeps 200 answers only: a cached post would outlive its unpublishing.
    expect(inits[0]).toMatchObject({ cache: "no-store" });
    expect(inits[0]).not.toHaveProperty("next");
    expect(
      await loadBlogPost(blogData([() => problemResponse(404, "not_found")]), "uk", "gone"),
    ).toBeNull();
    await expect(
      loadBlogPost(blogData([() => problemResponse(400, "validation_failed")]), "uk", "x"),
    ).rejects.toThrow("GET /store/blog/posts/{slug} answered 400 validation_failed.");
  });

  it("never serves an earlier answer through an outage: a taken-back post is not shown from memory", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const data = blogData([
      () => jsonResponse(post),
      () => Promise.reject(new TypeError("fetch failed")),
      () => jsonResponse(postList([postSummary])),
      () => problemResponse(502, "bad_gateway"),
    ]);
    expect(await loadBlogPost(data, "uk", "spring-care")).toEqual(post);
    await expect(loadBlogPost(data, "uk", "spring-care")).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
    expect((await loadBlogList(data, "uk", 1)).kind).toBe("ok");
    expect(await loadBlogList(data, "uk", 1)).toEqual({ kind: "unavailable" });
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("last good response"));
  });
});
