/**
 * Element ids of the editor's fields, one place for the forms and for the publish-error links that focus them. A locale
 * map's control is `<base>-<locale>` (`LocaleTextField`).
 */
export const GENERAL_FIELD_IDS = {
  productType: "product-type",
  title: "product-title",
  description: "product-description",
  slug: "product-slug",
  brand: "product-brand",
} as const;

/** The prefix of the generated attribute controls: the product's Attributes tab, or one variant's form. */
export type AttributeIdPrefix = "product-attribute" | "variant-attribute";

/** The control of one attribute (`-<locale>` for a localized text; the first checkbox of a multiselect). */
export function attributeControlId(
  code: string,
  locale?: string,
  prefix: AttributeIdPrefix = "product-attribute",
): string {
  return locale === undefined ? `${prefix}-${code}` : `${prefix}-${code}-${locale}`;
}

/** The categories tab's list, the target of a categories problem. */
export const CATEGORIES_FOCUS_ID = "product-categories";

/** The Media tab's list, the target of a problem of the whole list. */
export const MEDIA_FOCUS_ID = "product-media";

/**
 * One field of one image row (`url`, `link` for the option value, `alt-<locale>`), by the row's index in the list
 * (the API's `media.N`).
 */
export function mediaFieldId(index: number, field: string): string {
  return `product-media-${index}-${field}`;
}

/** The Options tab's section, the target of a problem of the whole option set. */
export const OPTIONS_FOCUS_ID = "product-options";

/** One option's group on the Options tab, by option code (the publish path is `options.<code>`). */
export function optionFocusId(optionCode: string): string {
  return `product-option-${optionCode}`;
}

/** The Variants tab's problem list, the target of a problem of no (or no longer existing) variant. */
export const VARIANTS_FOCUS_ID = "product-variants";

/** The row header of one variant in the Variants table (focusable), by variant id. */
export function variantRowFocusId(variantId: string): string {
  return `product-variant-${variantId}`;
}

/** The Prices tab's grid, the target of a price problem of no (or no longer existing) variant. */
export const PRICES_FOCUS_ID = "product-prices";

/** One input of the Prices grid (`amount` or `compareAt`) of one variant in one currency. */
export function priceFieldId(
  variantId: string,
  currency: string,
  field: "amount" | "compareAt",
): string {
  return `product-price-${variantId}-${currency}-${field}`;
}

/** The Stock tab's section of one variant (its levels, adjustment form and journal). */
export function stockVariantFocusId(variantId: string): string {
  return `product-stock-${variantId}`;
}
