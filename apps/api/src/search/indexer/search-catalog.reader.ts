import {
  availabilityOf,
  type AttributeDefinition,
  type I18nText,
  type SearchAttributeAssignment,
  type SearchBuildContext,
  type SearchCategoryFact,
  type SearchOptionDefinition,
  type SearchProductFacts,
  type StockLevel,
} from "@fluxkit/core";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { inputTypeSchema } from "../../catalog/admin/attributes/attributes.schemas.js";
import { attributeLevelSchema } from "../../catalog/admin/product-types/product-types.schemas.js";
import { productStatusSchema } from "../../catalog/admin/products/products.schemas.js";
import { visibleCategoryTree } from "../../catalog/store/store-categories.js";
import type { DbExecutor } from "../../common/transaction.js";
import {
  attribute,
  attributeOption,
  brand,
  category,
  inventoryLevel,
  option,
  optionValue,
  price,
  product,
  productCategory,
  productTypeAttribute,
  productTypeOption,
  variant,
  variantOptionValue,
} from "../../database/schema/index.js";

/**
 * Reads what the search documents and the index settings are built from (ADR 0034 decision 2), in batched queries
 * (no N+1): the catalog definitions once per run, the products page by page. Facts only: what reaches a document is
 * decided by core `buildSearchDocuments`, which filters out internal and hidden attributes, inactive or unpriced
 * variants and products that are not active. This reader never decides visibility of attribute data itself.
 */

/** The definitions shared by every product of a run. */
export interface SearchDefinitions {
  /** Attribute assignments per product type, in the type's position order. */
  readonly assignmentsByType: ReadonlyMap<string, readonly SearchAttributeAssignment[]>;
  /** Every assignment of every type: the settings and the facets are derived from them. */
  readonly allAssignments: readonly SearchAttributeAssignment[];
  /** Every option with its values (labels for documents and facets). */
  readonly options: readonly SearchOptionDefinition[];
  /** Codes of the options assigned to some product type (each becomes an `opt_<code>` filter). */
  readonly typeOptionCodes: readonly { readonly code: string }[];
  /** The categories the store shows (active, with every ancestor active), with their ancestors. */
  readonly categories: ReadonlyMap<string, SearchCategoryFact>;
  /** Attribute code to its name (facet labels). */
  readonly attributeNames: ReadonlyMap<string, I18nText>;
}

export interface SearchProductRecord {
  readonly productTypeId: string;
  readonly facts: SearchProductFacts;
}

