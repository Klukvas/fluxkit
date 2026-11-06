import { describe, expect, it } from "vitest";
import {
  cartBadgeState,
  cartLineFacts,
  cartNoticeMessageKey,
  checkoutBlock,
  focusCartHeading,
  focusCheckoutReason,
  hasPriceChange,
  isCartBusy,
  isLineBusy,
  lineFlags,
  lineStockHint,
  noticeMoney,
  quantityStepperMax,
  stockProblemLines,
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

  it("blocks a purchasable cart whose line the checkout would refuse for stock", () => {
    expect(
      checkoutBlock(
        cartOf([cartLine("v1", { quantity: 999, insufficientStock: true, maxQuantity: null })]),
      ),
    ).toBe("stock");
    expect(checkoutBlock(cartOf([cartLine("v1", { availability: "low_stock" })]))).toBeNull();
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

describe("lineStockHint (the API's insufficientStock and maxQuantity, plan 2026-11-03)", () => {
  it("is null while the checkout would accept the line, also for a low-stock line", () => {
    expect(lineStockHint(cartLine("a"))).toBeNull();
    expect(lineStockHint(cartLine("a", { availability: "low_stock", quantity: 2 }))).toBeNull();
  });

  it("names the count when the API gives one, and says 'not enough' without one (999 of 22)", () => {
    expect(
      lineStockHint(cartLine("a", { quantity: 8, insufficientStock: true, maxQuantity: 3 })),
    ).toEqual({ kind: "only", available: 3 });
    expect(
      lineStockHint(cartLine("a", { quantity: 999, insufficientStock: true, maxQuantity: null })),
    ).toEqual({ kind: "short" });
    expect(
      lineStockHint(
        cartLine("a", {
          availability: "out_of_stock",
          notices: [{ code: "out_of_stock" }],
          insufficientStock: true,
          maxQuantity: 0,
        }),
      ),
    ).toEqual({ kind: "none" });
  });

  it("never trusts a count without the flag (the API gives none then)", () => {
    expect(lineStockHint(cartLine("a", { insufficientStock: false, maxQuantity: 3 }))).toBeNull();
  });

  // PR 213 review m5: a line with its own block (unavailable, out of the money range) is never repeated as a stock problem.
  it("skips unavailable and out-of-range lines", () => {
    const flagged = { insufficientStock: true, maxQuantity: 0 } as const;
    expect(
      lineStockHint(cartLine("a", { ...flagged, notices: [{ code: "line_total_out_of_range" }] })),
    ).toBeNull();
    expect(
      lineStockHint(cartLine("a", { ...flagged, notices: [{ code: "unavailable" }] })),
    ).toBeNull();
  });
});

describe("stockProblemLines (say it before the form is filled in)", () => {
  it("lists the lines the checkout would refuse for stock, in cart order", () => {
    const cart = cartOf([
      cartLine("a", { insufficientStock: true, maxQuantity: null, quantity: 999 }),
      cartLine("b", { availability: "low_stock" }),
      cartLine("c", { insufficientStock: true, maxQuantity: 2, quantity: 5 }),
      cartLine("d", {
        insufficientStock: true,
        maxQuantity: 0,
        notices: [{ code: "unavailable" }],
      }),
    ]);
    expect(stockProblemLines(cart)).toEqual([cart.lines[0], cart.lines[2]]);
    expect(stockProblemLines(cartOf([cartLine("b", { availability: "low_stock" })]))).toEqual([]);
  });
});

describe("quantityStepperMax", () => {
  it("caps the stepper at the API's count, never below the minimum, and at the line limit otherwise", () => {
    expect(quantityStepperMax(cartLine("a", { insufficientStock: true, maxQuantity: 3 }))).toBe(3);
    expect(quantityStepperMax(cartLine("a", { insufficientStock: true, maxQuantity: 0 }))).toBe(1);
    expect(quantityStepperMax(cartLine("a", { insufficientStock: true, maxQuantity: null }))).toBe(
      999,
    );
    expect(quantityStepperMax(cartLine("a"))).toBe(999);
  });
});

describe("focusCheckoutReason (PR 215 review m5)", () => {
  it("moves the focus to the reason only when the checkout link just turned into the blocked button and the focus was lost", () => {
    expect(focusCheckoutReason(null, "stock", true)).toBe(true);
    expect(focusCheckoutReason(null, "lines", true)).toBe(true);
    // The shopper is elsewhere (a stepper): leave the focus alone.
    expect(focusCheckoutReason(null, "stock", false)).toBe(false);
    // Already blocked before, or unblocked now: nothing moved.
    expect(focusCheckoutReason("stock", "stock", true)).toBe(false);
    expect(focusCheckoutReason("stock", null, true)).toBe(false);
    // An emptied cart has no reason to focus.
    expect(focusCheckoutReason(null, "empty", true)).toBe(false);
  });
});

describe("focusCartHeading (UX round 2, batch 3A item 5)", () => {
  it("moves the focus to the heading when the last line went and the focus went with its remove button", () => {
    expect(focusCartHeading(1, 0, true)).toBe(true);
    expect(focusCartHeading(3, 0, true)).toBe(true);
  });

  it("leaves the focus alone otherwise: lines remain, the cart was already empty or not read, or the focus is elsewhere", () => {
    expect(focusCartHeading(2, 1, true)).toBe(false);
    expect(focusCartHeading(0, 0, true)).toBe(false);
    expect(focusCartHeading(null, 0, true)).toBe(false);
    expect(focusCartHeading(1, null, true)).toBe(false);
    expect(focusCartHeading(1, 0, false)).toBe(false);
  });
});

describe("cartLineFacts", () => {
  it("maps each line's variant to its quantity and stock hint, or null while there is no cart", () => {
    expect(cartLineFacts(ready().cart)).toEqual(
      new Map([["v1", { quantity: 3, insufficientStock: false, maxQuantity: null }]]),
    );
    expect(cartLineFacts(initialCartState.cart)).toBeNull();
  });
});
