import { describe, expect, it } from "vitest";
import { failureFromThrown } from "./failure";
import { NetworkError } from "@fluxkit/api-client";
import {
  PICKUP_KINDS,
  SHIPMENT_STATUSES,
  UNAVAILABLE_REASONS,
  deliveryMode,
  deliveryPlan,
  initialShippingState,
  isDeliveryActive,
  isOrderable,
  countryToChoose,
  methodToChoose,
  servedCountries,
  type ShippingState,
} from "./shipping-model";
import { cartLine, cartOf, shippingOption, shippingOptionsOf } from "./test-fixtures";

const cart = cartOf([cartLine("a")], {
  subtotal: { amount: 1999, currency: "UAH" },
  total: { amount: 1999, currency: "UAH" },
});

function readyState(
  options: ReturnType<typeof shippingOption>[],
  extra: Partial<ShippingState> = {},
) {
  return {
    ...initialShippingState,
    started: true,
    answer: shippingOptionsOf(options),
    appliedSeq: 1,
    ...extra,
  } satisfies ShippingState;
}

describe("deliveryPlan: where the expected total comes from", () => {
  it("sends the SERVER's total of the chosen option, never the cart's total and never a sum", () => {
    // The numbers are chosen so that no sum of the cart and the price gives the option's total.
    const option = shippingOption("courier", {
      price: { amount: 5000, currency: "UAH" },
      total: { amount: 7777, currency: "UAH" },
    });
    const plan = deliveryPlan(cart, readyState([option]), "courier");
    expect(plan).toEqual({ kind: "ship", option, total: { amount: 7777, currency: "UAH" } });
  });

  it("is EXACTLY today's checkout when the shop has no active method (an empty options list)", () => {
    expect(deliveryPlan(cart, readyState([]), "")).toEqual({ kind: "none" });
    // A leftover selection changes nothing: there is nothing to choose.
    expect(deliveryPlan(cart, readyState([]), "courier")).toEqual({ kind: "none" });
  });

  it("is today's checkout for a cart that ships nothing, whatever the answer says", () => {
    const digital = cartOf([cartLine("d")], { requiresShipping: false });
    expect(deliveryPlan(digital, readyState([shippingOption("courier")]), "courier")).toEqual({
      kind: "none",
    });
    expect(deliveryPlan(digital, initialShippingState, "")).toEqual({ kind: "none" });
  });

  it("waits for the first answer (blocked: loading), started or not", () => {
    expect(deliveryPlan(cart, initialShippingState, "")).toEqual({
      kind: "blocked",
      reason: "loading",
    });
    expect(
      deliveryPlan(cart, { ...initialShippingState, started: true, pending: true }, ""),
    ).toEqual({ kind: "blocked", reason: "loading" });
  });

  it("does not trust a price while a newer read is in flight", () => {
    const state = readyState([shippingOption("courier")], { pending: true });
    expect(deliveryPlan(cart, state, "courier")).toEqual({ kind: "blocked", reason: "loading" });
  });

  it("does not block a shop without methods while a read is in flight (nothing to price)", () => {
    expect(deliveryPlan(cart, readyState([], { pending: true }), "")).toEqual({ kind: "none" });
  });

  it("blocks on a failed read, also when the older answer listed no method", () => {
    const failure = failureFromThrown(
      new NetworkError("offline", { cause: new TypeError("offline"), aborted: false }),
    );
    expect(deliveryPlan(cart, readyState([], { failure }), "")).toEqual({
      kind: "blocked",
      reason: "error",
    });
    expect(
      deliveryPlan(cart, readyState([shippingOption("courier")], { failure }), "courier"),
    ).toEqual({ kind: "blocked", reason: "error" });
  });

  it("asks to choose when no method is chosen, and refuses a code that is not offered", () => {
    const state = readyState([shippingOption("courier")]);
    expect(deliveryPlan(cart, state, "")).toEqual({ kind: "blocked", reason: "choose" });
    expect(deliveryPlan(cart, state, "gone")).toEqual({ kind: "blocked", reason: "unavailable" });
  });

  it("refuses an unavailable option (its total is null) and one without a total", () => {
    const unavailable = shippingOption("courier", {
      available: false,
      reason: "country_not_served",
      price: null,
      payer: null,
      total: null,
    });
    expect(deliveryPlan(cart, readyState([unavailable]), "courier")).toEqual({
      kind: "blocked",
      reason: "unavailable",
    });
    const broken = shippingOption("courier", { total: null });
    expect(deliveryPlan(cart, readyState([broken]), "courier")).toEqual({
      kind: "blocked",
      reason: "unavailable",
    });
  });

  it("a method paid to the carrier on delivery sends the server's total too (shipping 0 for the shop)", () => {
    const onDelivery = shippingOption("cod", {
      price: { amount: 0, currency: "UAH" },
      payer: "recipient_on_delivery",
      total: { amount: 1999, currency: "UAH" },
      estimate: { amount: 8800, currency: "UAH" },
    });
    expect(deliveryPlan(cart, readyState([onDelivery]), "cod")).toMatchObject({
      kind: "ship",
      total: { amount: 1999, currency: "UAH" },
    });
  });
});

