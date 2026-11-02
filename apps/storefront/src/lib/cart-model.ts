import type { Cart, CartLine, Money } from "@fluxkit/api-client";
import type { Translator } from "@fluxkit/ui";
import { MAX_LINE_QUANTITY, MIN_LINE_QUANTITY } from "./add-to-cart";
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

/**
 * What a line says about stock (plan 2026-11-03). The API's `insufficientStock` is `true` exactly when the checkout, run
 * now, would refuse the line with `insufficient_stock`; `maxQuantity` is the count that can be ordered, given only then
 * and only when it is small (`docs/api/cart.md`). So: `none` (0 left: remove the line), `only` (lower the quantity to
 * `available`), `short` (no count is disclosed: lower the quantity or remove the line, the 999-of-22 case). `null` when the
 * checkout would accept the line, and for a line with its own block (unavailable, out of the money range; PR 213 review
 * m5). The numbers are the server's, recomputed on every cart answer; nothing here is stored or trusted beyond display.
 */
export type LineStockHint =
  { kind: "none" } | { kind: "only"; available: number } | { kind: "short" };

export function lineStockHint(line: CartLine): LineStockHint | null {
  if (!line.insufficientStock) return null;
  const flags = lineFlags(line);
  if (flags.unavailable || flags.outOfRange) return null;
  if (line.maxQuantity === null) return { kind: "short" };
  return line.maxQuantity === 0 ? { kind: "none" } : { kind: "only", available: line.maxQuantity };
}

const STOCK_HINT_KEYS: Readonly<Record<LineStockHint["kind"], string>> = {
  none: "cart.stock.none",
  only: "cart.stock.only",
  short: "cart.stock.short",
};

/** The text of a line's stock hint (the cart line and the checkout's list say the same): a count only when the API gave one. */
export function stockHintText(t: Translator, hint: LineStockHint): string {
  return hint.kind === "only"
    ? t(STOCK_HINT_KEYS.only, { count: hint.available })
    : t(STOCK_HINT_KEYS[hint.kind]);
}

/** A line's name in a list of lines: the title, with the variant's own title or chosen values when it has them. */
export function lineName(line: CartLine): string {
  if (line.variantTitle !== null) return `${line.title} (${line.variantTitle})`;
  if (line.optionValues.length === 0) return line.title;
  return `${line.title} (${line.optionValues.map((choice) => choice.value).join(", ")})`;
}

/** The id of a cart line's element on the cart page; the stock lists of the cart and the checkout link to it. */
export function cartLineAnchor(variantId: string): string {
  return `cart-line-${variantId}`;
}

/** The lines the checkout would refuse for stock, in cart order: named before the checkout form is filled in. */
export function stockProblemLines(cart: Cart): CartLine[] {
  return stockProblems(cart).map((problem) => problem.line);
}

/** The same lines with their hints (never null), for lists that show both. */
export function stockProblems(cart: Cart): { line: CartLine; hint: LineStockHint }[] {
  const problems: { line: CartLine; hint: LineStockHint }[] = [];
  for (const line of cart.lines) {
    const hint = lineStockHint(line);
    if (hint !== null) problems.push({ line, hint });
  }
  return problems;
}

/**
 * The highest quantity the cart's stepper offers: the API's count when it gave one (at least the minimum, so a line with
 * none left can still be lowered), else the line limit. Display only: the server still answers every quantity.
 */
export function quantityStepperMax(line: CartLine): number {
  const hint = lineStockHint(line);
  if (hint === null || hint.kind === "short") return MAX_LINE_QUANTITY;
  return hint.kind === "none" ? MIN_LINE_QUANTITY : Math.max(MIN_LINE_QUANTITY, hint.available);
}

/** What the product page needs of a cart line: its quantity and its stock hint. */
export interface CartLineFacts {
  quantity: number;
  insufficientStock: boolean;
  maxQuantity: number | null;
}

/** The cart line per variant id in the cart the browser last read; `null` while there is none (still loading or failed). */
export function cartLineFacts(cart: Cart | null): ReadonlyMap<string, CartLineFacts> | null {
  if (cart === null) return null;
  return new Map(
    cart.lines.map((line) => [
      line.variantId,
      {
        quantity: line.quantity,
        insufficientStock: line.insufficientStock,
        maxQuantity: line.maxQuantity,
      },
    ]),
  );
}

export function hasPriceChange(cart: Cart): boolean {
  return cart.lines.some((line) => lineFlags(line).priceChanged !== null);
}

/**
 * Why the checkout cannot start, or `null` when it can. `purchasable` is the API's word (at least one line and no
 * unavailable line); the storefront does not recompute it. `stock`: a line the checkout would refuse for stock (the
 * API's `insufficientStock`), said before the shopper fills in the form.
 */
export function checkoutBlock(cart: Cart): "empty" | "lines" | "stock" | null {
  if (!cart.purchasable) return cart.lines.length === 0 ? "empty" : "lines";
  return stockProblemLines(cart).length > 0 ? "stock" : null;
}

/**
 * Whether the cart page moves the focus to the reason of the blocked checkout button (review m5 of PR 215): only when the
 * link was there before (`before` null), a block with a shown reason replaced it, and the focus was lost with the link
 * (on the page body). A shopper working elsewhere on the page keeps the focus.
 */
export function focusCheckoutReason(
  before: ReturnType<typeof checkoutBlock>,
  after: ReturnType<typeof checkoutBlock>,
  focusLost: boolean,
): boolean {
  return before === null && (after === "stock" || after === "lines") && focusLost;
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
