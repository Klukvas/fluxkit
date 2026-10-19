import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_LINE_QUANTITY, MIN_LINE_QUANTITY } from "./add-to-cart";
import { createCartStore, cartReducer, initialCartState, type CartState } from "./cart-store";
import { CART_CHANGED_EVENT, publishCartChange, subscribeToCartChanges } from "./cart-events";
import { cartLine, cartOf } from "./test-fixtures";
import { immediateClient, json, problem, settle, stagedClient } from "./test-fetch";

afterEach(() => vi.restoreAllMocks());

const cartOne = cartOf([cartLine("v1", { quantity: 1 })]);
const cartTwo = cartOf([cartLine("v1", { quantity: 2 })]);
const cartThree = cartOf([cartLine("v1", { quantity: 3 })]);

function storeWith(client: ReturnType<typeof stagedClient>["client"], events = new EventTarget()) {
  const published: number[] = [];
  subscribeToCartChanges((change) => published.push(change.itemCount), events);
  const store = createCartStore({ client, locale: "uk", events });
  return { store, events, published };
}

describe("cart store: loading", () => {
  it("starts in the loading state and reads the cart once from the same origin, uncached, in the page's locale", async () => {
    const { client, calls } = stagedClient();
    const { store } = storeWith(client);
    expect(store.getState()).toEqual(initialCartState);
    expect(initialCartState.status).toBe("loading");
    store.start();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("/store/cart?locale=uk");
    expect(calls[0]?.init.cache).toBe("no-store");
    expect(calls[0]?.init.credentials).toBe("same-origin");
    calls[0]?.answer(json(cartTwo));
    await settle();
    expect(store.getState()).toMatchObject({ status: "ready", cart: cartTwo, failure: null });
    expect(store.getState().announcement).toBeNull();
  });

  it("does not read the cart again when started twice (the badge and the page share one read)", async () => {
    const { client, calls } = stagedClient();
    const { store } = storeWith(client);
    store.start();
    store.start();
    store.stop();
    store.start();
    expect(calls).toHaveLength(1);
  });

  it("publishes the cart-changed event with the loaded item count", async () => {
    const { client, calls } = stagedClient();
    const { store, published } = storeWith(client);
    store.start();
    calls[0]?.answer(json(cartTwo));
    await settle();
    expect(published).toEqual([2]);
  });

  it("is an error state (with a translated message) when the first read fails, and a retry recovers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, calls } = stagedClient();
    const { store } = storeWith(client);
    store.start();
    calls[0]?.answer(problem(503, "service_unavailable", {}, { "Retry-After": "5" }));
    await settle();
    expect(store.getState()).toMatchObject({
      status: "error",
      cart: null,
      failure: { messageKey: "errors.service_unavailable" },
    });
    void store.refresh();
    expect(calls).toHaveLength(2);
    calls[1]?.answer(json(cartOne));
    await settle();
    expect(store.getState()).toMatchObject({ status: "ready", cart: cartOne, failure: null });
  });

  it("is an error state when the server cannot be reached", async () => {
    const { client, calls } = stagedClient();
    const { store } = storeWith(client);
    store.start();
    calls[0]?.fail(new TypeError("fetch failed"));
    await settle();
    expect(store.getState()).toMatchObject({
      status: "error",
      failure: { messageKey: "errors.network" },
    });
  });
});

