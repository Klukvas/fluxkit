import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Catalog tables of ADR 0006. Conventions (ADR 0006 section 1):
 * - every constraint, index and table name is at most 63 characters (Postgres silently truncates longer names;
 *   `catalog-schema.spec.ts` asserts it), so every foreign key is named explicitly;
 * - names: `<table>_<cols>_key` (unique), `_idx` (index), `_check`, `_fkey`, `_pkey`.
 */

/** Text map `{ "<locale>": "<string>" }`. Which locales are allowed and the default locale are service rules. */
export type I18nText = Record<string, string>;
/** Attribute values keyed by attribute code. Validated by the service against the ProductType, not by the DB. */
export type AttributeValues = Record<string, unknown>;

const CODE_PATTERN = "^[a-z][a-z0-9_]{0,63}$";
const SLUG_PATTERN = "^[a-z0-9]+(-[a-z0-9]+)*$";
const SKU_PATTERN = "^[A-Z0-9][A-Z0-9._-]{0,63}$";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const position = () => integer("position").notNull().default(0);

const codeCheck = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} ~ ${sql.raw(`'${CODE_PATTERN}'`)}`);
const slugCheck = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} ~ ${sql.raw(`'${SLUG_PATTERN}'`)} AND char_length(${column}) <= 160`);
/** Required i18n text: shape and non-empty only. The default locale is checked by the service (ADR 0006 section 1). */
const requiredTextCheck = (name: string, column: AnyPgColumn) =>
  check(name, sql`jsonb_typeof(${column}) = 'object' AND ${column} <> '{}'::jsonb`);
