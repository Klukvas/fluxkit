import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchQuery } from "./search-query";

/*
 * The wiring of the results page's read to the request (review F1, ADR 0037): which `X-Forwarded-For` the API receives
 * for the page request's header, with `STOREFRONT_FORWARD_CLIENT_ADDRESS` off and on. The module itself is loaded, with
 * Next's request APIs replaced and the API answered by a stub `fetch`; nothing else is mocked.
 */

const requestHeaders = vi.hoisted(() => ({ value: new Headers(), reads: 0 }));

vi.mock("next/headers", () => ({
  headers: () => {
    requestHeaders.reads += 1;
    return Promise.resolve(requestHeaders.value);
  },
}));
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

const query: SearchQuery = { q: "lamp", facets: [], price: null, sort: null, page: 1 };
const answer = {
  items: [],
  total: 0,
  page: 1,
  pageCount: 0,
  limit: 24,
  sort: "relevance",
  relaxed: false,
  query: { normalized: "lamp" },
  facets: [],
  price: null,
};

/** The `X-Forwarded-For` the API received for one page read, `null` when none was sent. */
async function forwardedToApi(
  setting: string | undefined,
  pageHeader: string | null,
): Promise<string | null> {
  vi.stubEnv("API_INTERNAL_URL", "http://127.0.0.1:3999");
  vi.stubEnv("STOREFRONT_FORWARD_CLIENT_ADDRESS", setting);
  requestHeaders.value = new Headers(pageHeader === null ? {} : { "x-forwarded-for": pageHeader });
  const sent: (string | null)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      sent.push(new Headers(init.headers).get("x-forwarded-for"));
      return Promise.resolve(
        new Response(JSON.stringify(answer), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
  const { searchData } = await import("./search-data.server");
  const outcome = await searchData.search("en", query);
  expect(outcome.kind).toBe("results");
  expect(sent).toHaveLength(1);
  return sent[0] ?? null;
}

beforeEach(() => {
  requestHeaders.reads = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the results page's read with STOREFRONT_FORWARD_CLIENT_ADDRESS off (the default)", () => {
  it.each([undefined, "", "false"])(
    "passes no client header on for the setting %j, and does not even read the request's headers",
    async (setting) => {
      expect(await forwardedToApi(setting, "203.0.113.9")).toBeNull();
      expect(requestHeaders.reads).toBe(0);
    },
  );
});

describe("the results page's read with STOREFRONT_FORWARD_CLIENT_ADDRESS=true", () => {
  it("passes on a well-formed chain the edge wrote", async () => {
    expect(await forwardedToApi("true", "203.0.113.9")).toBe("203.0.113.9");
    expect(await forwardedToApi("true", "203.0.113.9 , 198.51.100.2")).toBe(
      "203.0.113.9, 198.51.100.2",
    );
  });

  it.each(["unknown, 203.0.113.9", "203.0.113.9; evil", "not-an-address"])(
    "passes nothing on for %j: the header is checked (forwardableAddresses), never passed raw",
    async (header) => {
      expect(await forwardedToApi("true", header)).toBeNull();
    },
  );

  it("passes nothing on without a header", async () => {
    expect(await forwardedToApi("true", null)).toBeNull();
  });

  it("refuses a setting that is not exactly true or false, loudly", async () => {
    await expect(forwardedToApi("yes", "203.0.113.9")).rejects.toThrow(
      /STOREFRONT_FORWARD_CLIENT_ADDRESS/,
    );
  });
});
