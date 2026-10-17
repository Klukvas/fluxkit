import type { Availability } from "../inventory/availability.js";
import { isSupportedCurrency } from "../pricing/currency.js";
import type { SupportedCurrency } from "../pricing/currency.js";
import { addMoney, createMoney, multiplyByQuantity } from "../pricing/money.js";
import type { Money } from "../pricing/money.js";
import { validatePrice } from "../pricing/price.js";
import type { Price } from "../pricing/price.js";
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from "./limits.js";

/*
 * Cart pricing (plan 2026-10-17, Cart pricing). The cart always shows the CURRENT price: the caller reads the facts of
 * every line from the database and this function turns them into unit prices, line totals, notices and the subtotal.
 * All arithmetic goes through the money module. An amount that does not fit is a typed refusal, never a clamp. Facts that
 * break the rules (quantity 0, a negative price, an unknown availability) are bugs or corrupt data and throw a
 * RangeError. No clock, no I/O, inputs are not mutated, outputs are frozen.
 */

export interface PricedLineFacts {
  /** The shared sellable rule (`isVariantSellable`), read by the caller. */
  readonly sellable: boolean;
  /** The active price in the shop currency, or `null` when the variant has none. */
  readonly currentPrice: Price | null;
  readonly availability: Availability;
  /** The unit price the shopper last saw (`CartLine.seen`). */
  readonly seen: Money | null;
}

export interface PricedLineInput {
  readonly variantId: string;
  readonly quantity: number;
  readonly facts: PricedLineFacts;
}

export type LineNotice =
  | { readonly code: "price_changed"; readonly previousAmount: Money }
  | { readonly code: "unavailable" }
  | { readonly code: "out_of_stock" };

export interface PricedLine {
  readonly variantId: string;
  readonly quantity: number;
  /** `null` for an unavailable line: it has no price the shop can charge. */
  readonly unitPrice: Money | null;
  readonly compareAtAmount: number | null;
  readonly lineTotal: Money | null;
  readonly availability: Availability;
  readonly notices: readonly LineNotice[];
}

export type PriceCartResult =
  | {
      readonly ok: true;
      readonly lines: readonly PricedLine[];
      /** Sum of the line totals of the available lines, in the cart currency. */
      readonly subtotal: Money;
      /** Sum of the quantities of all lines, unavailable ones included. */
      readonly itemCount: number;
      /** At least one line and no unavailable line. */
      readonly purchasable: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: "line_total_out_of_range";
      /** Positions of every line whose total does not fit, so a checkout can report each one. */
      readonly lineIndexes: readonly number[];
    }
  | { readonly ok: false; readonly reason: "subtotal_out_of_range" };

const AVAILABILITIES: readonly Availability[] = ["in_stock", "low_stock", "out_of_stock"];

interface CheckedLine {
  readonly input: PricedLineInput;
  /** `null` when the line can not be charged. */
  readonly price: Price | null;
}

function checkLine(line: PricedLineInput, currency: SupportedCurrency): CheckedLine {
  if (typeof line.variantId !== "string" || line.variantId.length === 0) {
    throw new RangeError("A cart line needs a non-empty variant id");
  }
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_LINE_QUANTITY) {
    throw new RangeError(
      `A cart line quantity must be an integer from 1 to ${String(MAX_LINE_QUANTITY)}`,
    );
  }
  const { sellable, currentPrice, availability, seen } = line.facts;
  if (typeof sellable !== "boolean") {
    throw new RangeError("The sellable fact must be a boolean");
  }
  if (!AVAILABILITIES.includes(availability)) {
    throw new RangeError(`Unknown availability: ${String(availability)}`);
  }
  if (seen !== null) {
    const checked = createMoney(seen.amount, seen.currency);
    if (!checked.ok || checked.money.amount < 0) {
      throw new RangeError("A seen price must be valid, non-negative money or null");
    }
  }
  if (currentPrice === null) {
    return { input: line, price: null };
  }
  const validated = validatePrice(currentPrice);
  if (!validated.ok) {
    throw new RangeError(`Invalid current price: ${validated.reason}`);
  }
  // A price in another currency is never converted or mixed in: the line can not be charged in this cart.
  const chargeable = sellable && validated.price.currency === currency;
  return { input: line, price: chargeable ? validated.price : null };
}

