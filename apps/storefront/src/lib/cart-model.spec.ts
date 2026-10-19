import { describe, expect, it } from "vitest";
import {
  cartBadgeState,
  cartNoticeMessageKey,
  checkoutBlock,
  hasPriceChange,
  isCartBusy,
  isLineBusy,
  lineFlags,
  noticeMoney,
} from "./cart-model";
import { CART_BUSY_KEY, initialCartState, type CartState } from "./cart-store";
import { cartLine, cartOf } from "./test-fixtures";

const ready = (overrides: Partial<CartState> = {}): CartState => ({
  ...initialCartState,
  status: "ready",
  cart: cartOf([cartLine("v1", { quantity: 3 })]),
  ...overrides,
});

describe("cartBadgeState", () => {
  it("is loading until the first answer", () => {
    expect(cartBadgeState(initialCartState)).toEqual({ status: "loading" });
  });

  it("shows the item count the API counted, also after a failed write", () => {
    expect(cartBadgeState(ready())).toEqual({ status: "ready", count: 3 });
    expect(
      cartBadgeState(
        ready({
          failure: {
            messageKey: "errors.network",
            status: null,
            code: null,
            retryAfterSeconds: null,
            fieldErrors: [],
          },
        }),
      ),
    ).toEqual({ status: "ready", count: 3 });
  });

  it("is an error state when the first read failed and there is no cart to show", () => {
    expect(cartBadgeState({ ...initialCartState, status: "error" })).toEqual({ status: "error" });
  });
});

describe("lineFlags", () => {
  it("is all clear for a plain line", () => {
    expect(lineFlags(cartLine("v1"))).toEqual({
      priceChanged: null,
      unavailable: false,
      outOfStock: false,
      outOfRange: false,
      canEditQuantity: true,
    });
  });

  it("reads each notice of the API", () => {
    const previous = { amount: 1500, currency: "UAH" };
    expect(
      lineFlags(cartLine("v1", { notices: [{ code: "price_changed", previousAmount: previous }] })),
    ).toMatchObject({ priceChanged: previous, canEditQuantity: true });
    expect(lineFlags(cartLine("v1", { notices: [{ code: "out_of_stock" }] }))).toMatchObject({
      outOfStock: true,
      canEditQuantity: true,
    });
    expect(
      lineFlags(cartLine("v1", { notices: [{ code: "line_total_out_of_range" }] })),
    ).toMatchObject({ outOfRange: true, canEditQuantity: true });
  });

  it("lets the shopper only remove an unavailable line", () => {
    expect(
      lineFlags(
        cartLine("v1", { unitPrice: null, lineTotal: null, notices: [{ code: "unavailable" }] }),
      ),
    ).toMatchObject({ unavailable: true, canEditQuantity: false });
  });
});

describe("hasPriceChange", () => {
  it("is true when any line has a price_changed notice, false otherwise", () => {
    const changed = cartLine("v2", {
      notices: [{ code: "price_changed", previousAmount: { amount: 1, currency: "UAH" } }],
    });
    expect(hasPriceChange(cartOf([cartLine("v1"), changed]))).toBe(true);
    expect(hasPriceChange(cartOf([cartLine("v1")]))).toBe(false);
    expect(hasPriceChange(cartOf([]))).toBe(false);
  });
});

describe("checkoutBlock", () => {
  it("lets a purchasable cart through", () => {
    expect(checkoutBlock(cartOf([cartLine("v1")]))).toBeNull();
  });

  it("names the reason: an empty cart, or lines that must be fixed first", () => {
    expect(checkoutBlock(cartOf([]))).toBe("empty");
    expect(
      checkoutBlock(
        cartOf(
          [
            cartLine("v1", {
              unitPrice: null,
              lineTotal: null,
              notices: [{ code: "unavailable" }],
            }),
          ],
          {
            purchasable: false,
          },
        ),
      ),
    ).toBe("lines");
  });

  it("follows the API's purchasable flag and never recomputes it", () => {
    expect(checkoutBlock(cartOf([cartLine("v1")], { purchasable: false }))).toBe("lines");
  });
});

describe("isLineBusy", () => {
  it("is busy while its own write or a whole-cart write runs, not for other lines or a plain read", () => {
    expect(isLineBusy(ready({ busy: ["v1"] }), "v1")).toBe(true);
    expect(isLineBusy(ready({ busy: ["v1"] }), "v2")).toBe(false);
    expect(isLineBusy(ready({ busy: [CART_BUSY_KEY] }), "v2")).toBe(true);
    expect(isLineBusy(ready({ busy: ["load"] }), "v1")).toBe(false);
  });
});

describe("isCartBusy", () => {
  it("is busy only during a whole-cart write", () => {
    expect(isCartBusy(ready({ busy: [CART_BUSY_KEY] }))).toBe(true);
    expect(isCartBusy(ready({ busy: ["v1", "load"] }))).toBe(false);
  });
});

describe("noticeMoney", () => {
  it("formats the previous price with the shop's digits when it is in the cart's currency", () => {
    expect(noticeMoney({ amount: 150000, currency: "UAH" }, "UAH", 2, "en")).toMatch(/1,500\.00/);
  });

  it("does not apply the shop's digits to a price seen in another currency", () => {
    // 1500 JPY has no fraction digits; reading it with the shop's exponent 2 would show 15.00.
    expect(noticeMoney({ amount: 1500, currency: "JPY" }, "UAH", 2, "en")).toMatch(/1,500(?!\.)/);
  });
});

describe("cartNoticeMessageKey", () => {
  it("has a message for each notice of a sign-in and a generic one for a code from the future", () => {
    expect(cartNoticeMessageKey("quantity_capped")).toBe("account.cartNotice.quantity_capped");
    expect(cartNoticeMessageKey("lines_dropped")).toBe("account.cartNotice.lines_dropped");
    expect(cartNoticeMessageKey("something_new")).toBe("account.cartNotice.generic");
  });
});