const optionalTextCheck = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} IS NULL OR jsonb_typeof(${column}) = 'object'`);

export const attribute = pgTable(
  "attribute",
  {
    id: id(),
    code: text("code").notNull(),
    name: jsonb("name").$type<I18nText>().notNull(),
    description: jsonb("description").$type<I18nText>(),
    inputType: text("input_type").notNull(),
    isLocalized: boolean("is_localized").notNull(),
    unit: text("unit"),
    validation: jsonb("validation").$type<Record<string, unknown>>().notNull().default({}),
    isFilterable: boolean("is_filterable").notNull().default(false),
    isSearchable: boolean("is_searchable").notNull().default(false),
    isComparable: boolean("is_comparable").notNull().default(false),
    isSortable: boolean("is_sortable").notNull().default(false),
    isInternal: boolean("is_internal").notNull().default(false),
    isVisibleOnStorefront: boolean("is_visible_on_storefront").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("attribute_code_key").on(t.code),
    codeCheck("attribute_code_check", t.code),
    requiredTextCheck("attribute_name_check", t.name),
    optionalTextCheck("attribute_description_check", t.description),
    check(
      "attribute_input_type_check",
      sql`${t.inputType} IN ('text', 'number', 'boolean', 'select', 'multiselect', 'date')`,
    ),
    check("attribute_unit_check", sql`${t.unit} IS NULL OR ${t.inputType} = 'number'`),
    check("attribute_is_localized_check", sql`NOT ${t.isLocalized} OR ${t.inputType} = 'text'`),
    check(
      "attribute_is_internal_check",
      sql`NOT ${t.isInternal} OR NOT (${t.isVisibleOnStorefront} OR ${t.isFilterable} OR ${t.isSearchable} OR ${t.isComparable} OR ${t.isSortable})`,
    ),
    check(
      "attribute_is_sortable_check",
      sql`NOT ${t.isSortable} OR ${t.inputType} IN ('number', 'date')`,
    ),
    check(
      "attribute_is_filterable_check",
      sql`NOT ${t.isFilterable} OR ${t.inputType} IN ('select', 'multiselect', 'boolean', 'number')`,
    ),
    check("attribute_validation_check", sql`jsonb_typeof(${t.validation}) = 'object'`),
  ],
);

export const attributeOption = pgTable(
  "attribute_option",
  {
    id: id(),
    attributeId: uuid("attribute_id").notNull(),
    code: text("code").notNull(),
    label: jsonb("label").$type<I18nText>().notNull(),
    position: position(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "attribute_option_attribute_id_fkey",
      columns: [t.attributeId],
      foreignColumns: [attribute.id],
    }).onDelete("cascade"),
    unique("attribute_option_attribute_id_code_key").on(t.attributeId, t.code),
    codeCheck("attribute_option_code_check", t.code),
    requiredTextCheck("attribute_option_label_check", t.label),
    index("attribute_option_attribute_id_position_idx").on(t.attributeId, t.position),
  ],
);

export const option = pgTable(
  "option",
  {
    id: id(),
    code: text("code").notNull(),
    name: jsonb("name").$type<I18nText>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("option_code_key").on(t.code),
    codeCheck("option_code_check", t.code),
    requiredTextCheck("option_name_check", t.name),
  ],
);

export const optionValue = pgTable(
  "option_value",
  {
    id: id(),
    optionId: uuid("option_id").notNull(),
    code: text("code").notNull(),
    label: jsonb("label").$type<I18nText>().notNull(),
    position: position(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "option_value_option_id_fkey",
      columns: [t.optionId],
      foreignColumns: [option.id],
    }).onDelete("cascade"),
    unique("option_value_option_id_code_key").on(t.optionId, t.code),
    // Target of the composite foreign keys that guarantee "this value belongs to that option".
    unique("option_value_id_option_id_key").on(t.id, t.optionId),
    codeCheck("option_value_code_check", t.code),
    requiredTextCheck("option_value_label_check", t.label),
    index("option_value_option_id_position_idx").on(t.optionId, t.position),
  ],
);

export const productType = pgTable(
  "product_type",
  {
    id: id(),
    code: text("code").notNull(),
    name: jsonb("name").$type<I18nText>().notNull(),
    requiresShipping: boolean("requires_shipping").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("product_type_code_key").on(t.code),
    codeCheck("product_type_code_check", t.code),
    requiredTextCheck("product_type_name_check", t.name),
  ],
);

export const productTypeAttribute = pgTable(
  "product_type_attribute",
  {
    productTypeId: uuid("product_type_id").notNull(),
    attributeId: uuid("attribute_id").notNull(),
    level: text("level").notNull(),
    isRequired: boolean("is_required").notNull().default(false),
    position: position(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({
      name: "product_type_attribute_pkey",
      columns: [t.productTypeId, t.attributeId],
    }),
    foreignKey({
      name: "product_type_attribute_product_type_id_fkey",
      columns: [t.productTypeId],
      foreignColumns: [productType.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "product_type_attribute_attribute_id_fkey",
      columns: [t.attributeId],
      foreignColumns: [attribute.id],
    }).onDelete("restrict"),
    check("product_type_attribute_level_check", sql`${t.level} IN ('product', 'variant')`),
    index("product_type_attribute_attribute_id_idx").on(t.attributeId),
  ],
);

export const productTypeOption = pgTable(
  "product_type_option",
  {
    productTypeId: uuid("product_type_id").notNull(),
    optionId: uuid("option_id").notNull(),
    position: position(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "product_type_option_pkey", columns: [t.productTypeId, t.optionId] }),
    foreignKey({
      name: "product_type_option_product_type_id_fkey",
      columns: [t.productTypeId],
      foreignColumns: [productType.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "product_type_option_option_id_fkey",
      columns: [t.optionId],
      foreignColumns: [option.id],
    }).onDelete("restrict"),
    index("product_type_option_option_id_idx").on(t.optionId),
  ],
);

export const category = pgTable(
  "category",
  {
    id: id(),
    parentId: uuid("parent_id"),
    slug: text("slug").notNull(),
    name: jsonb("name").$type<I18nText>().notNull(),
    description: jsonb("description").$type<I18nText>(),
    position: position(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "category_parent_id_fkey",
      columns: [t.parentId],
      foreignColumns: [t.id],
    }).onDelete("restrict"),
    unique("category_slug_key").on(t.slug),
    slugCheck("category_slug_check", t.slug),
    requiredTextCheck("category_name_check", t.name),
    optionalTextCheck("category_description_check", t.description),
    check("category_parent_id_check", sql`${t.parentId} IS DISTINCT FROM ${t.id}`),
    index("category_parent_id_position_idx").on(t.parentId, t.position),
  ],
);

export const brand = pgTable(
  "brand",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: jsonb("name").$type<I18nText>().notNull(),
    description: jsonb("description").$type<I18nText>(),
    logoUrl: text("logo_url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("brand_slug_key").on(t.slug),
    slugCheck("brand_slug_check", t.slug),
    requiredTextCheck("brand_name_check", t.name),
    optionalTextCheck("brand_description_check", t.description),
  ],
);

export const product = pgTable(
  "product",
  {
    id: id(),
    productTypeId: uuid("product_type_id").notNull(),
    brandId: uuid("brand_id"),
    slug: text("slug").notNull(),
    title: jsonb("title").$type<I18nText>().notNull(),
    description: jsonb("description").$type<I18nText>(),
    status: text("status").notNull().default("draft"),
    attributes: jsonb("attributes").$type<AttributeValues>().notNull().default({}),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "product_product_type_id_fkey",
      columns: [t.productTypeId],
      foreignColumns: [productType.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "product_brand_id_fkey",
      columns: [t.brandId],
      foreignColumns: [brand.id],
    }).onDelete("restrict"),
    unique("product_slug_key").on(t.slug),
    slugCheck("product_slug_check", t.slug),
    requiredTextCheck("product_title_check", t.title),
    optionalTextCheck("product_description_check", t.description),
    check("product_status_check", sql`${t.status} IN ('draft', 'active', 'archived')`),
    check("product_attributes_check", sql`jsonb_typeof(${t.attributes}) = 'object'`),
    check(
      "product_published_at_check",
      sql`${t.status} <> 'active' OR ${t.publishedAt} IS NOT NULL`,
    ),
    index("product_status_published_at_id_idx").on(t.status, t.publishedAt.desc(), t.id.desc()),
    index("product_brand_id_idx").on(t.brandId),
    index("product_product_type_id_idx").on(t.productTypeId),
  ],
);

export const productCategory = pgTable(
  "product_category",
  {
    productId: uuid("product_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    position: position(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "product_category_pkey", columns: [t.productId, t.categoryId] }),
    foreignKey({
      name: "product_category_product_id_fkey",
      columns: [t.productId],
      foreignColumns: [product.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "product_category_category_id_fkey",
      columns: [t.categoryId],
      foreignColumns: [category.id],
    }).onDelete("restrict"),
    uniqueIndex("product_category_product_id_primary_key")
      .on(t.productId)
      .where(sql`${t.isPrimary}`),
    index("product_category_category_id_position_product_id_idx").on(
      t.categoryId,
      t.position,
      t.productId,
    ),
  ],
);

export const productOption = pgTable(
  "product_option",
  {
    productId: uuid("product_id").notNull(),
    optionId: uuid("option_id").notNull(),
    position: position(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "product_option_pkey", columns: [t.productId, t.optionId] }),
    foreignKey({
      name: "product_option_product_id_fkey",
      columns: [t.productId],
      foreignColumns: [product.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "product_option_option_id_fkey",
      columns: [t.optionId],
      foreignColumns: [option.id],
    }).onDelete("restrict"),
    index("product_option_option_id_idx").on(t.optionId),
  ],
);

export const productOptionValue = pgTable(
  "product_option_value",
  {
    productId: uuid("product_id").notNull(),
    optionId: uuid("option_id").notNull(),
    optionValueId: uuid("option_value_id").notNull(),
    position: position(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({
      name: "product_option_value_pkey",
      columns: [t.productId, t.optionId, t.optionValueId],
    }),
    // The product chose this option.
    foreignKey({
      name: "product_option_value_product_option_fkey",
      columns: [t.productId, t.optionId],
      foreignColumns: [productOption.productId, productOption.optionId],
    }).onDelete("cascade"),
    // The value belongs to that option.
    foreignKey({
      name: "product_option_value_option_value_fkey",
      columns: [t.optionValueId, t.optionId],
      foreignColumns: [optionValue.id, optionValue.optionId],
    }).onDelete("restrict"),
    index("product_option_value_option_value_id_idx").on(t.optionValueId),
  ],
);

export const variant = pgTable(
  "variant",
  {
    id: id(),
    productId: uuid("product_id").notNull(),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    title: jsonb("title").$type<I18nText>(),
    // Derived by the service: "<option_code>=<value_code>" pairs sorted by option code, joined with ";" ('' without options).
    optionSignature: text("option_signature").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    attributes: jsonb("attributes").$type<AttributeValues>().notNull().default({}),
    position: position(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "variant_product_id_fkey",
      columns: [t.productId],
      foreignColumns: [product.id],
    }).onDelete("cascade"),
    unique("variant_sku_key").on(t.sku),
    unique("variant_product_id_option_signature_key").on(t.productId, t.optionSignature),
    // Target of the composite foreign key that guarantees "this variant belongs to that product".
    unique("variant_id_product_id_key").on(t.id, t.productId),
    uniqueIndex("variant_product_id_default_key")
      .on(t.productId)
      .where(sql`${t.isDefault}`),
    check("variant_sku_check", sql`${t.sku} ~ ${sql.raw(`'${SKU_PATTERN}'`)}`),
    optionalTextCheck("variant_title_check", t.title),
    check("variant_attributes_check", sql`jsonb_typeof(${t.attributes}) = 'object'`),
    index("variant_product_id_position_idx").on(t.productId, t.position),
  ],
);

export const variantOptionValue = pgTable(
  "variant_option_value",
  {
    variantId: uuid("variant_id").notNull(),
    productId: uuid("product_id").notNull(),
    optionId: uuid("option_id").notNull(),
    optionValueId: uuid("option_value_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "variant_option_value_pkey", columns: [t.variantId, t.optionId] }),
    foreignKey({
      name: "variant_option_value_variant_fkey",
      columns: [t.variantId, t.productId],
      foreignColumns: [variant.id, variant.productId],
    }).onDelete("cascade"),
    foreignKey({
      name: "variant_option_value_product_option_value_fkey",
      columns: [t.productId, t.optionId, t.optionValueId],
      foreignColumns: [
        productOptionValue.productId,
        productOptionValue.optionId,
        productOptionValue.optionValueId,
      ],
    }).onDelete("restrict"),
    index("variant_option_value_product_option_value_idx").on(
      t.productId,
      t.optionId,
      t.optionValueId,
    ),
  ],
);

export const media = pgTable(
  "media",
  {
    id: id(),
    productId: uuid("product_id").notNull(),
    optionId: uuid("option_id"),
    optionValueId: uuid("option_value_id"),
    url: text("url").notNull(),
    alt: jsonb("alt").$type<I18nText>(),
    position: position(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "media_product_id_fkey",
      columns: [t.productId],
      foreignColumns: [product.id],
    }).onDelete("cascade"),
    // NULL pair = gallery image of the product; otherwise the image belongs to a value the product chose.
    foreignKey({
      name: "media_product_option_value_fkey",
      columns: [t.productId, t.optionId, t.optionValueId],
      foreignColumns: [
        productOptionValue.productId,
        productOptionValue.optionId,
        productOptionValue.optionValueId,
      ],
    }).onDelete("restrict"),
    check("media_option_pair_check", sql`(${t.optionId} IS NULL) = (${t.optionValueId} IS NULL)`),
    optionalTextCheck("media_alt_check", t.alt),
    index("media_product_id_position_idx").on(t.productId, t.position),
  ],
);
