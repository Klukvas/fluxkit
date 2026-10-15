/** Catalog limits, ADR 0006 section 9. Enforced by the service layer, not by the database. */
export const CATALOG_LIMITS = Object.freeze({
  maxOptionsPerProduct: 3,
  maxValuesPerProductOption: 30,
  maxVariantsPerProduct: 250,
  maxNewVariantsPerGenerate: 250,
  maxCategoryDepth: 5,
  maxAttributesPerProductType: 100,
  maxOptionsPerAttribute: 500,
  maxValuesPerOption: 500,
  defaultPageSize: 24,
  maxPageSize: 100,
  maxOffset: 10000,
});

/** Caps on untrusted text input. Lengths are counted in Unicode code points. */
export const TEXT_LIMITS = Object.freeze({
  code: 64,
  slug: 160,
  sku: 64,
  barcode: 64,
  url: 2048,
  title: 255,
  name: 255,
  label: 255,
  description: 20000,
  alt: 255,
  unit: 16,
  /** Maximum size of the `attributes` JSONB of a product or a variant, in UTF-8 bytes. */
  attributesJsonBytes: 65536,
});

/** Defaults for attribute `validation` keys that are omitted (ADR 0006 section 4). */
export const ATTRIBUTE_VALIDATION_DEFAULTS = Object.freeze({
  minLength: 1,
  maxLength: 1000,
  maxDecimals: 3,
  minItems: 1,
  maxItems: 50,
});

/** Shape of option, option value, attribute and product type codes (also a DB CHECK). */
export const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
