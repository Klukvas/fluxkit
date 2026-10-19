import type { Cart, CartLine, Money } from "@fluxkit/api-client";
import { CART_BUSY_KEY, type CartState } from "./cart-store";
import { formatMoney } from "./money";

/**
 * What the cart views derive from the API's cart: flags, reasons and display strings. Nothing here adds, multiplies or
 * compares money (every total, price and flag comes from the API); the checks are about notices and state only.
 */

/** The header badge: a skeleton, the count, or empty when the cart could not be read. */
export type CartBadgeState =
  { status: "loading" } | { status: "ready"; count: number } | { status: "error" };

export function cartBadgeState(state: CartState): CartBadgeState {
  if (state.cart !== null) return { status: "ready", count: state.cart.itemCount };
  return state.status === "error" ? { status: "error" } : { status: "loading" };
}

export interface LineFlags {
  /** The price the shopper last saw, when the line has a `price_changed` notice. */
  priceChanged: Money | null;
  unavailable: boolean;
  outOfStock: boolean;
  outOfRange: boolean;
  /** An unavailable line can only be removed; every other line may change its quantity. */
  canEditQuantity: boolean;
}

export function lineFlags(line: CartLine): LineFlags {
  let priceChanged: Money | null = null;
  let unavailable = false;
  let outOfStock = false;
  let outOfRange = false;
  for (const notice of line.notices) {
    if (notice.code === "price_changed") priceChanged = notice.previousAmount;
    else if (notice.code === "unavailable") unavailable = true;
    else if (notice.code === "out_of_stock") outOfStock = true;
    else outOfRange = true;
  }
  return { priceChanged, unavailable, outOfStock, outOfRange, canEditQuantity: !unavailable };
}

export function hasPriceChange(cart: Cart): boolean {
  return cart.lines.some((line) => lineFlags(line).priceChanged !== null);
}

/**
 * Why the checkout cannot start, or `null` when it can. `purchasable` is the API's word (at least one line and no
 * unavailable line); the storefront does not recompute it.
 */
export function checkoutBlock(cart: Cart): "empty" | "lines" | null {
  if (cart.purchasable) return null;
  return cart.lines.length === 0 ? "empty" : "lines";
}

/** A whole-cart write (acknowledge, clear) is in flight. */
export function isCartBusy(state: CartState): boolean {
  return state.busy.includes(CART_BUSY_KEY);
}

export function isLineBusy(state: CartState, variantId: string): boolean {
  return state.busy.includes(variantId) || isCartBusy(state);
}

/**
 * A price from a cart notice. The shop's exponent (`GET /store/config`) belongs to the shop's currency only: a price the
 * shopper saw in another currency (after `SHOP_CURRENCY` changed) is formatted with that currency's own digits.
 */
export function noticeMoney(
  money: Money,
  cartCurrency: string,
  exponent: number,
  locale: string,
): string {
  return formatMoney(money, money.currency === cartCurrency ? exponent : undefined, locale);
}

const CART_NOTICE_CODES = ["quantity_capped", "lines_dropped"] as const;

/** Message key of a `cartNotices` code of a sign-in; a code the storefront does not know yet gets the generic text. */
export function cartNoticeMessageKey(code: string): string {
  return (CART_NOTICE_CODES as readonly string[]).includes(code)
    ? `account.cartNotice.${code}`
    : "account.cartNotice.generic";
}
