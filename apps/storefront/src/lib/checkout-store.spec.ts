import { NetworkError } from "@fluxkit/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutConfig } from "../config/checkout";
import { createCartStore } from "./cart-store";
import {
  ATTEMPT_STORAGE_KEY,
  InsecureContextError,
  createAttemptManager,
  webAttemptCrypto,
  type AttemptStorage,
} from "./checkout-attempt";
import { initialCheckoutValues, type CheckoutValues } from "./checkout-form";
import { checkoutBlock, createCheckoutStore, initialCheckoutState } from "./checkout-store";
import { cartLine, cartOf } from "./test-fixtures";
import { json, problem, settle, stagedClient, type PendingCall } from "./test-fetch";

afterEach(() => vi.restoreAllMocks());

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE";
const cartA = cartOf([cartLine("a")], { total: { amount: 1999, currency: "UAH" } });
const cartB = cartOf([cartLine("a", { quantity: 2 })], {
  total: { amount: 3998, currency: "UAH" },
});
const order = { number: "7K3M-9QX2", status: "awaiting_payment" };

function values(overrides: Partial<CheckoutValues> = {}): CheckoutValues {
  return {
    ...initialCheckoutValues(checkoutConfig),
    email: "guest@example.test",
    phone: "+380441234567",
    firstName: "Ada",
    lastName: "Guest",
    "shippingAddress.city": "Kyiv",
    "shippingAddress.line1": "Street 1",
    ...overrides,
  };
}

function memoryStorage(): { storage: AttemptStorage; map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
      removeItem: (key) => void map.delete(key),
    },
  };
}

async function setup(
  options: { cart?: typeof cartA; storage?: AttemptStorage | null; insecure?: boolean } = {},
) {
  const { client, calls } = stagedClient();
  const cart = createCartStore({ client, locale: "uk", events: new EventTarget() });
  const memory = memoryStorage();
  const storage = options.storage === undefined ? memory.storage : options.storage;
  const checkout = createCheckoutStore({
    client,
    cart,
    locale: "uk",
    config: checkoutConfig,
    attempts: () => {
      if (options.insecure === true) throw new InsecureContextError();
      return createAttemptManager({ storage, crypto: webAttemptCrypto(globalThis.crypto) });
    },
  });
  cart.start();
  calls[0]?.answer(json(options.cart ?? cartA));
  await settle();
  return { client, calls, cart, checkout, map: memory.map };
}

const checkoutCalls = (calls: PendingCall[]) =>
  calls.filter((call) => call.url.startsWith("/store/checkout"));

/** The key is hashed with crypto.subtle (a thread pool), so the request starts after an unknown number of ticks. */
async function sentCheckouts(calls: PendingCall[], count: number): Promise<PendingCall[]> {
  for (let round = 0; round < 200 && checkoutCalls(calls).length < count; round += 1)
    await settle();
  const found = checkoutCalls(calls);
  expect(found).toHaveLength(count);
  return found;
}
const keyOf = (call: PendingCall | undefined) => call?.headers.get("Idempotency-Key");