describe("isOrderable", () => {
  it("needs available, a price and a total", () => {
    expect(isOrderable(shippingOption("a"))).toBe(true);
    expect(isOrderable(undefined)).toBe(false);
    expect(isOrderable(shippingOption("a", { available: false }))).toBe(false);
    expect(isOrderable(shippingOption("a", { price: null }))).toBe(false);
    expect(isOrderable(shippingOption("a", { total: null }))).toBe(false);
  });
});

describe("closed lists", () => {
  it("name every shipment status, pickup kind and unavailable reason of the API once", () => {
    expect(new Set(SHIPMENT_STATUSES).size).toBe(10);
    expect(PICKUP_KINDS).toEqual(["branch", "locker"]);
    expect(new Set(UNAVAILABLE_REASONS).size).toBe(7);
  });
});

describe("deliveryMode and isDeliveryActive", () => {
  const courier = shippingOption("courier");
  const point = shippingOption("branch", { kind: "pickup_point", providerCode: "fake" });
  const store = shippingOption("store", { kind: "store_pickup" });

  it("is none without methods, for a cart that ships nothing, and before the first answer", () => {
    expect(deliveryMode(cart, readyState([]), "")).toBe("none");
    expect(deliveryMode(cart, initialShippingState, "")).toBe("none");
    const digital = cartOf([cartLine("d")], { requiresShipping: false });
    expect(deliveryMode(digital, readyState([courier]), "courier")).toBe("none");
    expect(isDeliveryActive(cart, readyState([courier]))).toBe(true);
    expect(isDeliveryActive(cart, readyState([]))).toBe(false);
  });

  it("is the kind of the chosen orderable method, unchosen otherwise", () => {
    const state = readyState([courier, point, store]);
    expect(deliveryMode(cart, state, "courier")).toBe("address");
    expect(deliveryMode(cart, state, "branch")).toBe("pickup_point");
    expect(deliveryMode(cart, state, "store")).toBe("store_pickup");
    expect(deliveryMode(cart, state, "")).toBe("unchosen");
    expect(deliveryMode(cart, state, "gone")).toBe("unchosen");
    const down = shippingOption("courier", {
      available: false,
      reason: "inactive",
      total: null,
      price: null,
    });
    expect(deliveryMode(cart, readyState([down]), "courier")).toBe("unchosen");
  });
});

describe("servedCountries", () => {
  it("lists the countries of the address methods once, in order, ignoring pickup and store methods", () => {
    expect(
      servedCountries([
        shippingOption("a", { countryCodes: ["UA", "PL"] }),
        shippingOption("b", { kind: "pickup_point", countryCodes: ["DE"] }),
        shippingOption("c", { countryCodes: ["PL", "CZ"] }),
        shippingOption("d", { kind: "store_pickup", countryCodes: ["FR"] }),
      ]),
    ).toEqual(["UA", "PL", "CZ"]);
  });
});

describe("methodToChoose", () => {
  const down = shippingOption("down", {
    available: false,
    reason: "inactive",
    total: null,
    price: null,
  });

  it("chooses the first available method when none is chosen", () => {
    expect(methodToChoose([down, shippingOption("courier")], "")).toBe("courier");
  });

  it("keeps a chosen method, also one that became unavailable (no silent switch of the price)", () => {
    expect(methodToChoose([down, shippingOption("other")], "down")).toBeNull();
    expect(methodToChoose([shippingOption("courier")], "courier")).toBeNull();
  });

  it("replaces a code the shop no longer lists with the first available one, or clears it", () => {
    expect(methodToChoose([shippingOption("courier")], "gone")).toBe("courier");
    expect(methodToChoose([down], "gone")).toBe("");
    expect(methodToChoose([down], "")).toBeNull();
  });

  it("does nothing for a shop without methods", () => {
    expect(methodToChoose([], "")).toBeNull();
    expect(methodToChoose([], "courier")).toBeNull();
  });
});

describe("countryToChoose", () => {
  const served = (...countries: string[]) => [shippingOption("a", { countryCodes: countries })];

  it("moves a country nobody serves to the preferred country, else the first served one", () => {
    expect(countryToChoose(served("PL", "UA"), "FR", "UA")).toBe("UA");
    expect(countryToChoose(served("PL", "DE"), "FR", "UA")).toBe("PL");
  });

  it("leaves a served country alone, and does nothing when no address method serves anything", () => {
    expect(countryToChoose(served("PL", "UA"), "PL", "UA")).toBeNull();
    expect(countryToChoose([], "FR", "UA")).toBeNull();
    expect(countryToChoose([shippingOption("p", { kind: "pickup_point" })], "FR", "UA")).toBeNull();
  });
});
