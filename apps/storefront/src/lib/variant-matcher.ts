import type { ProductDetail, ProductVariant } from "@fluxkit/api-client";

/**
 * Variant selection for the product page. Pure, and niche-neutral: option and value CODES are data from the API
 * (`ProductDetail.options`, `ProductVariant.optionValues`); nothing here knows what a "size" or a "color" is (AGENTS.md
 * section 2.3). A product with no options has one default variant and no picker.
 *
 * A selection maps an option code to a value code. The rule that keeps the picker from ever dead-ending: a value of
 * option N is available only if some sellable variant has it together with the current values of options 1..N-1. The first
 * option therefore never has a disabled value, and choosing an earlier value repairs later ones (`selectValue`).
 */

export type Selection = Readonly<Record<string, string>>;

type MatcherProduct = Pick<ProductDetail, "options" | "variants">;

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
  const chosen = product.options.map((option) => selection[option.code]);
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
      const wanted = selection[code];
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

/** The first variant that is not out of stock (else the first one), as a selection. Empty without options. */
export function initialSelection(product: MatcherProduct): Selection {
  if (product.options.length === 0) return {};
  const chosen =
    product.variants.find((variant) => variant.availability !== "out_of_stock") ??
    product.variants[0];
  if (chosen === undefined) return {};
  const selection: Record<string, string> = {};
  for (const option of product.options) {
    const value = valueOf(chosen, option.code);
    if (value !== undefined) selection[option.code] = value;
  }
  return selection;
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
  const next: Record<string, string> = { ...selection, [optionCode]: valueCode };
  for (let later = index + 1; later < product.options.length; later += 1) {
    const option = product.options[later] as { code: string; values: { code: string }[] };
    const current = next[option.code];
    if (current !== undefined && existsWithPrefix(product, next, later, current)) continue;
    const replacement = option.values.find((value) =>
      existsWithPrefix(product, next, later, value.code),
    );
    if (replacement === undefined) delete next[option.code];
    else next[option.code] = replacement.code;
  }
  return next;
}

/** Ids of the selected option values, in option order (media can belong to one: `ProductMedia.optionValueId`). */
export function selectedValueIds(product: MatcherProduct, selection: Selection): string[] {
  const ids: string[] = [];
  for (const option of product.options) {
    const code = selection[option.code];
    const value = option.values.find((candidate) => candidate.code === code);
    if (value !== undefined) ids.push(value.id);
  }
  return ids;
}