function noticesOf(checked: CheckedLine): readonly LineNotice[] {
  const { facts } = checked.input;
  if (checked.price === null) {
    return Object.freeze([Object.freeze({ code: "unavailable" as const })]);
  }
  const notices: LineNotice[] = [];
  const { seen } = facts;
  if (
    seen !== null &&
    (seen.amount !== checked.price.amount || seen.currency !== checked.price.currency)
  ) {
    notices.push(
      Object.freeze({
        code: "price_changed" as const,
        previousAmount: Object.freeze({ amount: seen.amount, currency: seen.currency }),
      }),
    );
  }
  if (facts.availability === "out_of_stock") {
    notices.push(Object.freeze({ code: "out_of_stock" as const }));
  }
  return Object.freeze(notices);
}

export function priceCart(
  currency: SupportedCurrency,
  lines: readonly PricedLineInput[],
): PriceCartResult {
  if (!isSupportedCurrency(currency)) {
    throw new RangeError(`Unsupported cart currency: ${String(currency)}`);
  }
  if (lines.length > MAX_CART_LINES) {
    throw new RangeError(`A cart has at most ${String(MAX_CART_LINES)} lines`);
  }
  const variantIds = new Set<string>();
  const checkedLines = lines.map((line) => {
    const checked = checkLine(line, currency);
    if (variantIds.has(line.variantId)) {
      throw new RangeError("A cart has two lines for one variant");
    }
    variantIds.add(line.variantId);
    return checked;
  });

  const overflowing: number[] = [];
  const priced: PricedLine[] = checkedLines.map((checked, index) => {
    const { variantId, quantity, facts } = checked.input;
    const base = {
      variantId,
      quantity,
      availability: facts.availability,
      notices: noticesOf(checked),
    };
    if (checked.price === null) {
      return Object.freeze({ ...base, unitPrice: null, compareAtAmount: null, lineTotal: null });
    }
    const unit = createMoney(checked.price.amount, checked.price.currency);
    if (!unit.ok) {
      throw new RangeError(`Invalid unit price: ${unit.reason}`);
    }
    const total = multiplyByQuantity(unit.money, quantity);
    if (!total.ok) {
      if (total.reason !== "amount_out_of_range") {
        throw new RangeError(`Invalid line total: ${total.reason}`);
      }
      overflowing.push(index);
      return Object.freeze({
        ...base,
        unitPrice: unit.money,
        compareAtAmount: checked.price.compareAtAmount,
        lineTotal: null,
      });
    }
    return Object.freeze({
      ...base,
      unitPrice: unit.money,
      compareAtAmount: checked.price.compareAtAmount,
      lineTotal: total.money,
    });
  });
  if (overflowing.length > 0) {
    return {
      ok: false,
      reason: "line_total_out_of_range",
      lineIndexes: Object.freeze(overflowing),
    };
  }

  const zero = createMoney(0, currency);
  if (!zero.ok) {
    throw new RangeError(`Invalid cart currency: ${zero.reason}`);
  }
  let subtotal: Money = zero.money;
  for (const line of priced) {
    if (line.lineTotal === null) {
      continue;
    }
    // Line totals are not negative, so the running sum only grows: a failure here is an overflow of the final sum too.
    const next = addMoney(subtotal, line.lineTotal);
    if (!next.ok) {
      if (next.reason !== "amount_out_of_range") {
        throw new RangeError(`Invalid subtotal: ${next.reason}`);
      }
      return { ok: false, reason: "subtotal_out_of_range" };
    }
    subtotal = next.money;
  }

  const itemCount = priced.reduce((sum, line) => sum + line.quantity, 0);
  const purchasable = priced.length > 0 && priced.every((line) => line.lineTotal !== null);
  return Object.freeze({
    ok: true as const,
    lines: Object.freeze(priced),
    subtotal,
    itemCount,
    purchasable,
  });
}
