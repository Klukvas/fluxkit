import type { AdminPrice, ProblemDetails, PutProductPriceItem } from "@fluxkit/api-client";
import {
  amountToInputText,
  parseMoneyInput,
  type MoneyInputFailure,
} from "../../../lib/money-input";
import {
  describeFieldError,
  describeProblem,
  type MessageDescriptor,
} from "../../../lib/problem-messages";

/**
 * The Prices tab's model (plan step 7; `docs/api/pricing.md`): a grid of variants by currencies, filled from the
 * product-level read `GET /admin/products/{id}/prices`, edited as decimal TEXT and saved with ONE bulk
 * `PUT /admin/products/{id}/prices` (1 to 500 items, all or nothing; each item creates or replaces that price) that holds
 * only the new and changed cells. Amounts become integer minor units through `parseMoneyInput` (no float ever) and are
 * compared as integers, so `12` and `12.00` are the same price. A price is removed with its own `DELETE` (confirmed), never
 * by emptying a field. No React, no client.
 */

/** The API's cap on one bulk call (`MAX_BULK_PRICE_ITEMS` in `apps/api`; also in `docs/api/openapi.json`, checked in the screen spec). */
export const MAX_BULK_PRICE_ITEMS = 500;

export interface PriceCurrency {
  code: string;
  /** Digits of the minor unit (`GET /admin/config` `supportedCurrencies[].exponent`). */
  exponent: number;
}

export interface PriceGridContext {
  shopCurrency: string;
  /** Every currency a price may be stored in, in the config's order. */
  currencies: readonly PriceCurrency[];
  /** The product's variants, in the product detail's order. */
  variantIds: readonly string[];
}

export interface CellText {
  amount: string;
  compareAt: string;
}

export interface PriceGrid {
  /** The currencies shown: the shop currency first, then the others in the config's order. */
  columns: string[];
  /** Typed text by `cellKey`; a missing cell is empty. */
  cells: Record<string, CellText>;
}

export type PriceField = "amount" | "compareAt";

/** Why a cell cannot be saved; each has a message `products.prices.reason.<issue>`. */
export const PRICE_ISSUES = [
  "empty",
  "comma_separator",
  "inner_space",
  "invalid_format",
  "too_many_decimals",
  "negative_zero",
  "negative_amount",
  "amount_out_of_range",
  "amount_required",
  "stored_needs_amount",
  "compare_at_not_greater",
  "too_many_changes",
] as const satisfies readonly (MoneyInputFailure | string)[];
export type PriceIssue = (typeof PRICE_ISSUES)[number];

export interface PlannedItem {
  key: string;
  item: Required<PutProductPriceItem>;
}

export type PricePlan =
  { ok: true; items: PlannedItem[] } | { ok: false; issues: Record<string, PriceIssue> };

const EMPTY: CellText = { amount: "", compareAt: "" };

export function cellKey(variantId: string, currency: string): string {
  return `${variantId}|${currency}`;
}

/** The name of one input (`<variantId>.<currency>.<field>`): the key of its issue and of its server error. */
export function fieldName(variantId: string, currency: string, field: PriceField): string {
  return `${variantId}.${currency}.${field}`;
}

function exponentOf(context: PriceGridContext, currency: string): number {
  const found = context.currencies.find((entry) => entry.code === currency);
  if (found === undefined) {
    throw new RangeError(
      `The admin config does not list the currency ${JSON.stringify(currency)}.`,
    );
  }
  return found.exponent;
}

function ordered(codes: Iterable<string>, context: PriceGridContext): string[] {
  const wanted = new Set(codes);
  wanted.delete(context.shopCurrency);
  return [
    context.shopCurrency,
    ...context.currencies.map((entry) => entry.code).filter((code) => wanted.has(code)),
  ];
}

/** The grid of the stored prices: their exact decimal text, the shop currency always shown. */
export function gridFrom(prices: readonly AdminPrice[], context: PriceGridContext): PriceGrid {
  const cells: Record<string, CellText> = {};
  for (const price of prices) {
    const exponent = exponentOf(context, price.currency);
    cells[cellKey(price.variantId, price.currency)] = {
      amount: amountToInputText(price.amount, exponent),
      compareAt:
        price.compareAtAmount === null ? "" : amountToInputText(price.compareAtAmount, exponent),
    };
  }
  return {
    columns: ordered(
      prices.map((price) => price.currency),
      context,
    ),
    cells,
  };
}

/** Shows another supported currency (nothing is stored until a price is typed and saved). */
export function addColumn(grid: PriceGrid, currency: string, context: PriceGridContext): PriceGrid {
  exponentOf(context, currency);
  if (grid.columns.includes(currency)) return grid;
  return { ...grid, columns: ordered([...grid.columns, currency], context) };
}

function cellOf(grid: PriceGrid, variantId: string, currency: string): CellText {
  return grid.cells[cellKey(variantId, currency)] ?? EMPTY;
}

function columnHasText(grid: PriceGrid, currency: string): boolean {
  return Object.entries(grid.cells).some(
    ([key, cell]) =>
      key.endsWith(`|${currency}`) && (cell.amount.trim() !== "" || cell.compareAt.trim() !== ""),
  );
}

/** Only an added column without stored prices and without typed text can be hidden; never the shop currency. */
export function canRemoveColumn(
  grid: PriceGrid,
  currency: string,
  stored: readonly AdminPrice[],
): boolean {
  if (currency === grid.columns[0]) return false;
  if (stored.some((price) => price.currency === currency)) return false;
  return !columnHasText(grid, currency);
}

export function removeColumn(
  grid: PriceGrid,
  currency: string,
  stored: readonly AdminPrice[],
): PriceGrid {
  if (!canRemoveColumn(grid, currency, stored)) return grid;
  return { ...grid, columns: grid.columns.filter((code) => code !== currency) };
}

