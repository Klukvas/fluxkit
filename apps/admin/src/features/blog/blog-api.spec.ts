import { createTransport } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { createBlogApi } from "./blog-api";
import { postFixture } from "./test-fixtures";

interface Sent {
  url: string;
  method: string;
  csrf: string | null;
  contentType: string | null;
  body: unknown;
}

function fakeApi(status: number, answer: unknown) {
  const sent: Sent[] = [];
  const send = createTransport({
    baseUrl: "",
    fetch: (url, init) => {
      const headers = new Headers(init.headers);
      sent.push({
        url,
        method: init.method ?? "GET",
        csrf: headers.get("X-Fluxkit-CSRF"),
        contentType: headers.get("Content-Type"),
        body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
      });
      return Promise.resolve(
        status === 204
          ? new Response(null, { status })
          : new Response(JSON.stringify(answer), {
              status,
              headers: {
                "Content-Type": status >= 400 ? "application/problem+json" : "application/json",
              },
            }),
      );
    },
  });
  return { api: createBlogApi(send), sent };
}

const ID = postFixture().id;

describe("the blog's admin requests (docs/api/features-blog.md)", () => {
  it("lists with the state, page and size in the query", async () => {
    const { api, sent } = fakeApi(200, { items: [], total: 0, page: 2, limit: 50 });
    const result = await api.listBlogPosts({ status: "scheduled", page: 2, limit: 50 });
    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { items: [], total: 0, page: 2, limit: 50 },
    });
    expect(sent).toEqual([
      {
        url: "/admin/blog/posts?status=scheduled&page=2&limit=50",
        method: "GET",
        csrf: null,
        contentType: null,
        body: undefined,
      },
    ]);
  });

  it("writes with the CSRF header and a JSON body", async () => {
    const { api, sent } = fakeApi(201, postFixture());
    await api.createBlogPost({ title: { uk: "Так" } });
    const { api: patcher, sent: patched } = fakeApi(200, postFixture());
    await patcher.updateBlogPost(ID, { excerpt: null });
    const { api: publisher, sent: published } = fakeApi(200, postFixture({ state: "scheduled" }));
    await publisher.publishBlogPost(ID, { publishedAt: "2026-12-01T08:30:00.000Z" });
    expect(sent[0]).toMatchObject({
      url: "/admin/blog/posts",
      method: "POST",
      csrf: "1",
      contentType: "application/json",
      body: { title: { uk: "Так" } },
    });
    expect(patched[0]).toMatchObject({
      url: `/admin/blog/posts/${ID}`,
      method: "PATCH",
      csrf: "1",
      body: { excerpt: null },
    });
    expect(published[0]).toMatchObject({
      url: `/admin/blog/posts/${ID}/publish`,
      method: "POST",
      csrf: "1",
      body: { publishedAt: "2026-12-01T08:30:00.000Z" },
    });
  });

  it("unpublishes and deletes without a body", async () => {
    const { api, sent } = fakeApi(200, postFixture());
    await api.unpublishBlogPost(ID);
    const { api: remover, sent: removed } = fakeApi(204, null);
    expect(await remover.deleteBlogPost(ID)).toEqual({ ok: true, status: 204, data: undefined });
    expect(sent[0]).toMatchObject({
      url: `/admin/blog/posts/${ID}/unpublish`,
      method: "POST",
      csrf: "1",
      body: undefined,
    });
    expect(removed[0]).toMatchObject({
      url: `/admin/blog/posts/${ID}`,
      method: "DELETE",
      csrf: "1",
    });
  });

  it("hands a refusal over as a problem, with the Markdown members kept", async () => {
    const answer = {
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      code: "validation_failed",
      detail: "The request is not valid.",
      errors: [
        { path: "body.uk", code: "markdown_invalid", line: 4, markdownCode: "empty_heading" },
      ],
    };
    const { api } = fakeApi(400, answer);
    const result = await api.updateBlogPost(ID, { body: { uk: "##" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.errors?.[0]).toEqual(answer.errors[0]);
  });
});