export async function readSearchDefinitions(db: DbExecutor): Promise<SearchDefinitions> {
  const attributeRows = await db.select().from(attribute).orderBy(asc(attribute.code));
  const attributeOptionRows = await db
    .select()
    .from(attributeOption)
    .orderBy(asc(attributeOption.position), asc(attributeOption.code));
  const definitions = new Map<string, AttributeDefinition>();
  for (const row of attributeRows) {
    definitions.set(row.id, {
      code: row.code,
      inputType: inputTypeSchema.parse(row.inputType),
      isLocalized: row.isLocalized,
      unit: row.unit,
      validation: row.validation,
      isFilterable: row.isFilterable,
      isSearchable: row.isSearchable,
      isVisibleOnStorefront: row.isVisibleOnStorefront,
      isComparable: row.isComparable,
      isSortable: row.isSortable,
      isInternal: row.isInternal,
      options: attributeOptionRows
        .filter((entry) => entry.attributeId === row.id)
        .map(({ code, label, position }) => ({ code, label, position })),
    });
  }

  const assignmentRows = await db
    .select()
    .from(productTypeAttribute)
    .orderBy(
      asc(productTypeAttribute.productTypeId),
      asc(productTypeAttribute.position),
      asc(productTypeAttribute.attributeId),
    );
  const assignmentsByType = new Map<string, SearchAttributeAssignment[]>();
  const allAssignments: SearchAttributeAssignment[] = [];
  for (const row of assignmentRows) {
    const definition = definitions.get(row.attributeId);
    if (definition === undefined) {
      throw new Error("A product type assigns an attribute that does not exist.");
    }
    const assignment = { definition, level: attributeLevelSchema.parse(row.level) };
    assignmentsByType.set(row.productTypeId, [
      ...(assignmentsByType.get(row.productTypeId) ?? []),
      assignment,
    ]);
    allAssignments.push(assignment);
  }

  const optionRows = await db.select().from(option).orderBy(asc(option.code));
  const valueRows = await db
    .select()
    .from(optionValue)
    .orderBy(asc(optionValue.position), asc(optionValue.code));
  const options: SearchOptionDefinition[] = optionRows.map((row) => ({
    code: row.code,
    label: row.name,
    values: valueRows
      .filter((value) => value.optionId === row.id)
      .map((value) => ({ code: value.code, label: value.label })),
  }));
  const typeOptionRows = await db
    .selectDistinct({ code: option.code })
    .from(productTypeOption)
    .innerJoin(option, eq(option.id, productTypeOption.optionId))
    .orderBy(asc(option.code));

  const activeCategories = await db
    .select({
      id: category.id,
      parentId: category.parentId,
      slug: category.slug,
      name: category.name,
      description: category.description,
      position: category.position,
    })
    .from(category)
    .where(eq(category.isActive, true));
  const categories = new Map<string, SearchCategoryFact>();
  const walk = (
    nodes: ReturnType<typeof visibleCategoryTree>,
    ancestors: readonly string[],
  ): void => {
    for (const node of nodes) {
      categories.set(node.row.id, {
        id: node.row.id,
        name: node.row.name,
        ancestorIds: ancestors,
      });
      walk(node.children, [...ancestors, node.row.id]);
    }
  };
  walk(visibleCategoryTree(activeCategories), []);

  return {
    assignmentsByType,
    allAssignments,
    options,
    typeOptionCodes: typeOptionRows,
    categories,
    attributeNames: new Map(attributeRows.map((row) => [row.code, row.name])),
  };
}

export function buildContextFor(
  definitions: SearchDefinitions,
  productTypeId: string,
  locale: string,
  defaultLocale: string,
): SearchBuildContext {
  return {
    locale,
    defaultLocale,
    attributes: definitions.assignmentsByType.get(productTypeId) ?? [],
    options: definitions.options,
  };
}

/**
 * The current facts of the given products (missing ids are simply absent: the product was deleted). Prices are the shop
 * currency's only; availability is core `availabilityOf` over every location's level.
 */