describe("cart store: writes", () => {
  it("adds with POST, the variant and quantity in the body, the CSRF header and the locale", async () => {
    const { client, calls } = immediateClient(() => json(cartTwo));
    const { store, published } = storeWith(client);
    const outcome = await store.add("v1", 2);
    expect(outcome).toEqual({ status: "ok", cart: cartTwo });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "/store/cart/items?locale=uk",
      body: { variantId: "v1", quantity: 2 },
    });
    expect(calls[0]?.headers.get("X-Fluxkit-CSRF")).toBe("1");
    expect(calls[0]?.init.cache).toBe("no-store");
    expect(store.getState()).toMatchObject({ status: "ready", cart: cartTwo });
    expect(published).toEqual([2]);
  });

  it("sets a quantity with PATCH, removes a line with DELETE and acknowledges with POST", async () => {
    const { client, calls } = immediateClient(() => json(cartThree));
    const { store } = storeWith(client);
    await store.setQuantity("v 1", 3);
    await store.remove("v1");
    await store.acknowledge();
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "PATCH /store/cart/items/v%201?locale=uk",
      "DELETE /store/cart/items/v1?locale=uk",
      "POST /store/cart/acknowledge?locale=uk",
    ]);
    expect(calls[0]?.body).toEqual({ quantity: 3 });
    for (const call of calls) expect(call.headers.get("X-Fluxkit-CSRF")).toBe("1");
  });

  it("clears with DELETE /store/cart and then reads the server's empty cart (it never builds money itself)", async () => {
    const empty = cartOf([], { itemCount: 0 });
    const { client, calls } = immediateClient((call) =>
      call.method === "DELETE" ? new Response(null, { status: 204 }) : json(empty),
    );
    const { store, published } = storeWith(client);
    await store.clear();
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "DELETE /store/cart",
      "GET /store/cart?locale=uk",
    ]);
    expect(store.getState()).toMatchObject({ cart: empty, announcement: "cleared" });
    expect(published).toEqual([0]);
  });

  it("announces what a user action did, and nothing after a plain read", async () => {
    const { client } = immediateClient(() => json(cartTwo));
    const { store } = storeWith(client);
    await store.setQuantity("v1", 2);
    expect(store.getState().announcement).toBe("updated");
    await store.remove("v1");
    expect(store.getState().announcement).toBe("removed");
    await store.acknowledge();
    expect(store.getState().announcement).toBe("acknowledged");
    await store.refresh();
    expect(store.getState().announcement).toBeNull();
  });

  it.each([0, -1, 1.5, Number.NaN, 1000])(
    "refuses quantity %s before any request and shows the translated message",
    async (quantity) => {
      const { client, calls } = immediateClient(() => json(cartOne));
      const { store } = storeWith(client);
      await store.refresh();
      const outcome = await store.setQuantity("v1", quantity);
      expect(outcome).toMatchObject({
        status: "failed",
        failure: { messageKey: "errors.field.invalid_quantity" },
      });
      expect(await store.add("v1", quantity)).toMatchObject({ status: "failed" });
      expect(calls).toHaveLength(1);
      expect(store.getState().failure?.messageKey).toBe("errors.field.invalid_quantity");
      expect(store.getState().cart).toEqual(cartOne);
    },
  );

  it("allows exactly 1 to 999", async () => {
    expect(MIN_LINE_QUANTITY).toBe(1);
    expect(MAX_LINE_QUANTITY).toBe(999);
    const { client, calls } = immediateClient(() => json(cartOne));
    const { store } = storeWith(client);
    await store.add("v1", 1);
    await store.add("v1", 999);
    expect(calls).toHaveLength(2);
  });

  it("returns an add failure to the caller and does not leave it in the shared state", async () => {
    const { client } = immediateClient(() =>
      problem(409, "rule_violation", { rule: "variant_not_sellable" }),
    );
    const { store } = storeWith(client);
    const outcome = await store.add("v1", 1);
    expect(outcome).toMatchObject({
      status: "failed",
      failure: { messageKey: "errors.rule.variant_not_sellable" },
    });
    expect(store.getState().failure).toBeNull();
  });
});