export function setCell(
  grid: PriceGrid,
  variantId: string,
  currency: string,
  field: PriceField,
  text: string,
): PriceGrid {
  const key = cellKey(variantId, currency);
  return {
    ...grid,
    cells: { ...grid.cells, [key]: { ...cellOf(grid, variantId, currency), [field]: text } },
  };
}

/** Any typed text differs from the stored grid (an added empty column is no change). */
export function priceGridDirty(grid: PriceGrid, initial: PriceGrid): boolean {
  const keys = new Set([...Object.keys(grid.cells), ...Object.keys(initial.cells)]);
  for (const key of keys) {
    const now = grid.cells[key] ?? EMPTY;
    const before = initial.cells[key] ?? EMPTY;
    if (now.amount !== before.amount || now.compareAt !== before.compareAt) return true;
  }
  return false;
}

/**
 * What one save sends: every shown cell of every current variant, checked like the API (an amount is a non-negative
 * integer of minor units within 10^12; a compare-at price is empty or strictly greater), and only the cells whose
 * integers differ from the stored price, in the product's variant order and the grid's currency order. `compareAtAmount`
 * is always explicit (`null` clears the old price; the bulk PUT replaces the whole price). Any issue: nothing is sent.
 */
export function planPriceSave(
  grid: PriceGrid,
  stored: readonly AdminPrice[],
  context: PriceGridContext,
): PricePlan {
  const storedByKey = new Map(
    stored.map((price) => [cellKey(price.variantId, price.currency), price]),
  );
  const issues: Record<string, PriceIssue> = {};
  const items: PlannedItem[] = [];
  for (const variantId of context.variantIds) {
    for (const currency of grid.columns) {
      const exponent = exponentOf(context, currency);
      const key = cellKey(variantId, currency);
      const cell = cellOf(grid, variantId, currency);
      const existing = storedByKey.get(key);
      const amountName = fieldName(variantId, currency, "amount");
      const compareName = fieldName(variantId, currency, "compareAt");
      const hasAmount = cell.amount.trim() !== "";
      const hasCompare = cell.compareAt.trim() !== "";
      if (!hasAmount) {
        if (existing !== undefined) issues[amountName] = "stored_needs_amount";
        else if (hasCompare) issues[amountName] = "amount_required";
        continue;
      }
      const amount = parseMoneyInput(cell.amount, exponent);
      if (!amount.ok) issues[amountName] = amount.reason;
      let compareAt: number | null = null;
      if (hasCompare) {
        const parsed = parseMoneyInput(cell.compareAt, exponent);
        if (!parsed.ok) issues[compareName] = parsed.reason;
        else compareAt = parsed.amount;
      }
      if (!amount.ok || (hasCompare && compareAt === null)) continue;
      if (compareAt !== null && compareAt <= amount.amount) {
        issues[compareName] = "compare_at_not_greater";
        continue;
      }
      if (
        existing !== undefined &&
        existing.amount === amount.amount &&
        existing.compareAtAmount === compareAt
      ) {
        continue;
      }
      items.push({
        key,
        item: { variantId, currency, amount: amount.amount, compareAtAmount: compareAt },
      });
    }
  }
  if (Object.keys(issues).length > 0) return { ok: false, issues };
  if (items.length > MAX_BULK_PRICE_ITEMS)
    return { ok: false, issues: { items: "too_many_changes" } };
  return { ok: true, items };
}

const ITEM_PATH = /^items\.(\d+)(?:\.(\w+))?$/;

/**
 * A refused bulk call on the grid: `items.N.<field>` goes on the cell of the N-th item sent (`compareAtAmount` on the
 * compare-at input, every other field and the item itself on the amount input), everything else in the summary. The
 * message is the translated `errors[].code`; the API's English text is never shown.
 */
export function priceErrorsFromProblem(
  problem: ProblemDetails,
  status: number,
  sentKeys: readonly string[],
): { fields: Record<string, MessageDescriptor>; other: MessageDescriptor[] } {
  const fields: Record<string, MessageDescriptor> = {};
  const other: MessageDescriptor[] = [];
  if (problem.errors === undefined || problem.errors.length === 0) {
    return { fields, other: [describeProblem(status, problem)] };
  }
  for (const error of problem.errors) {
    const match = ITEM_PATH.exec(error.path);
    const key = match === null ? undefined : sentKeys[Number(match[1])];
    if (match === null || key === undefined) {
      other.push(describeFieldError(error.code));
      continue;
    }
    const [variantId = "", currency = ""] = key.split("|");
    const field: PriceField = match[2] === "compareAtAmount" ? "compareAt" : "amount";
    fields[fieldName(variantId, currency, field)] ??= describeFieldError(error.code);
  }
  return { fields, other };
}

/**
 * Whether the API would refuse to delete a price (`docs/api/pricing.md`, `last_shop_price`): the shop-currency price of an
 * active variant of a published product. The screen says so instead of offering the button; the API decides anyway.
 */
export function priceDeleteBlock(
  currency: string,
  shopCurrency: string,
  variantActive: boolean,
  productStatus: string,
): "last_shop_price" | null {
  return currency === shopCurrency && variantActive && productStatus === "active"
    ? "last_shop_price"
    : null;
}

/**
 * A short fingerprint of the stored prices, for the grid's `key`: a write that landed changes it, so the grid is rebuilt
 * from what the server stored; a reload that finds the same prices (a lost answer whose write did not land) keeps the
 * typed text. FNV-1a over ids and timestamps; not a security measure.
 */
export function pricesRevision(prices: readonly AdminPrice[]): string {
  const text = prices.map((price) => `${price.id}@${price.updatedAt}`).join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${prices.length}-${hash.toString(16)}`;
}
