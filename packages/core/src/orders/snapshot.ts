import { MAX_LINE_QUANTITY } from "../cart/limits.js";
import { codePointLength } from "../catalog/i18n.js";
import { CATALOG_LIMITS, TEXT_LIMITS } from "../catalog/limits.js";
import { isValidSku } from "../catalog/sku.js";
import { hasJsonbUnsafeCharacters } from "../catalog/text-safety.js";
import type { I18nText } from "../catalog/types.js";
import { multiplyByQuantity } from "../pricing/money.js";
import type { Money } from "../pricing/money.js";
import { validatePrice } from "../pricing/price.js";
import type { Price, PriceFailure } from "../pricing/price.js";

/*
 * The order line snapshot (plan 2026-10-17, Snapshot; ADR 0004 decision 4). What the shopper bought is copied into the
 * order at placement and never changes: ids, SKU, full translated texts (every locale, so history renders in any
 * locale), option values, image URL, unit price, compare-at price, quantity, line total and the shipping flag. This
 * function validates the facts the checkout read from the catalog, computes the line total with the money module and
 * returns a deep-frozen copy. Bad facts are typed refusals; an unusable configuration throws a RangeError. No clock,
 * no I/O.
 */

export interface OrderLineOptionValue {
  readonly option: I18nText;
  readonly value: I18nText;
}

export interface OrderLineFacts {
  readonly productId: string;
  readonly variantId: string;
  /** The stored SKU, already normalized. */
  readonly sku: string;
  readonly productTitle: I18nText;
  readonly variantTitle: I18nText | null;
  readonly optionValues: readonly OrderLineOptionValue[];
  readonly imageUrl: string | null;
  /** The current shop price read in the checkout transaction. */
  readonly unitPrice: Price;
  readonly quantity: number;
  readonly requiresShipping: boolean;
}

/**
 * The configuration the snapshot was built under. It is checked (a bug if unusable) but does NOT restrict the texts:
 * the snapshot keeps every real translation, also in locales that are no longer configured (see `snapshotText`).
 */
export interface SnapshotOptions {
  readonly defaultLocale: string;
  readonly locales: readonly string[];
}

export interface OrderLineSnapshot {
  readonly productId: string;
  readonly variantId: string;
  readonly sku: string;
  readonly productTitle: I18nText;
  readonly variantTitle: I18nText | null;
  readonly optionValues: readonly OrderLineOptionValue[];
  readonly imageUrl: string | null;
  readonly unitPrice: Money;
  readonly compareAtAmount: number | null;
  readonly quantity: number;
  readonly lineTotal: Money;
  readonly requiresShipping: boolean;
}

export type OrderLineFailure =
  | "invalid_ids"
  | "invalid_sku"
  | "invalid_product_title"
  | "invalid_variant_title"
  | "invalid_option_values"
  | "invalid_image_url"
  | "invalid_price"
  | "invalid_quantity"
  | "line_total_out_of_range"
  | "invalid_requires_shipping";

export type OrderLineResult =
  | { readonly ok: true; readonly line: OrderLineSnapshot }
  | { readonly ok: false; readonly reason: Exclude<OrderLineFailure, "invalid_price"> }
  | { readonly ok: false; readonly reason: "invalid_price"; readonly priceReason: PriceFailure };

/** http or https, something after the scheme, no whitespace (control characters are checked separately). */
const IMAGE_URL = /^https?:\/\/\S+$/i;

function fail<Reason extends Exclude<OrderLineFailure, "invalid_price">>(
  reason: Reason,
): { readonly ok: false; readonly reason: Reason } {
  return { ok: false, reason };
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const LOCALE_KEY_MAX_LENGTH = 35;

/**
 * The snapshot of a translated text: a frozen copy of every real translation, or `undefined` when there is none.
 * The snapshot is history, so (unlike the catalog write rules) it does NOT require the default locale and does NOT
 * restrict the keys to the locales configured today: a catalog written when `de` was configured, or a title that only
 * exists in a locale that was removed from `LOCALES`, must still be orderable, and any reader resolves the map with
 * `resolveTextWithFallback`. Empty and whitespace-only entries are dropped; only a text with no real entry at all is
 * refused. An entry that is not a string, is too long or has characters JSONB can not store is damaged data and refuses
 * the whole text.
 */
function snapshotText(value: unknown, maxLength: number): I18nText | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return undefined;
  }
  const kept: [string, string][] = [];
  for (const [locale, text] of Object.entries(value)) {
    if (typeof text !== "string") {
      return undefined;
    }
    if (text.trim().length === 0) {
      continue;
    }
    if (
      locale.length === 0 ||
      locale.length > LOCALE_KEY_MAX_LENGTH ||
      hasJsonbUnsafeCharacters(locale) ||
      hasJsonbUnsafeCharacters(text) ||
      codePointLength(text) > maxLength
    ) {
      return undefined;
    }
    kept.push([locale, text]);
  }
  return kept.length === 0 ? undefined : Object.freeze(Object.fromEntries(kept));
}