describe("cart store: add failures (ported from the step 5 add-to-cart tests)", () => {
  it.each([
    ["variant_not_sellable", 409, "rule_violation", "errors.rule.variant_not_sellable"],
    ["quantity_limit", 409, "rule_violation", "errors.rule.quantity_limit"],
    ["too_many_lines", 409, "rule_violation", "errors.rule.too_many_lines"],
  ])("maps the %s rule to its translated message", async (rule, status, code, key) => {
    const { client } = immediateClient(() => problem(status, code, { rule }));
    expect(await storeWith(client).store.add("v", 1)).toMatchObject({
      status: "failed",
      failure: { messageKey: key },
    });
  });

  it("maps 429, 404 and an unknown code, never showing the API's English detail", async () => {
    for (const [status, code, key] of [
      [429, "too_many_requests", "errors.too_many_requests"],
      [404, "not_found", "errors.not_found"],
      [418, "brand_new_code", "errors.generic"],
    ] as const) {
      const { client } = immediateClient(() => problem(status, code));
      const outcome = await storeWith(client).store.add("v", 1);
      expect(outcome).toMatchObject({ status: "failed", failure: { messageKey: key } });
      expect(JSON.stringify(outcome)).not.toContain("English detail");
    }
  });

  it("reports a network failure and an unreadable answer as translated failures", async () => {
    const down = stagedClient();
    const pending = storeWith(down.client).store.add("v", 1);
    down.calls[0]?.fail(new TypeError("fetch failed"));
    expect(await pending).toMatchObject({ failure: { messageKey: "errors.network" } });
    const html = immediateClient(
      () =>
        new Response("<html>bad gateway</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        }),
    );
    expect(await storeWith(html.client).store.add("v", 1)).toMatchObject({
      failure: { messageKey: "errors.invalidResponse" },
    });
  });
});

describe("cart store: server values only, in request order", () => {
  it("never shows an optimistic quantity or amount: the cart changes only when the answer arrives", async () => {
    const { client, calls } = stagedClient();
    const { store } = storeWith(client);
    store.start();
    calls[0]?.answer(json(cartOne));
    await settle();
    const pending = store.setQuantity("v1", 5);
    expect(calls).toHaveLength(2);
    expect(store.getState().cart).toEqual(cartOne);
    expect(store.getState().busy).toContain("v1");
    calls[1]?.answer(
      json(
        cartOf([cartLine("v1", { quantity: 5 })], { subtotal: { amount: 9995, currency: "UAH" } }),
      ),
    );
    await pending;
    expect(store.getState().cart?.lines[0]?.quantity).toBe(5);
    expect(store.getState().cart?.subtotal.amount).toBe(9995);
    expect(store.getState().busy).toEqual([]);
  });

  it("lets the last REQUEST win when answers arrive out of order (an older answer is dropped)", async () => {
    const { client, calls } = stagedClient();
    const { store, published } = storeWith(client);
    const first = store.setQuantity("v1", 2);
    const second = store.setQuantity("v1", 3);
    calls[1]?.answer(json(cartThree));
    await second;
    calls[0]?.answer(json(cartTwo));
    await first;
    expect(store.getState().cart).toEqual(cartThree);
    expect(published).toEqual([3]);
    expect(store.getState().busy).toEqual([]);
  });

  it("applies both answers when they arrive in order, ending with the later request", async () => {
    const { client, calls } = stagedClient();
    const { store, published } = storeWith(client);
    const first = store.setQuantity("v1", 2);
    const second = store.setQuantity("v1", 3);
    calls[0]?.answer(json(cartTwo));
    await first;
    expect(store.getState().cart).toEqual(cartTwo);
    calls[1]?.answer(json(cartThree));
    await second;
    expect(store.getState().cart).toEqual(cartThree);
    expect(published).toEqual([2, 3]);
  });

  it("drops a slow read that was started before a write whose answer came first", async () => {
    const { client, calls } = stagedClient();
    const { store, published } = storeWith(client);
    const read = store.refresh();
    const write = store.setQuantity("v1", 3);
    calls[1]?.answer(json(cartThree));
    await write;
    calls[0]?.answer(json(cartOne));
    await read;
    expect(store.getState().cart).toEqual(cartThree);
    expect(published).toEqual([3]);
  });

  it("ignores the failure of an older request once a newer answer was applied", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, calls } = stagedClient();
    const { store } = storeWith(client);
    const first = store.setQuantity("v1", 2);
    const second = store.setQuantity("v1", 3);
    calls[1]?.answer(json(cartThree));
    await second;
    calls[0]?.fail(new TypeError("fetch failed"));
    await first;
    expect(store.getState().failure).toBeNull();
    expect(store.getState().cart).toEqual(cartThree);
  });

  it("keeps the line's busy mark until its own request ends, even when answers overlap", async () => {
    const { client, calls } = stagedClient();
    const { store } = storeWith(client);
    const first = store.setQuantity("v1", 2);
    const second = store.setQuantity("v1", 3);
    calls[0]?.answer(json(cartTwo));
    await first;
    expect(store.getState().busy).toEqual(["v1"]);
    calls[1]?.answer(json(cartThree));
    await second;
    expect(store.getState().busy).toEqual([]);
  });
});

