import { createStoreClient } from "@fluxkit/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishCartChange } from "./cart-events";
import { loadAccountLinkState, loadCartBadgeState, watchCartBadge } from "./session-state";

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

describe("watchCartBadge", () => {
  function deferredClient() {
    let resolve: (response: Response) => void = () => {};
    const response = new Promise<Response>((done) => (resolve = done));
    const client = createStoreClient({ baseUrl: "", fetch: () => response });
    return { client, answer: (cart: unknown) => resolve(json(cart)) };
  }

  it("shows the loaded count, then every cart change the page publishes", async () => {
    const target = new EventTarget();
    const states: unknown[] = [];
    const { client, calls } = clientWith(() => json({ itemCount: 2, lines: [] }));
    const stop = watchCartBadge({ client, onState: (state) => states.push(state), target });
    await vi.waitFor(() => expect(states).toEqual([{ status: "ready", count: 2 }]));
    publishCartChange({ itemCount: 5 }, target);
    expect(states.at(-1)).toEqual({ status: "ready", count: 5 });
    expect(calls).toHaveLength(1);
    stop();
  });

  it("lets a change that arrives while the first read is in flight win over the older read", async () => {
    const target = new EventTarget();
    const states: unknown[] = [];
    const { client, answer } = deferredClient();
    const stop = watchCartBadge({ client, onState: (state) => states.push(state), target });
    publishCartChange({ itemCount: 7 }, target);
    answer({ itemCount: 1, lines: [] });
    await new Promise((done) => setTimeout(done, 0));
    expect(states).toEqual([{ status: "ready", count: 7 }]);
    stop();
  });

  it("stops listening and drops a late answer after stop", async () => {
    const target = new EventTarget();
    const states: unknown[] = [];
    const controller = new AbortController();
    const { client, answer } = deferredClient();
    const stop = watchCartBadge({
      client,
      onState: (state) => states.push(state),
      target,
      signal: controller.signal,
    });
    stop();
    controller.abort();
    publishCartChange({ itemCount: 3 }, target);
    answer({ itemCount: 1, lines: [] });
    await new Promise((done) => setTimeout(done, 0));
    expect(states).toEqual([]);
  });

  it("reports an unreadable cart as the error state, and a later change still recovers it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const target = new EventTarget();
    const states: unknown[] = [];
    const { client } = clientWith(() => problem(503, "service_unavailable"));
    const stop = watchCartBadge({ client, onState: (state) => states.push(state), target });
    await vi.waitFor(() => expect(states).toEqual([{ status: "error" }]));
    publishCartChange({ itemCount: 1 }, target);
    expect(states.at(-1)).toEqual({ status: "ready", count: 1 });
    stop();
  });
});
