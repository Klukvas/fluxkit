import { NetworkError } from "@fluxkit/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutConfig } from "../config/checkout";
import { createCartStore } from "./cart-store";
import { createShippingStore } from "./shipping-store";
import type { ShippingOptions } from "@fluxkit/api-client";
import {
  ATTEMPT_STORAGE_KEY,
  InsecureContextError,
  createAttemptManager,
  webAttemptCrypto,
  type AttemptStorage,
} from "./checkout-attempt";
import { initialCheckoutValues, type CheckoutValues } from "./checkout-form";
import { checkoutBlock, createCheckoutStore, initialCheckoutState } from "./checkout-store";
import { cartLine, cartOf, shippingOption, shippingOptionsOf } from "./test-fixtures";
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

const NONE = { kind: "none" } as const;
const NO_METHODS: ShippingOptions = { subtotal: { amount: 1999, currency: "UAH" }, options: [] };

async function setup(
  options: {
    cart?: typeof cartA;
    storage?: AttemptStorage | null;
    insecure?: boolean;
    /** The answer of `GET /store/shipping/options`; the shop has no active method unless a test says otherwise. */
    shippingOptions?: ShippingOptions;
  } = {},
) {
  const { client, calls } = stagedClient();
  const cart = createCartStore({ client, locale: "uk", events: new EventTarget() });
  const shipping = createShippingStore({ client, cart, locale: "uk" });
  const memory = memoryStorage();
  const storage = options.storage === undefined ? memory.storage : options.storage;
  const checkout = createCheckoutStore({
    client,
    cart,
    shipping,
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
  void shipping.read({ country: "UA", cityRef: "", pickupPointRef: "" });
  await settle();
  optionCalls(calls)[0]?.answer(json(options.shippingOptions ?? NO_METHODS));
  await settle();
  return { client, calls, cart, shipping, checkout, map: memory.map };
}

const optionCalls = (calls: PendingCall[]) =>
  calls.filter((call) => call.url.startsWith("/store/shipping/options"));

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

  it("a request that hits the time limit frees the form, says so, and the retry sends the SAME key (review M1)", async () => {
    const { calls, checkout, map } = await setup();
    const first = checkout.submit(values(), { signedIn: false });
    const [hung] = await sentCheckouts(calls, 1);
    const key = keyOf(hung);
    // What `fetch` rejects with when `AbortSignal.timeout` fires.
    hung?.fail(new DOMException("The operation timed out.", "TimeoutError"));
    expect(await first).toMatchObject({
      kind: "retry",
      attempt: "keep",
      failure: { messageKey: "errors.timeout" },
    });
    expect(checkout.getState().pending).toBe(false);
    expect(map.has(ATTEMPT_STORAGE_KEY)).toBe(true);

    void checkout.submit(values(), { signedIn: false });
    const sent = await sentCheckouts(calls, 2);
    expect(keyOf(sent[1])).toBe(key);
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
    expect(checkoutBlock(cart.getState().cart, checkout.getState(), NONE)).toBe("confirmTotal");

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
    expect(checkoutBlock(cart.getState().cart, checkout.getState(), NONE)).toBeNull();
  });

  it("blocks an empty, unpurchasable or still loading cart without a request", async () => {
    expect(checkoutBlock(null, initialCheckoutState, NONE)).toBe("loading");
    expect(checkoutBlock(cartOf([]), initialCheckoutState, NONE)).toBe("empty");
    expect(
      checkoutBlock(cartOf([cartLine("a")], { purchasable: false }), initialCheckoutState, NONE),
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

// ------------------------------------------------------------------ shipping (plan step 10)

const COURIER = shippingOption("courier", {
  title: "Courier",
  price: { amount: 5000, currency: "UAH" },
  // Not the sum of anything in this file: the browser must send exactly this.
  total: { amount: 7001, currency: "UAH" },
});
const POINT = shippingOption("branch", {
  kind: "pickup_point",
  providerCode: "fake",
  total: { amount: 6500, currency: "UAH" },
  price: { amount: 4501, currency: "UAH" },
});
const PICKUP = shippingOption("store", {
  kind: "store_pickup",
  description: "Open 9 to 18",
  price: { amount: 0, currency: "UAH" },
  total: { amount: 1999, currency: "UAH" },
});
const withMethods = (...list: ReturnType<typeof shippingOption>[]) => ({
  shippingOptions: shippingOptionsOf(list),
});
const choose = (code: string, extra: Partial<CheckoutValues> = {}) =>
  values({ "shipping.methodCode": code, ...extra });

describe("checkout store: no active shipping method behaves exactly as before", () => {
  it("sends the cart's total, no shipping member and today's address", async () => {
    const { calls, checkout } = await setup();
    void checkout.submit(values(), { signedIn: false });
    const [request] = await sentCheckouts(calls, 1);
    expect(request?.body).toEqual({
      email: "guest@example.test",
      phone: "+380441234567",
      firstName: "Ada",
      lastName: "Guest",
      locale: "uk",
      shippingAddress: { countryCode: "UA", city: "Kyiv", line1: "Street 1" },
      expectedTotal: { amount: 1999, currency: "UAH" },
    });
    expect(request?.body).not.toHaveProperty("shipping");
  });

  it("is not held up by a newer options read while the shop has no method", async () => {
    const { calls, checkout, shipping } = await setup();
    void shipping.refresh();
    await settle();
    void checkout.submit(values(), { signedIn: false });
    expect(await sentCheckouts(calls, 1)).toHaveLength(1);
  });

  it("a cart that ships nothing sends no shipping member even when the shop has methods", async () => {
    const digital = cartOf([cartLine("d")], { requiresShipping: false });
    const { calls, checkout } = await setup({ cart: digital, ...withMethods(COURIER) });
    void checkout.submit(choose("courier"), { signedIn: false });
    const [request] = await sentCheckouts(calls, 1);
    expect(request?.body).not.toHaveProperty("shipping");
    expect(request?.body).not.toHaveProperty("shippingAddress");
    expect(request?.body).toMatchObject({ expectedTotal: { amount: 1999, currency: "UAH" } });
  });
});

describe("checkout store: the expected total of an order that ships", () => {
  it("is the SERVER's total of the chosen option, not the cart's total", async () => {
    const { calls, checkout } = await setup(withMethods(COURIER, POINT));
    void checkout.submit(choose("courier"), { signedIn: false });
    const [request] = await sentCheckouts(calls, 1);
    expect(request?.body).toMatchObject({
      expectedTotal: { amount: 7001, currency: "UAH" },
      shipping: { methodCode: "courier" },
      shippingAddress: { countryCode: "UA", city: "Kyiv", line1: "Street 1" },
    });
  });

  it("follows the chosen option: another method sends its own total", async () => {
    const { calls, checkout } = await setup(withMethods(COURIER, POINT));
    void checkout.submit(
      choose("branch", { "shipping.cityRef": "c1", "shipping.pickupPointRef": "p1" }),
      { signedIn: false },
    );
    const [request] = await sentCheckouts(calls, 1);
    expect((request?.body as { expectedTotal: unknown }).expectedTotal).toEqual({
      amount: 6500,
      currency: "UAH",
    });
  });

  it("a pickup point sends the point's ref and NO address (the API refuses both)", async () => {
    const { calls, checkout } = await setup(withMethods(POINT));
    void checkout.submit(
      choose("branch", { "shipping.cityRef": "c1", "shipping.pickupPointRef": "p1" }),
      { signedIn: false },
    );
    const [request] = await sentCheckouts(calls, 1);
    expect((request?.body as { shipping: unknown }).shipping).toEqual({
      methodCode: "branch",
      pickupPointRef: "p1",
    });
    expect(request?.body).not.toHaveProperty("shippingAddress");
  });

  it("a store pickup sends no address and no point", async () => {
    const { calls, checkout } = await setup(withMethods(PICKUP));
    void checkout.submit(choose("store"), { signedIn: false });
    const [request] = await sentCheckouts(calls, 1);
    expect((request?.body as { shipping: unknown }).shipping).toEqual({ methodCode: "store" });
    expect(request?.body).not.toHaveProperty("shippingAddress");
    expect(request?.body).toMatchObject({ expectedTotal: { amount: 1999, currency: "UAH" } });
  });

  it("a point ref left over from another method is not sent with an address method", async () => {
    const { calls, checkout } = await setup(withMethods(COURIER, POINT));
    void checkout.submit(choose("courier", { "shipping.pickupPointRef": "old" }), {
      signedIn: false,
    });
    const [request] = await sentCheckouts(calls, 1);
    expect((request?.body as { shipping: unknown }).shipping).toEqual({ methodCode: "courier" });
  });
});

describe("checkout store: no request until the delivery is known", () => {
  async function blockedWith(state: Parameters<typeof setup>[0], codes: string) {
    const { calls, checkout } = await setup(state);
    const result = await checkout.submit(choose(codes), { signedIn: false });
    expect(checkoutCalls(calls)).toHaveLength(0);
    return result;
  }

  it("blocks without a chosen method", async () => {
    const { calls, checkout } = await setup(withMethods(COURIER));
    expect(await checkout.submit(values(), { signedIn: false })).toEqual({
      kind: "blocked",
      reason: "shippingMethod",
    });
    expect(checkoutCalls(calls)).toHaveLength(0);
  });

  it("blocks a method the options do not offer, and one that is unavailable", async () => {
    expect(await blockedWith(withMethods(COURIER), "gone")).toEqual({
      kind: "blocked",
      reason: "shippingMethod",
    });
    const down = shippingOption("courier", {
      available: false,
      reason: "country_not_served",
      price: null,
      total: null,
      payer: null,
    });
    expect(await blockedWith(withMethods(down), "courier")).toEqual({
      kind: "blocked",
      reason: "shippingMethod",
    });
  });

  it("blocks while the options are being read again, then sends the NEW price", async () => {
    const { calls, checkout, shipping } = await setup(withMethods(COURIER));
    void shipping.refresh();
    await settle();
    expect(await checkout.submit(choose("courier"), { signedIn: false })).toEqual({
      kind: "blocked",
      reason: "shippingLoading",
    });
    expect(checkoutCalls(calls)).toHaveLength(0);
    optionCalls(calls)[1]?.answer(
      json(shippingOptionsOf([{ ...COURIER, total: { amount: 7100, currency: "UAH" } }])),
    );
    await settle();
    void checkout.submit(choose("courier"), { signedIn: false });
    expect((await sentCheckouts(calls, 1))[0]?.body).toMatchObject({
      expectedTotal: { amount: 7100, currency: "UAH" },
    });
  });

  it("blocks after a failed read of the options (nothing is sent on an old price)", async () => {
    const { calls, checkout, shipping } = await setup(withMethods(COURIER));
    void shipping.refresh();
    await settle();
    optionCalls(calls)[1]?.fail(new TypeError("offline"));
    await settle();
    expect(await checkout.submit(choose("courier"), { signedIn: false })).toEqual({
      kind: "blocked",
      reason: "shippingError",
    });
    expect(checkoutCalls(calls)).toHaveLength(0);
  });
});

describe("checkout store: 409 shipping_changed asks for consent, it never resubmits", () => {
  const dearer = {
    ...COURIER,
    total: { amount: 7501, currency: "UAH" },
    price: { amount: 5500, currency: "UAH" },
  };

  async function changed() {
    const context = await setup(withMethods(COURIER));
    const first = context.checkout.submit(choose("courier"), { signedIn: false });
    (await sentCheckouts(context.calls, 1))[0]?.answer(
      problem(409, "shipping_changed", { shipping: dearer }),
    );
    const outcome = await first;
    return { ...context, outcome };
  }

  it("re-reads the options, remembers what the shopper agreed to, and blocks the submit", async () => {
    const { outcome, calls, checkout } = await changed();
    expect(outcome).toMatchObject({ kind: "shippingChanged", attempt: "keep" });
    expect(checkout.getState().pending).toBe(false);
    expect(checkout.getState().shippingConsent).toEqual({
      methodCode: "courier",
      previousTotal: { amount: 7001, currency: "UAH" },
      previousPrice: { amount: 5000, currency: "UAH" },
    });
    // The options were read again at once.
    expect(optionCalls(calls)).toHaveLength(2);
    // Nothing is resubmitted while the new price is unknown or unconfirmed.
    expect(await checkout.submit(choose("courier"), { signedIn: false })).toEqual({
      kind: "blocked",
      reason: "shippingLoading",
    });
    expect(checkoutCalls(calls)).toHaveLength(1);
  });

  it("after the fresh price arrives it still waits for the shopper's confirmation", async () => {
    const { calls, checkout, shipping } = await changed();
    optionCalls(calls)[1]?.answer(json(shippingOptionsOf([dearer])));
    await settle();
    expect(shipping.getState().answer?.options[0]?.total).toEqual({
      amount: 7501,
      currency: "UAH",
    });
    expect(await checkout.submit(choose("courier"), { signedIn: false })).toEqual({
      kind: "blocked",
      reason: "confirmShipping",
    });
    expect(checkoutCalls(calls)).toHaveLength(1);
  });

  it("after the confirmation it sends the NEW total with a NEW key", async () => {
    const { calls, checkout } = await changed();
    optionCalls(calls)[1]?.answer(json(shippingOptionsOf([dearer])));
    await settle();
    checkout.confirmShipping();
    expect(checkout.getState().shippingConsent).toBeNull();
    void checkout.submit(choose("courier"), { signedIn: false });
    const sent = await sentCheckouts(calls, 2);
    expect(sent[1]?.body).toMatchObject({ expectedTotal: { amount: 7501, currency: "UAH" } });
    expect(keyOf(sent[1])).not.toBe(keyOf(sent[0]));
  });

  it("when the method is not offered any more there is nothing to confirm: choose another", async () => {
    const { calls, checkout } = await changed();
    optionCalls(calls)[1]?.answer(
      json(
        shippingOptionsOf([
          shippingOption("courier", {
            available: false,
            reason: "inactive",
            price: null,
            total: null,
            payer: null,
          }),
          POINT,
        ]),
      ),
    );
    await settle();
    expect(await checkout.submit(choose("courier"), { signedIn: false })).toEqual({
      kind: "blocked",
      reason: "shippingMethod",
    });
    // Another method can be ordered at once; the old consent is not asked about it.
    void checkout.submit(
      choose("branch", { "shipping.cityRef": "c1", "shipping.pickupPointRef": "p1" }),
      { signedIn: false },
    );
    const sent = await sentCheckouts(calls, 2);
    expect(sent[1]?.body).toMatchObject({ expectedTotal: { amount: 6500, currency: "UAH" } });
  });

  it("a consent for one method is not asked again for another one the shopper switches to", async () => {
    const { calls, checkout } = await changed();
    optionCalls(calls)[1]?.answer(json(shippingOptionsOf([dearer, POINT])));
    await settle();
    checkout.forgetShippingConsent();
    expect(checkout.getState().shippingConsent).toBeNull();
    void checkout.submit(
      choose("branch", { "shipping.cityRef": "c1", "shipping.pickupPointRef": "p1" }),
      { signedIn: false },
    );
    expect(await sentCheckouts(calls, 2)).toHaveLength(2);
  });

  it("a second change after the confirmation asks again", async () => {
    const { calls, checkout } = await changed();
    optionCalls(calls)[1]?.answer(json(shippingOptionsOf([dearer])));
    await settle();
    checkout.confirmShipping();
    const second = checkout.submit(choose("courier"), { signedIn: false });
    const evenDearer = { ...dearer, total: { amount: 8000, currency: "UAH" } };
    (await sentCheckouts(calls, 2))[1]?.answer(
      problem(409, "shipping_changed", { shipping: evenDearer }),
    );
    expect((await second).kind).toBe("shippingChanged");
    expect(checkout.getState().shippingConsent).toMatchObject({
      previousTotal: { amount: 7501, currency: "UAH" },
    });
  });
});

describe("checkout store: the other answers of a delivery checkout", () => {
  it("409 cart_changed keeps today's handling and also reads the options again", async () => {
    const { calls, cart, checkout } = await setup(withMethods(COURIER));
    const first = checkout.submit(choose("courier"), { signedIn: false });
    (await sentCheckouts(calls, 1))[0]?.answer(problem(409, "cart_changed", { cart: cartB }));
    expect(await first).toMatchObject({ kind: "cartChanged" });
    expect(cart.getState().cart).toEqual(cartB);
    expect(checkout.getState().needsConfirmation).toBe(true);
    expect(optionCalls(calls)).toHaveLength(2);
  });

  it("503 shipping_provider_unavailable keeps the key: the same body can be sent again, or another method chosen", async () => {
    const { calls, checkout } = await setup(withMethods(POINT, COURIER));
    const pointValues = choose("branch", {
      "shipping.cityRef": "c1",
      "shipping.pickupPointRef": "p1",
    });
    const first = checkout.submit(pointValues, { signedIn: false });
    (await sentCheckouts(calls, 1))[0]?.answer(
      problem(503, "shipping_provider_unavailable", {}, { "Retry-After": "30" }),
    );
    expect(await first).toMatchObject({
      kind: "shippingProviderUnavailable",
      attempt: "keep",
      failure: { messageKey: "errors.shipping_provider_unavailable", retryAfterSeconds: 30 },
    });
    expect(checkout.getState().pending).toBe(false);
    void checkout.submit(pointValues, { signedIn: false });
    void (await sentCheckouts(calls, 2));
    const [one, two] = checkoutCalls(calls);
    expect(keyOf(two)).toBe(keyOf(one));
  });

  it("400 shipping_method_required and shipping_not_applicable read the options again", async () => {
    for (const code of ["shipping_method_required", "shipping_not_applicable"]) {
      const { calls, checkout } = await setup();
      const first = checkout.submit(values(), { signedIn: false });
      (await sentCheckouts(calls, 1))[0]?.answer(problem(400, code));
      expect(await first).toMatchObject({ kind: "shippingRejected", attempt: "keep" });
      expect(optionCalls(calls)).toHaveLength(2);
    }
  });

  it("400 unknown_pickup_point lands on the point field and keeps the key", async () => {
    const { calls, checkout } = await setup(withMethods(POINT));
    const first = checkout.submit(
      choose("branch", { "shipping.cityRef": "c1", "shipping.pickupPointRef": "p1" }),
      { signedIn: false },
    );
    (await sentCheckouts(calls, 1))[0]?.answer(
      problem(400, "validation_failed", {
        errors: [{ path: "shipping.pickupPointRef", code: "unknown_pickup_point" }],
      }),
    );
    expect(await first).toMatchObject({
      kind: "invalid",
      failure: {
        fieldErrors: [
          {
            path: "shipping.pickupPointRef",
            code: "unknown_pickup_point",
            messageKey: "errors.field.unknown_pickup_point",
          },
        ],
      },
    });
  });
});

describe("checkout store: the attempt key follows the whole body, shipping included", () => {
  async function keys(...submits: CheckoutValues[]) {
    const { calls, checkout } = await setup(withMethods(COURIER, POINT, PICKUP));
    const found: (string | null | undefined)[] = [];
    for (const [index, submit] of submits.entries()) {
      const outcome = checkout.submit(submit, { signedIn: false });
      const sent = await sentCheckouts(calls, index + 1);
      found.push(keyOf(sent[index]));
      sent[index]?.fail(new TypeError("offline"));
      await outcome;
    }
    return found;
  }
  const point = (ref: string) =>
    choose("branch", { "shipping.cityRef": "c1", "shipping.pickupPointRef": ref });

  it("reuses the key for the same delivery choice (a retry is one attempt)", async () => {
    const [one, two] = await keys(choose("courier"), choose("courier"));
    expect(one).toBeDefined();
    expect(two).toBe(one);
  });

  it("uses a new key when the method, the point or the total changes", async () => {
    const [courier, branch1, branch2, store] = await keys(
      choose("courier"),
      point("p1"),
      point("p2"),
      choose("store"),
    );
    expect(new Set([courier, branch1, branch2, store]).size).toBe(4);
  });

  it("uses a new key when only the price of the same method changed", async () => {
    const { calls, checkout, shipping } = await setup(withMethods(COURIER));
    const first = checkout.submit(choose("courier"), { signedIn: false });
    const [one] = await sentCheckouts(calls, 1);
    one?.fail(new TypeError("offline"));
    await first;
    void shipping.refresh();
    await settle();
    optionCalls(calls)[1]?.answer(
      json(shippingOptionsOf([{ ...COURIER, total: { amount: 7002, currency: "UAH" } }])),
    );
    await settle();
    void checkout.submit(choose("courier"), { signedIn: false });
    const sent = await sentCheckouts(calls, 2);
    expect(keyOf(sent[1])).not.toBe(keyOf(sent[0]));
  });
});