describe("cart store: failures keep the cart", () => {
  async function readyStore(client: ReturnType<typeof stagedClient>["client"]) {
    const base = storeWith(client);
    base.store.start();
    return base;
  }

  it("keeps the previous cart and shows a translated message with the wait for a 429", async () => {
    const { client, calls } = stagedClient();
    const { store, published } = await readyStore(client);
    calls[0]?.answer(json(cartOne));
    await settle();
    const pending = store.setQuantity("v1", 4);
    calls[1]?.answer(problem(429, "too_many_requests", {}, { "Retry-After": "17" }));
    expect(await pending).toMatchObject({ status: "failed" });
    expect(store.getState()).toMatchObject({
      status: "ready",
      cart: cartOne,
      failure: { messageKey: "errors.too_many_requests", retryAfterSeconds: 17 },
      announcement: null,
    });
    expect(published).toEqual([1]);
  });

  it("keeps the previous cart on a network error and clears the message after the next success", async () => {
    const { client, calls } = stagedClient();
    const { store } = await readyStore(client);
    calls[0]?.answer(json(cartOne));
    await settle();
    const failing = store.remove("v1");
    calls[1]?.fail(new TypeError("fetch failed"));
    await failing;
    expect(store.getState()).toMatchObject({
      cart: cartOne,
      failure: { messageKey: "errors.network" },
      busy: [],
    });
    const retry = store.remove("v1");
    calls[2]?.answer(json(cartOf([], { itemCount: 0 })));
    await retry;
    expect(store.getState().failure).toBeNull();
    expect(store.getState().cart?.lines).toEqual([]);
  });

  it("replaces the cart with the one inside a 409 cart_changed problem, shows its message and publishes the count", async () => {
    const { client, calls } = stagedClient();
    const { store, published } = await readyStore(client);
    calls[0]?.answer(json(cartOne));
    await settle();
    const pending = store.acknowledge();
    calls[1]?.answer(problem(409, "cart_changed", { cart: cartThree }));
    await pending;
    expect(store.getState()).toMatchObject({
      cart: cartThree,
      failure: { messageKey: "errors.cart_changed" },
    });
    expect(published).toEqual([1, 3]);
  });

  it("keeps the cart and shows the rule when a write is refused without a cart", async () => {
    const { client, calls } = stagedClient();
    const { store } = await readyStore(client);
    calls[0]?.answer(json(cartOne));
    await settle();
    const pending = store.setQuantity("v1", 999);
    calls[1]?.answer(problem(409, "rule_violation", { rule: "quantity_limit" }));
    await pending;
    expect(store.getState()).toMatchObject({
      cart: cartOne,
      failure: { messageKey: "errors.rule.quantity_limit" },
    });
  });

  it("can dismiss the failure", async () => {
    const { client, calls } = stagedClient();
    const { store } = await readyStore(client);
    calls[0]?.answer(json(cartOne));
    await settle();
    const pending = store.remove("v1");
    calls[1]?.fail(new TypeError("fetch failed"));
    await pending;
    store.dismissFailure();
    expect(store.getState().failure).toBeNull();
    expect(store.getState().cart).toEqual(cartOne);
  });

  it("releases the busy mark and stays loud when something unexpected is thrown", async () => {
    const { client, calls } = stagedClient();
    const { store } = await readyStore(client);
    calls[0]?.answer(json(cartOne));
    await settle();
    // An empty variant id is refused by the client itself (a programming error, not something to show the shopper).
    await expect(store.remove("")).rejects.toThrow("variantId");
    expect(store.getState().busy).toEqual([]);
    expect(store.getState().failure).toBeNull();
  });
});

