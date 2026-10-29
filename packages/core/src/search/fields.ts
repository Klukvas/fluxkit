import type { AttributeInputType } from "../catalog/types.js";

/** Field names of a search document (ADR 0034 decision 2). The names the engine knows; nothing else is ever indexed. */
export const SEARCH_FIELDS = Object.freeze({
  id: "id",
  productId: "productId",
  productSlug: "productSlug",
  title: "title",
  brandName: "brandName",
  sku: "sku",
  optionLabels: "optionLabels",
  categoryNames: "categoryNames",
  attributeText: "attributeText",
  description: "description",
  stems: "stems",
  stems5: "stems5",
  brand: "brand",
  categories: "categories",
  price: "price",
  inStock: "inStock",
  publishedAt: "publishedAt",
});

/** Searchable fields in ranking order: title first, description last. */
export const SEARCHABLE_FIELDS: readonly string[] = [
  SEARCH_FIELDS.title,
  SEARCH_FIELDS.brandName,
  SEARCH_FIELDS.sku,
  SEARCH_FIELDS.optionLabels,
  SEARCH_FIELDS.categoryNames,
  SEARCH_FIELDS.attributeText,
  SEARCH_FIELDS.stems,
  SEARCH_FIELDS.stems5,
  SEARCH_FIELDS.description,
];

/** The text fields a typed (not stemmed) suggestion query looks at. */
export const SUGGEST_FIELDS: readonly string[] = [
  SEARCH_FIELDS.title,
  SEARCH_FIELDS.brandName,
  SEARCH_FIELDS.sku,
];

/** Filterable fields that every index has; option and attribute fields are added from the definitions. */
export const FIXED_FILTERABLE_FIELDS: readonly string[] = [
  SEARCH_FIELDS.productId,
  SEARCH_FIELDS.brand,
  SEARCH_FIELDS.categories,
  SEARCH_FIELDS.inStock,
  SEARCH_FIELDS.price,
];

/** The only fields the engine returns, defence in depth next to the document builder. */
export const DISPLAYED_FIELDS: readonly string[] = [
  SEARCH_FIELDS.id,
  SEARCH_FIELDS.productId,
  SEARCH_FIELDS.productSlug,
  SEARCH_FIELDS.title,
];

export const SORTABLE_FIELDS: readonly string[] = [SEARCH_FIELDS.price, SEARCH_FIELDS.publishedAt];

export type OptionFieldName = `opt_${string}`;
export type AttributeFieldName = `attr_${string}`;

/** Field of an option value code. The code is a catalog code (`CODE_PATTERN`), safe as a field name. */
export function optionField(code: string): OptionFieldName {
  return `opt_${code}`;
}

export function attributeField(code: string): AttributeFieldName {
  return `attr_${code}`;
}

/** Attribute input types that can be a filter (the database allows `is_filterable` for these only, ADR 0006). */
export const FILTERABLE_INPUT_TYPES: readonly AttributeInputType[] = [
  "select",
  "multiselect",
  "boolean",
  "number",
];
