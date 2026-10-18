import { createStoreClient } from "@fluxkit/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAccountLinkState, loadCartBadgeState } from "./session-state";

afterEach(() => vi.restoreAllMocks());

function json(body: unknown, status = 200, type = "application/json"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": type } });
}

function problem(status: number, code: string): Response {
  return json(
    { type: "about:blank", title: "t", status, code, detail: "d" },
    status,
    "application/problem+json",
  );
}

function clientWith(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = createStoreClient({
    baseUrl: "",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
  });
  return { client, calls };
}

describe("loadCartBadgeState", () => {
  it("reads the cart once from the same origin, uncached, and returns the item count", async () => {
    const { client, calls } = clientWith(() => json({ itemCount: 3, lines: [] }));
    expect(await loadCartBadgeState(client)).toEqual({ status: "ready", count: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/store/cart");
    expect(calls[0]?.init.cache).toBe("no-store");
    expect(calls[0]?.init.credentials).toBe("same-origin");
    expect(calls[0]?.init.method).toBe("GET");
  });

  it("returns an empty cart as a count of zero", async () => {
    const { client } = clientWith(() => json({ itemCount: 0, lines: [] }));
    expect(await loadCartBadgeState(client)).toEqual({ status: "ready", count: 0 });
  });

  it("is an error state (logged, not hidden) when the API answers a problem or cannot be reached", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const refused = clientWith(() => problem(503, "service_unavailable"));
    expect(await loadCartBadgeState(refused.client)).toEqual({ status: "error" });
    const down = clientWith(() => {
      throw new TypeError("fetch failed");
    });
    expect(await loadCartBadgeState(down.client)).toEqual({ status: "error" });
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("lets an abort through so an unmounted island does not set state", async () => {
    const controller = new AbortController();
    controller.abort();
    const { client } = clientWith((_url, init) => {
      throw Object.assign(new Error("aborted"), { name: "AbortError", signal: init.signal });
    });
    await expect(loadCartBadgeState(client, controller.signal)).rejects.toThrow();
  });
});

describe("loadAccountLinkState", () => {
  it("is signedIn for 200 and calls /store/account/me uncached", async () => {
    const { client, calls } = clientWith(() => json({ customer: { id: "c1" } }));
    expect(await loadAccountLinkState(client)).toEqual({ status: "signedIn" });
    expect(calls[0]?.url).toBe("/store/account/me");
    expect(calls[0]?.init.cache).toBe("no-store");
  });

  it("treats 401 as a guest, not as an error, and logs nothing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = clientWith(() => problem(401, "unauthorized"));
    expect(await loadAccountLinkState(client)).toEqual({ status: "guest" });
    expect(error).not.toHaveBeenCalled();
  });

  it("is an error state for any other failure", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = clientWith(() => problem(500, "internal_error"));
    expect(await loadAccountLinkState(server.client)).toEqual({ status: "error" });
    const html = clientWith(() => new Response("<html>", { status: 502 }));
    expect(await loadAccountLinkState(html.client)).toEqual({ status: "error" });
    expect(error).toHaveBeenCalledTimes(2);
  });
});