describe("cart store: the cart-changed event", () => {
  it("publishes only answers that were applied, never an own event back into a refetch", async () => {
    const { client, calls } = immediateClient(() => json(cartTwo));
    const { store } = storeWith(client);
    store.start();
    await settle();
    await store.setQuantity("v1", 2);
    await settle();
    // One read and one write: the store's own cart-changed events do not start a third request.
    expect(calls).toHaveLength(2);
  });

  it("re-reads the cart when another publisher reports a different count", async () => {
    const { client, calls } = immediateClient(() =>
      json(cartOf([cartLine("v1", { quantity: 5 })])),
    );
    const { store, events } = storeWith(client);
    store.start();
    await settle();
    expect(calls).toHaveLength(1);
    publishCartChange({ itemCount: 5 }, events);
    await settle();
    expect(calls).toHaveLength(1);
    publishCartChange({ itemCount: 9 }, events);
    await settle();
    expect(calls).toHaveLength(2);
    expect(store.getState().cart?.itemCount).toBe(5);
  });

  it("stops listening after stop", async () => {
    const { client, calls } = immediateClient(() => json(cartOne));
    const { store, events } = storeWith(client);
    store.start();
    await settle();
    store.stop();
    publishCartChange({ itemCount: 9 }, events);
    await settle();
    expect(calls).toHaveLength(1);
  });

  it("uses the event name of step 5", () => {
    expect(CART_CHANGED_EVENT).toBe("fluxkit:cart-changed");
  });
});

describe("cart store: subscriptions", () => {
  it("notifies subscribers on every change and stops after unsubscribe", async () => {
    const { client } = immediateClient(() => json(cartOne));
    const { store } = storeWith(client);
    const seen: CartState[] = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getState()));
    await store.refresh();
    const count = seen.length;
    expect(count).toBeGreaterThan(0);
    unsubscribe();
    await store.refresh();
    expect(seen).toHaveLength(count);
  });

  it("returns the same state object while nothing changed (useSyncExternalStore needs it)", () => {
    const { client } = immediateClient(() => json(cartOne));
    const { store } = storeWith(client);
    expect(store.getState()).toBe(store.getState());
  });
});

describe("cartReducer", () => {
  const ready: CartState = {
    ...initialCartState,
    status: "ready",
    cart: cartOne,
    appliedSeq: 4,
  };

  it("applies an answer newer than the applied one and records its sequence number", () => {
    const next = cartReducer(ready, {
      type: "applied",
      seq: 5,
      key: "v1",
      cart: cartTwo,
      announcement: "updated",
      failure: null,
    });
    expect(next).toMatchObject({ cart: cartTwo, appliedSeq: 5, announcement: "updated" });
  });

  it("drops an answer older than the applied one but still releases its busy mark", () => {
    const busy = cartReducer(ready, { type: "started", key: "v1" });
    expect(busy.busy).toEqual(["v1"]);
    const next = cartReducer(busy, {
      type: "applied",
      seq: 3,
      key: "v1",
      cart: cartThree,
      announcement: "updated",
      failure: null,
    });
    expect(next.cart).toEqual(cartOne);
    expect(next.appliedSeq).toBe(4);
    expect(next.busy).toEqual([]);
  });

  it("does not show a failure for a request older than the applied answer", () => {
    const next = cartReducer(ready, {
      type: "failed",
      seq: 2,
      key: null,
      failure: {
        messageKey: "errors.network",
        status: null,
        code: null,
        retryAfterSeconds: null,
        fieldErrors: [],
      },
    });
    expect(next.failure).toBeNull();
  });
});
