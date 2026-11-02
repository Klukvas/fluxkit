import type { ProductDetail, ProductVariant } from "@fluxkit/api-client";

/**
 * Variant selection for the product page. Pure, and niche-neutral: option and value CODES are data from the API
 * (`ProductDetail.options`, `ProductVariant.optionValues`); nothing here knows what any option is called (AGENTS.md
 * section 2.3). A product with no options has one default variant and no picker.
 *
 * A selection maps an option code to a value code. The rule that keeps the picker from ever dead-ending: a value of
 * option N is available only if some sellable variant has it together with the current values of options 1..N-1. The first
 * option therefore never has a disabled value, and choosing an earlier value repairs later ones (`selectValue`).
 */

export type Selection = Readonly<Record<string, string>>;

type MatcherProduct = Pick<ProductDetail, "options" | "variants">;

/**
 * The value chosen for an option, or `undefined`. Option codes are data (`constructor`, `__proto__` and `toString` are valid
 * codes), so only OWN properties count: a plain lookup would find the inherited member of `Object.prototype`.
 */
export function chosenValue(selection: Selection, optionCode: string): string | undefined {
  return Object.hasOwn(selection, optionCode) ? selection[optionCode] : undefined;
}

function valueOf(variant: ProductVariant, optionCode: string): string | undefined {
  return variant.optionValues.find((entry) => entry.optionCode === optionCode)?.valueCode;
}

/** False for a product with one default variant and no options: nothing to choose. */
export function hasOptionPicker(product: MatcherProduct): boolean {
  return product.options.length > 0;
}

/**
 * The variant that is exactly the selection (every option chosen, every value equal), or `null`. A product without
 * options answers with its single variant; several variants without options is a data error and answers `null`.
 */
export function findVariant(product: MatcherProduct, selection: Selection): ProductVariant | null {
  if (product.options.length === 0) {
    return product.variants.length === 1 ? (product.variants[0] ?? null) : null;
  }
  const chosen = product.options.map((option) => chosenValue(selection, option.code));
  if (chosen.some((value) => value === undefined)) return null;
  return (
    product.variants.find((variant) =>
      product.options.every((option, index) => valueOf(variant, option.code) === chosen[index]),
    ) ?? null
  );
}

/** Whether some variant has `valueCode` for option `index` and the selection's values for the options before it. */
function existsWithPrefix(
  product: MatcherProduct,
  selection: Selection,
  index: number,
  valueCode: string,
): boolean {
  return product.variants.some((variant) => {
    for (let earlier = 0; earlier < index; earlier += 1) {
      const code = (product.options[earlier] as { code: string }).code;
      const wanted = chosenValue(selection, code);
      if (wanted !== undefined && valueOf(variant, code) !== wanted) return false;
    }
    return valueOf(variant, (product.options[index] as { code: string }).code) === valueCode;
  });
}

export function isValueAvailable(
  product: MatcherProduct,
  selection: Selection,
  optionCode: string,
  valueCode: string,
): boolean {
  const index = product.options.findIndex((option) => option.code === optionCode);
  if (index < 0) return false;
  if (
    !(product.options[index] as { values: { code: string }[] }).values.some(
      (v) => v.code === valueCode,
    )
  ) {
    return false;
  }
  return existsWithPrefix(product, selection, index, valueCode);
}

/**
 * The first variant that is not out of stock (else the first one), as a selection. Empty without options. With `preferred`
 * values (from the address: a filtered product card or a language switch), only variants that have every preferred value
 * of the product's options count; when none has them, the default start is used (an option the product does not have is
 * ignored).
 */
export function initialSelection(product: MatcherProduct, preferred: Selection = {}): Selection {
  if (product.options.length === 0) return {};
  const wanted = product.options.flatMap((option) => {
    const value = chosenValue(preferred, option.code);
    return value === undefined ? [] : [[option.code, value] as const];
  });
  const matching = product.variants.filter((variant) =>
    wanted.every(([code, value]) => valueOf(variant, code) === value),
  );
  const candidates = matching.length > 0 ? matching : product.variants;
  const chosen =
    candidates.find((variant) => variant.availability !== "out_of_stock") ?? candidates[0];
  if (chosen === undefined) return {};
  // `fromEntries` defines own properties; `selection[code] = value` with the code `__proto__` would set the prototype instead.
  return Object.fromEntries(
    product.options.flatMap((option) => {
      const value = valueOf(chosen, option.code);
      return value === undefined ? [] : [[option.code, value] as const];
    }),
  );
}

