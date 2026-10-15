/**
 * Plain data types the catalog logic works on. They carry no ORM or framework types:
 * the API layer maps database rows to these shapes and back.
 */

/** Translated text: locale code -> string, e.g. `{ uk: "...", en: "..." }`. */
export type I18nText = Readonly<Record<string, string>>;

export type AttributeInputType = "text" | "number" | "boolean" | "select" | "multiselect" | "date";
export type AttributeLevel = "product" | "variant";
export type ProductStatus = "draft" | "active" | "archived";

/**
 * Raw `attribute.validation` JSON as stored (snake_case keys such as `min_length`).
 * It is untrusted until parsed by `parseAttributeValidation`.
 */
export type AttributeValidation = Readonly<Record<string, unknown>>;

export interface AttributeOptionDefinition {
  readonly code: string;
}

export interface AttributeDefinition {
  readonly code: string;
  readonly inputType: AttributeInputType;
  readonly isLocalized: boolean;
  readonly unit: string | null;
  readonly validation: AttributeValidation;
  readonly isFilterable: boolean;
  readonly isSearchable: boolean;
  readonly isVisibleOnStorefront: boolean;
  readonly isComparable: boolean;
  readonly isSortable: boolean;
  readonly isInternal: boolean;
  /** Allowed values for `select` and `multiselect`; empty for the other input types. */
  readonly options: readonly AttributeOptionDefinition[];
}

export interface ProductTypeAttributeAssignment {
  readonly attribute: AttributeDefinition;
  readonly level: AttributeLevel;
  readonly isRequired: boolean;
}

export interface ProductTypeDefinition {
  readonly code: string;
  readonly attributes: readonly ProductTypeAttributeAssignment[];
  /** Codes of the options (color, size) products of this type may use. */
  readonly allowedOptionCodes: readonly string[];
}

export interface OptionValueDefinition {
  readonly code: string;
}

export interface OptionDefinition {
  readonly code: string;
  readonly values: readonly OptionValueDefinition[];
}

/** One chosen value of one option, e.g. `color` = `red`. */
export interface OptionValuePair {
  readonly optionCode: string;
  readonly valueCode: string;
}

/** Attribute values as stored in the `attributes` JSONB of a product or a variant. */
export type AttributeValues = Readonly<Record<string, unknown>>;

export interface VariantSnapshot {
  readonly sku: string;
  readonly isDefault: boolean;
  readonly isActive: boolean;
  /** The stored signature; compared with the one computed from `optionValues`. */
  readonly optionSignature: string;
  readonly optionValues: readonly OptionValuePair[];
  readonly attributes: AttributeValues;
}

export interface ProductSnapshot {
  readonly status: ProductStatus;
  readonly slug: string;
  readonly title: unknown;
  /** ISO timestamp of the first publish; `null` while the product was never published. */
  readonly publishedAt: string | null;
  readonly attributes: AttributeValues;
  /** Codes of the options the product uses (`product_option`). */
  readonly optionCodes: readonly string[];
  readonly variants: readonly VariantSnapshot[];
}

export interface CategoryNode {
  readonly id: string;
  readonly parentId: string | null;
}

/** Locale configuration (`DEFAULT_LOCALE`, `LOCALES`). The database never knows these. */
export interface LocaleConfig {
  readonly defaultLocale: string;
  readonly locales: readonly string[];
}