describe("checkout store: one attempt per body", () => {
  it("sends ONE request for a double submit, with the CSRF header, the key and the latest total", async () => {
    const { calls, checkout } = await setup();
    const first = checkout.submit(values(), { signedIn: false });
    const second = checkout.submit(values(), { signedIn: false });
    expect(second).toBe(first);
    const sent = await sentCheckouts(calls, 1);
    expect(sent[0]?.method).toBe("POST");
    expect(sent[0]?.url).toBe("/store/checkout");
    expect(sent[0]?.headers.get("X-Fluxkit-CSRF")).toBe("1");
    expect(keyOf(sent[0])).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent[0]?.init.cache).toBe("no-store");
    expect(sent[0]?.body).toMatchObject({
      expectedTotal: { amount: 1999, currency: "UAH" },
      locale: "uk",
    });
    expect(checkout.getState().pending).toBe(true);
    sent[0]?.answer(json({ order, accessToken: TOKEN }, 201));
    expect(await first).toMatchObject({ kind: "placed", href: `/uk/order/7K3M-9QX2#t=${TOKEN}` });
  });

  it("replays a lost 201 with the SAME key; the API's 200 brings back the same order and token", async () => {
    const { calls, checkout } = await setup();
    const first = checkout.submit(values(), { signedIn: false });
    // The server committed the order, but the answer never arrived (connection reset).
    (await sentCheckouts(calls, 1))[0]?.fail(new TypeError("Failed to fetch"));
    expect(await first).toMatchObject({
      kind: "retry",
      attempt: "keep",
      failure: { messageKey: "errors.network" },
    });
    expect(checkout.getState().pending).toBe(false);

    const again = checkout.submit(values(), { signedIn: false });
    const sent = await sentCheckouts(calls, 2);
    expect(keyOf(sent[1])).toBe(keyOf(sent[0]));
    sent[1]?.answer(json({ order, accessToken: TOKEN }, 200));
    expect(await again).toMatchObject({
      kind: "placed",
      replay: true,
      href: `/uk/order/7K3M-9QX2#t=${TOKEN}`,
    });
  });

  it("keeps the key for a 5xx, a 503 and a 429 and sends it again with the same body", async () => {
    for (const answer of [
      problem(500, "internal_error"),
      problem(503, "service_unavailable", {}, { "Retry-After": "3" }),
      problem(429, "too_many_requests", {}, { "Retry-After": "60" }),
    ]) {
      const { calls, checkout } = await setup();
      const first = checkout.submit(values(), { signedIn: false });
      (await sentCheckouts(calls, 1))[0]?.answer(answer);
      expect((await first).kind).toMatch(/^(retry|rateLimited)$/);
      void checkout.submit(values(), { signedIn: false });
      const sent = await sentCheckouts(calls, 2);
      expect(keyOf(sent[1])).toBe(keyOf(sent[0]));
    }
  });

  it("uses a new key when the shopper changes the email after a failure", async () => {
    const { calls, checkout } = await setup();
    const first = checkout.submit(values(), { signedIn: false });
    (await sentCheckouts(calls, 1))[0]?.fail(new TypeError("offline"));
    await first;
    void checkout.submit(values({ email: "typo-fixed@example.test" }), { signedIn: false });
    const sent = await sentCheckouts(calls, 2);
    expect(keyOf(sent[1])).not.toBe(keyOf(sent[0]));
  });

  it("clears the attempt after an order was placed, and reads the cart again (the badge empties)", async () => {
    const { calls, checkout, map } = await setup();
    const placed = checkout.submit(values(), { signedIn: false });
    const [request] = await sentCheckouts(calls, 1);
    expect(map.has(ATTEMPT_STORAGE_KEY)).toBe(true);
    request?.answer(json({ order, accessToken: TOKEN }, 201));
    await placed;
    expect(map.has(ATTEMPT_STORAGE_KEY)).toBe(false);
    expect(calls.filter((call) => call.url.startsWith("/store/cart"))).toHaveLength(2);
    // The page is leaving: the form stays disabled.
    expect(checkout.getState().pending).toBe(true);
  });

  it("rethrows an aborted request or a bug, and frees the form (never a silent failure)", async () => {
    const { calls, checkout } = await setup();
    const first = checkout.submit(values(), { signedIn: false });
    (await sentCheckouts(calls, 1))[0]?.fail(new DOMException("stop", "AbortError"));
    await expect(first).rejects.toBeInstanceOf(NetworkError);
    expect(checkout.getState().pending).toBe(false);
  });
});

describe("checkout store: the total the shopper sees", () => {
  it("sends the total of the MOST RECENT cart in the store, not the one the page opened with", async () => {
    const { calls, cart, checkout } = await setup();
    cart.applyCart(cartB);
    void checkout.submit(values(), { signedIn: false });
    expect((await sentCheckouts(calls, 1))[0]?.body).toMatchObject({
      expectedTotal: { amount: 3998, currency: "UAH" },
    });
  });

  it("409 cart_changed: the fresh cart replaces the store's, submit is blocked until the new total is confirmed, then a NEW key", async () => {
    const { calls, cart, checkout } = await setup();
    const first = checkout.submit(values(), { signedIn: false });
    (await sentCheckouts(calls, 1))[0]?.answer(problem(409, "cart_changed", { cart: cartB }));
    expect(await first).toMatchObject({ kind: "cartChanged" });
    expect(cart.getState().cart).toEqual(cartB);
    expect(checkout.getState().needsConfirmation).toBe(true);
    expect(checkoutBlock(cart.getState().cart, checkout.getState())).toBe("confirmTotal");

    expect(await checkout.submit(values(), { signedIn: false })).toEqual({
      kind: "blocked",
      reason: "confirmTotal",
    });
    expect(checkoutCalls(calls)).toHaveLength(1);

    checkout.confirmTotal();
    expect(checkout.getState().needsConfirmation).toBe(false);
    void checkout.submit(values(), { signedIn: false });
    const sent = await sentCheckouts(calls, 2);
    expect(sent[1]?.body).toMatchObject({ expectedTotal: { amount: 3998, currency: "UAH" } });
    expect(keyOf(sent[1])).not.toBe(keyOf(sent[0]));
  });

  it("blocks while a line has a price_changed notice; acknowledging (POST /store/cart/acknowledge) unblocks", async () => {
    const changed = cartOf(
      [
        cartLine("a", {
          notices: [{ code: "price_changed", previousAmount: { amount: 1500, currency: "UAH" } }],
        }),
      ],
      { total: { amount: 1999, currency: "UAH" } },
    );
    const { calls, cart, checkout } = await setup({ cart: changed });
    expect(await checkout.submit(values(), { signedIn: false })).toEqual({
      kind: "blocked",
      reason: "pricesChanged",
    });
    const acknowledged = checkout.acknowledge();
    await settle();
    const ack = calls.find((call) => call.url.startsWith("/store/cart/acknowledge"));
    expect(ack?.method).toBe("POST");
    ack?.answer(json(cartA));
    await acknowledged;
    expect(cart.getState().cart).toEqual(cartA);
    expect(checkoutBlock(cart.getState().cart, checkout.getState())).toBeNull();
  });

  it("blocks an empty, unpurchasable or still loading cart without a request", async () => {
    expect(checkoutBlock(null, initialCheckoutState)).toBe("loading");
    expect(checkoutBlock(cartOf([]), initialCheckoutState)).toBe("empty");
    expect(
      checkoutBlock(cartOf([cartLine("a")], { purchasable: false }), initialCheckoutState),
    ).toBe("notPurchasable");
    const { calls, checkout } = await setup({
      cart: cartOf([cartLine("a")], { purchasable: false }),
    });
    expect(await checkout.submit(values(), { signedIn: false })).toEqual({
      kind: "blocked",
      reason: "notPurchasable",
    });
    expect(checkoutCalls(calls)).toHaveLength(0);
  });
});