function hasControlCharacters(text: string): boolean {
  for (let position = 0; position < text.length; position += 1) {
    const code = text.charCodeAt(position);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function validImageUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    codePointLength(value) <= TEXT_LIMITS.url &&
    IMAGE_URL.test(value) &&
    !hasControlCharacters(value) &&
    !hasJsonbUnsafeCharacters(value)
  );
}

export function buildOrderLine(facts: OrderLineFacts, options: SnapshotOptions): OrderLineResult {
  if (options.locales.length === 0 || !options.locales.includes(options.defaultLocale)) {
    throw new RangeError("The snapshot options need locales that include the default locale");
  }
  if (!isNonEmptyText(facts.productId) || !isNonEmptyText(facts.variantId)) {
    return fail("invalid_ids");
  }
  if (typeof facts.sku !== "string" || !isValidSku(facts.sku)) {
    return fail("invalid_sku");
  }
  const productTitle = snapshotText(facts.productTitle, TEXT_LIMITS.title);
  if (productTitle === undefined) {
    return fail("invalid_product_title");
  }
  const variantTitle =
    facts.variantTitle === null ? null : snapshotText(facts.variantTitle, TEXT_LIMITS.title);
  if (variantTitle === undefined) {
    return fail("invalid_variant_title");
  }
  if (
    !Array.isArray(facts.optionValues) ||
    facts.optionValues.length > CATALOG_LIMITS.maxOptionsPerProduct
  ) {
    return fail("invalid_option_values");
  }
  const optionValues: OrderLineOptionValue[] = [];
  for (const entry of facts.optionValues) {
    const option =
      typeof entry === "object" && entry !== null
        ? snapshotText(entry.option, TEXT_LIMITS.name)
        : undefined;
    const value =
      typeof entry === "object" && entry !== null
        ? snapshotText(entry.value, TEXT_LIMITS.name)
        : undefined;
    if (option === undefined || value === undefined) {
      return fail("invalid_option_values");
    }
    optionValues.push(Object.freeze({ option, value }));
  }
  if (facts.imageUrl !== null && !validImageUrl(facts.imageUrl)) {
    return fail("invalid_image_url");
  }
  const price = validatePrice(facts.unitPrice);
  if (!price.ok) {
    return { ok: false, reason: "invalid_price", priceReason: price.reason };
  }
  if (
    !Number.isInteger(facts.quantity) ||
    facts.quantity < 1 ||
    facts.quantity > MAX_LINE_QUANTITY
  ) {
    return fail("invalid_quantity");
  }
  if (typeof facts.requiresShipping !== "boolean") {
    return fail("invalid_requires_shipping");
  }
  const unitPrice: Money = Object.freeze({
    amount: price.price.amount,
    currency: price.price.currency,
  });
  const lineTotal = multiplyByQuantity(unitPrice, facts.quantity);
  if (!lineTotal.ok) {
    if (lineTotal.reason !== "amount_out_of_range") {
      throw new RangeError(`Unexpected line total failure: ${lineTotal.reason}`);
    }
    return fail("line_total_out_of_range");
  }
  return {
    ok: true,
    line: Object.freeze({
      productId: facts.productId,
      variantId: facts.variantId,
      sku: facts.sku,
      productTitle,
      variantTitle,
      optionValues: Object.freeze(optionValues),
      imageUrl: facts.imageUrl,
      unitPrice,
      compareAtAmount: price.price.compareAtAmount,
      quantity: facts.quantity,
      lineTotal: lineTotal.money,
      requiresShipping: facts.requiresShipping,
    }),
  };
}