export async function readSearchProducts(
  db: DbExecutor,
  productIds: readonly string[],
  definitions: SearchDefinitions,
  pricing: { readonly shopCurrency: string; readonly lowStockThreshold: number },
): Promise<SearchProductRecord[]> {
  if (productIds.length === 0) {
    return [];
  }
  const productRows = await db
    .select({
      id: product.id,
      productTypeId: product.productTypeId,
      slug: product.slug,
      status: product.status,
      publishedAt: product.publishedAt,
      title: product.title,
      description: product.description,
      attributes: product.attributes,
      brandSlug: brand.slug,
      brandName: brand.name,
    })
    .from(product)
    .leftJoin(brand, eq(brand.id, product.brandId))
    .where(inArray(product.id, [...productIds]))
    .orderBy(asc(product.id));
  if (productRows.length === 0) {
    return [];
  }
  const ids = productRows.map((row) => row.id);
  const variantRows = await db
    .select({
      id: variant.id,
      productId: variant.productId,
      sku: variant.sku,
      isActive: variant.isActive,
      trackInventory: variant.trackInventory,
      allowBackorder: variant.allowBackorder,
      attributes: variant.attributes,
      position: variant.position,
    })
    .from(variant)
    .where(inArray(variant.productId, ids))
    .orderBy(asc(variant.productId), asc(variant.position), asc(variant.id));
  const variantIds = variantRows.map((row) => row.id);
  const priceRows =
    variantIds.length === 0
      ? []
      : await db
          .select({ variantId: price.variantId, amount: price.amount })
          .from(price)
          .where(
            and(inArray(price.variantId, variantIds), eq(price.currency, pricing.shopCurrency)),
          );
  const levelRows =
    variantIds.length === 0
      ? []
      : await db
          .select({
            variantId: inventoryLevel.variantId,
            onHand: inventoryLevel.onHand,
            reserved: inventoryLevel.reserved,
          })
          .from(inventoryLevel)
          .where(inArray(inventoryLevel.variantId, variantIds));
  const pairRows =
    variantIds.length === 0
      ? []
      : await db
          .select({
            variantId: variantOptionValue.variantId,
            optionCode: option.code,
            valueCode: optionValue.code,
          })
          .from(variantOptionValue)
          .innerJoin(option, eq(option.id, variantOptionValue.optionId))
          .innerJoin(optionValue, eq(optionValue.id, variantOptionValue.optionValueId))
          .where(inArray(variantOptionValue.variantId, variantIds));
  const categoryRows = await db
    .select({ productId: productCategory.productId, categoryId: productCategory.categoryId })
    .from(productCategory)
    .where(inArray(productCategory.productId, ids))
    .orderBy(asc(productCategory.productId), asc(productCategory.position));

  const priceOf = new Map(priceRows.map((row) => [row.variantId, row.amount]));
  const levelsOf = groupBy(levelRows, (row) => row.variantId);
  const pairsOf = groupBy(pairRows, (row) => row.variantId);
  const variantsOf = groupBy(variantRows, (row) => row.productId);
  const categoriesOf = groupBy(categoryRows, (row) => row.productId);

  return productRows.map((row) => ({
    productTypeId: row.productTypeId,
    facts: {
      id: row.id,
      slug: row.slug,
      status: productStatusSchema.parse(row.status),
      publishedAt: row.publishedAt?.toISOString() ?? null,
      title: row.title,
      description: row.description,
      brand:
        row.brandSlug === null || row.brandName === null
          ? null
          : { slug: row.brandSlug, name: row.brandName as I18nText },
      // Only the categories the store shows; a hidden one never reaches a document.
      categories: (categoriesOf.get(row.id) ?? []).flatMap((entry) => {
        const fact = definitions.categories.get(entry.categoryId);
        return fact === undefined ? [] : [fact];
      }),
      attributes: row.attributes,
      variants: (variantsOf.get(row.id) ?? []).map((entry) => ({
        id: entry.id,
        sku: entry.sku,
        isActive: entry.isActive,
        shopPrice: priceOf.get(entry.id) ?? null,
        availability: availabilityOf(
          { trackInventory: entry.trackInventory, allowBackorder: entry.allowBackorder },
          (levelsOf.get(entry.id) ?? []).map((level): StockLevel => ({
            onHand: level.onHand,
            reserved: level.reserved,
          })),
          pricing.lowStockThreshold,
        ),
        optionValues: (pairsOf.get(entry.id) ?? []).map((pair) => ({
          optionCode: pair.optionCode,
          valueCode: pair.valueCode,
        })),
        attributes: entry.attributes,
      })),
    },
  }));
}

/** The next page of ACTIVE product ids after `cursor` (a rebuild indexes nothing else: other products have no documents). */
export async function nextActiveProductIds(
  db: DbExecutor,
  cursor: string | null,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: product.id })
    .from(product)
    .where(
      cursor === null
        ? eq(product.status, "active")
        : and(eq(product.status, "active"), gt(product.id, cursor)),
    )
    .orderBy(asc(product.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const list = grouped.get(id);
    if (list === undefined) {
      grouped.set(id, [row]);
    } else {
      list.push(row);
    }
  }
  return grouped;
}