/**
 * Selects one value and repairs the options after it: a later value that no longer exists with the new earlier values is
 * replaced by the first value (in the option's order) that does. A value that is not available leaves the selection as it is.
 */
export function selectValue(
  product: MatcherProduct,
  selection: Selection,
  optionCode: string,
  valueCode: string,
): Selection {
  const index = product.options.findIndex((option) => option.code === optionCode);
  if (index < 0 || !isValueAvailable(product, selection, optionCode, valueCode)) return selection;
  const next = new Map<string, string>(Object.entries({ ...selection, [optionCode]: valueCode }));
  for (let later = index + 1; later < product.options.length; later += 1) {
    const option = product.options[later] as { code: string; values: { code: string }[] };
    const current = next.get(option.code);
    if (current !== undefined && existsWithPrefix(product, asSelection(next), later, current)) {
      continue;
    }
    const replacement = option.values.find((value) =>
      existsWithPrefix(product, asSelection(next), later, value.code),
    );
    // Always found: the earlier values exist in some variant, and every variant has a value for this option. If the data
    // ever breaks that, the stale value stays and `findVariant` answers null, which the page shows as "no such variant".
    if (replacement !== undefined) next.set(option.code, replacement.code);
  }
  return asSelection(next);
}

/**
 * Whether choosing `valueCode` would land on a variant that is out of stock (review D-15): the picker shows such a value
 * struck through but keeps it selectable, so the shopper still sees its price and the "out of stock" state. It follows
 * `selectValue`, repairs of later options included. A value that is not available at all is NOT sold out (it is disabled).
 */
export function isValueSoldOut(
  product: MatcherProduct,
  selection: Selection,
  optionCode: string,
  valueCode: string,
): boolean {
  if (!isValueAvailable(product, selection, optionCode, valueCode)) return false;
  const landing = findVariant(product, selectValue(product, selection, optionCode, valueCode));
  return landing !== null && landing.availability === "out_of_stock";
}

/** A selection with the entries of `map` as own properties (also for the code `__proto__`). */
function asSelection(map: ReadonlyMap<string, string>): Selection {
  return Object.fromEntries(map);
}

/** Prefix of an option in the product page's address: `?opt.<optionCode>=<valueCode>` (the codes of the search facet). */
export const SELECTION_PARAM_PREFIX = "opt.";
/** Codes are data; this only keeps junk out (core codes are narrower: lower case, digits, `_`, at most 64). */
const SELECTION_CODE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,79}$/;

/**
 * The selection a product page address asks for (`?opt.color=red&opt.size=l`). A malformed, empty or repeated entry is
 * dropped, never an error: the page still shows the product, starting from the default variant.
 */
export function selectionFromParams(
  params: Readonly<Record<string, string | string[] | undefined>>,
): Selection {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith(SELECTION_PARAM_PREFIX) || typeof value !== "string") continue;
    const code = key.slice(SELECTION_PARAM_PREFIX.length);
    if (SELECTION_CODE.test(code) && SELECTION_CODE.test(value)) entries.push([code, value]);
  }
  return Object.fromEntries(entries);
}

/** The query (without `?`) that names `selection`, in the product's option order; empty for a product without options. */
export function selectionQuery(product: MatcherProduct, selection: Selection): string {
  const params = new URLSearchParams();
  for (const option of product.options) {
    const value = chosenValue(selection, option.code);
    if (value !== undefined) params.append(`${SELECTION_PARAM_PREFIX}${option.code}`, value);
  }
  return params.toString();
}

/** Ids of the selected option values, in option order (media can belong to one: `ProductMedia.optionValueId`). */
export function selectedValueIds(product: MatcherProduct, selection: Selection): string[] {
  const ids: string[] = [];
  for (const option of product.options) {
    const code = chosenValue(selection, option.code);
    const value = option.values.find((candidate) => candidate.code === code);
    if (value !== undefined) ids.push(value.id);
  }
  return ids;
}
