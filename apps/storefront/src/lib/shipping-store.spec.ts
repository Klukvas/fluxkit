import { NetworkError } from "@fluxkit/api-client";
import { describe, expect, it, vi } from "vitest";
import { createCartStore } from "./cart-store";
import { createShippingStore, type ShippingReadParams } from "./shipping-store";
import { cartLine, cartOf, shippingOption, shippingOptionsOf } from "./test-fixtures";
import { json, problem, settle, stagedClient, type PendingCall } from "./test-fetch";

const PARAMS: ShippingReadParams = { country: "UA", cityRef: "", pickupPointRef: "" };
const optionCalls = (calls: PendingCall[]) =>
  calls.filter((call) => call.url.startsWith("/store/shipping/options"));

async function setup() {
  const { client, calls } = stagedClient();
  const cart = createCartStore({ client, locale: "uk", events: new EventTarget() });
  cart.start();
  calls[0]?.answer(json(cartOf([cartLine("a")])));
  await settle();
  const shipping = createShippingStore({ client, cart, locale: "uk" });
  return { calls, cart, shipping };
}

describe("shipping store: reading the options", () => {
  it("sends the locale and only the parameters that are given, as a no-store GET", async () => {
    const { calls, shipping } = await setup();
    void shipping.read({ country: "UA", cityRef: "", pickupPointRef: "" });
    await settle();
    const [call] = optionCalls(calls);
    expect(call?.method).toBe("GET");
    expect(call?.url).toBe("/store/shipping/options?country=UA&locale=uk");
    expect(call?.init.cache).toBe("no-store");
    void shipping.read({ country: "UA", cityRef: "c1", pickupPointRef: "p1" });
    await settle();
    expect(optionCalls(calls)[1]?.url).toBe(
      "/store/shipping/options?country=UA&locale=uk&cityRef=c1&pickupPointRef=p1",
    );
  });

  it("keeps the server's answer as it is and marks the read pending only while it runs", async () => {
    const { calls, shipping } = await setup();
    expect(shipping.getState().started).toBe(false);
    const done = shipping.read(PARAMS);
    await settle();
    expect(shipping.getState()).toMatchObject({ started: true, pending: true, answer: null });
    const answer = shippingOptionsOf([shippingOption("courier")]);
    optionCalls(calls)[0]?.answer(json(answer));
    await done;
    expect(shipping.getState()).toMatchObject({ pending: false, answer, failure: null });
  });

  it("applies only the newest read: a slow older answer cannot show an old price", async () => {
    const { calls, shipping } = await setup();
    const first = shipping.read(PARAMS);
    const second = shipping.read({ ...PARAMS, country: "PL" });
    await settle();
    const [older, newer] = optionCalls(calls);
    const fresh = shippingOptionsOf([
      shippingOption("courier", { total: { amount: 2, currency: "UAH" } }),
    ]);
    newer?.answer(json(fresh));
    await second;
    older?.answer(
      json(
        shippingOptionsOf([shippingOption("courier", { total: { amount: 1, currency: "UAH" } })]),
      ),
    );
    await first;
    expect(shipping.getState().answer).toEqual(fresh);
    expect(shipping.getState().pending).toBe(false);
  });

  it("keeps the previous answer for display after a failed read and says so; the next success clears it", async () => {
    const { calls, shipping } = await setup();
    const answer = shippingOptionsOf([shippingOption("courier")]);
    const first = shipping.read(PARAMS);
    await settle();
    optionCalls(calls)[0]?.answer(json(answer));
    await first;
    const second = shipping.refresh();
    await settle();
    optionCalls(calls)[1]?.answer(problem(429, "too_many_requests", {}, { "Retry-After": "7" }));
    await second;
    expect(shipping.getState()).toMatchObject({
      answer,
      pending: false,
      failure: { status: 429, messageKey: "errors.too_many_requests", retryAfterSeconds: 7 },
    });
    const third = shipping.refresh();
    await settle();
    optionCalls(calls)[2]?.answer(json(answer));
    await third;
    expect(shipping.getState().failure).toBeNull();
  });

  it("a network failure is a failure value, an aborted request is a bug and is rethrown", async () => {
    const { calls, shipping } = await setup();
    const failed = shipping.read(PARAMS);
    await settle();
    optionCalls(calls)[0]?.fail(new TypeError("offline"));
    await failed;
    expect(shipping.getState().failure?.messageKey).toBe("errors.network");
    const aborted = shipping.refresh();
    await settle();
    optionCalls(calls)[1]?.fail(new DOMException("stop", "AbortError"));
    await expect(aborted).rejects.toBeInstanceOf(NetworkError);
    expect(shipping.getState().pending).toBe(false);
  });

  it("does nothing on refresh() before the first read", async () => {
    const { calls, shipping } = await setup();
    await shipping.refresh();
    expect(optionCalls(calls)).toHaveLength(0);
    expect(shipping.getState().started).toBe(false);
  });
});

describe("shipping store: following the cart", () => {
  it("reads again in the same notification in which the cart changes, so the old price is never shown with the new cart", async () => {
    const { calls, cart, shipping } = await setup();
    const first = shipping.read(PARAMS);
    await settle();
    optionCalls(calls)[0]?.answer(json(shippingOptionsOf([shippingOption("courier")])));
    await first;
    const seen: boolean[] = [];
    shipping.subscribe(() => seen.push(shipping.getState().pending));
    cart.applyCart(cartOf([cartLine("a", { quantity: 2 })]));
    // pending was already true when the cart store's listeners had run: no gap.
    expect(shipping.getState().pending).toBe(true);
    expect(seen[0]).toBe(true);
    await settle();
    expect(optionCalls(calls)).toHaveLength(2);
  });

  it("does not follow the cart before the first read, and stops after dispose()", async () => {
    const { calls, cart, shipping } = await setup();
    cart.applyCart(cartOf([cartLine("a", { quantity: 2 })]));
    await settle();
    expect(optionCalls(calls)).toHaveLength(0);
    void shipping.read(PARAMS);
    await settle();
    shipping.dispose();
    cart.applyCart(cartOf([cartLine("a", { quantity: 3 })]));
    await settle();
    expect(optionCalls(calls)).toHaveLength(1);
  });

  it("ignores a cart notification that carries the same cart", async () => {
    const { calls, cart, shipping } = await setup();
    void shipping.read(PARAMS);
    await settle();
    const listener = vi.fn();
    shipping.subscribe(listener);
    // A busy flag or a failure of the cart store changes its state, not its cart.
    cart.dismissFailure();
    await settle();
    expect(optionCalls(calls)).toHaveLength(1);
  });
});