describe("checkout store: the other outcomes", () => {
  async function answered(response: Response, signedIn = false) {
    const context = await setup();
    const result = context.checkout.submit(values(), { signedIn });
    (await sentCheckouts(context.calls, 1))[0]?.answer(response);
    return { ...context, outcome: await result };
  }

  it("checkout_refused keeps the lines' errors for the cart they belong to", async () => {
    const { outcome, checkout, cart } = await answered(
      problem(409, "checkout_refused", {
        errors: [{ path: "lines.0", code: "insufficient_stock" }],
      }),
    );
    expect(outcome.kind).toBe("refused");
    expect(checkout.getState().lineErrors).toEqual({
      cart: cart.getState().cart,
      errors: [
        { index: 0, code: "insufficient_stock", messageKey: "errors.field.insufficient_stock" },
      ],
    });
  });

  it("cart_empty and idempotency_key_reused clear the attempt; cart_empty also reads the cart", async () => {
    const empty = await answered(problem(409, "cart_empty"));
    expect(empty.outcome).toMatchObject({ kind: "cartEmpty", href: "/uk/cart" });
    expect(empty.map.has(ATTEMPT_STORAGE_KEY)).toBe(false);
    expect(empty.calls.filter((call) => call.url.startsWith("/store/cart"))).toHaveLength(2);
    const reused = await answered(problem(409, "idempotency_key_reused"));
    expect(reused.outcome.kind).toBe("keyReused");
    expect(reused.map.has(ATTEMPT_STORAGE_KEY)).toBe(false);
    expect(reused.checkout.getState().pending).toBe(false);
  });

  it("too_many_open_orders keeps the attempt and links customers to their orders", async () => {
    const { outcome, map } = await answered(problem(409, "too_many_open_orders"), true);
    expect(outcome).toMatchObject({ kind: "tooManyOpenOrders", ordersHref: "/uk/account/orders" });
    expect(map.has(ATTEMPT_STORAGE_KEY)).toBe(true);
  });

  it("refuses to submit without a secure context and says why (no request, no weak key)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, checkout } = await setup({ insecure: true });
    expect(await checkout.submit(values(), { signedIn: false })).toMatchObject({
      kind: "insecure",
      failure: { messageKey: "checkout.error.insecureContext" },
    });
    expect(checkoutCalls(calls)).toHaveLength(0);
    expect(checkout.getState().insecure).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("prepare() finds a missing secure context when the page opens, before any submit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const insecure = await setup({ insecure: true });
    insecure.checkout.prepare();
    expect(insecure.checkout.getState().insecure).toBe(true);
    const secure = await setup();
    secure.checkout.prepare();
    expect(secure.checkout.getState()).toEqual(initialCheckoutState);
  });

  it("reports when the attempt could not be kept in sessionStorage (private mode): the page warns, the key still works", async () => {
    const { calls, checkout } = await setup({ storage: null });
    const first = checkout.submit(values(), { signedIn: false });
    const [request] = await sentCheckouts(calls, 1);
    expect(checkout.getState().attemptPersistent).toBe(false);
    request?.fail(new TypeError("offline"));
    await first;
    void checkout.submit(values(), { signedIn: false });
    const sent = await sentCheckouts(calls, 2);
    expect(keyOf(sent[1])).toBe(keyOf(sent[0]));
  });
});

describe("checkout store: the guest token stays a secret", () => {
  it("never puts the token in a request URL or a console call", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => {}),
    );
    const { calls, checkout } = await setup();
    const placed = checkout.submit(values(), { signedIn: false });
    (await sentCheckouts(calls, 1))[0]?.answer(json({ order, accessToken: TOKEN }, 201));
    await placed;
    await settle();
    for (const call of calls) expect(call.url).not.toContain(TOKEN);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(checkout.getState())).not.toContain(TOKEN);
  });
});
