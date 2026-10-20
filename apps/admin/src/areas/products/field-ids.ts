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

/** The control of one attribute (`-<locale>` for a localized text; the first checkbox of a multiselect). */
export function attributeControlId(code: string, locale?: string): string {
  return locale === undefined ? `product-attribute-${code}` : `product-attribute-${code}-${locale}`;
}

/** The categories tab's list, the target of a categories problem. */
export const CATEGORIES_FOCUS_ID = "product-categories";

/** The problems listed by a tab that is not built yet (media, options, variants). */
export function placeholderFocusId(tab: string): string {
  return `product-${tab}-problems`;
}
