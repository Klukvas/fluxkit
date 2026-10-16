import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, exists, inArray, sql, type SQL } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  attribute,
  attributeOption,
  brand,
  category,
  inventoryLevel,
  media,
  option,
  optionValue,
  price,
  product,
  productCategory,
  productOption,
  productOptionValue,
  productTypeAttribute,
  variant,
  variantOptionValue,
} from "../../database/schema/index.js";
import type { I18nText } from "../../database/schema/catalog.js";

type AttributeRow = typeof attribute.$inferSelect;

export interface ActiveCategoryRow {
  id: string;
  parentId: string | null;
  slug: string;
  name: I18nText;
  description: I18nText | null;
  position: number;
}

export interface ProductListRow {
  id: string;
  slug: string;
  title: I18nText;
  publishedAt: Date | null;
  brandSlug: string | null;
  brandName: I18nText | null;
}

export interface ProductMediaRow {
  productId: string;
  url: string;
  alt: I18nText | null;
  optionValueId: string | null;
}

export interface ProductDetailRow {
  id: string;
  productTypeId: string;
  slug: string;
  title: I18nText;
  description: I18nText | null;
  attributes: Record<string, unknown>;
  publishedAt: Date | null;
  brandSlug: string | null;
  brandName: I18nText | null;
}

/** One attribute assigned to a product type, with its select options (position, then code). */
export interface TypeAttributeRow {
  level: string;
  attribute: AttributeRow;
  options: { code: string; label: I18nText; position: number }[];
}

/** An active variant with its price in the shop currency (the join drops active variants that have none). */
export interface SellableVariantRow {
  id: string;
  productId: string;
  sku: string;
  attributes: Record<string, unknown>;
  trackInventory: boolean;
  allowBackorder: boolean;
  priceAmount: number;
  priceCurrency: string;
  compareAtAmount: number | null;
}

/** One `inventory_level` row of an active variant, any location. Quantities stay inside the API (never serialized). */
export interface StockLevelRow {
  variantId: string;
  onHand: number;
  reserved: number;
}

export interface ProductListFilter {
  /** Category ids to match (the filtered category and its visible descendants); undefined = no category filter. */
  categoryIds: readonly string[] | undefined;
  brandSlug: string | undefined;
  /** `SHOP_CURRENCY`: a listed product has an active variant with a price in it. */
  shopCurrency: string;
}

/**
 * Read-only queries of the public store API (Drizzle query builder, parameterized). Every method that returns many
 * rows is keyed by a set of ids or a product id, never called per row: the services batch their loads.
 * Visibility rules that belong to a table (status, `is_active`) are in the SQL, the tree rule is in `store-categories.ts`.
 */
@Injectable()
export class StoreRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Active categories only; whether their ancestors are active too is decided by `visibleCategories`. */
  listActiveCategories(): Promise<ActiveCategoryRow[]> {
    return this.db
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
  }

  /**
   * The store shows a product only if it has at least one sellable variant: active and priced in the shop currency.
   * Used by the list (so `total` and the pages count only shown products) and by the detail (404 otherwise).
   */
  private hasSellableVariant(shopCurrency: string): SQL {
    return exists(
      this.db
        .select({ one: sql`1` })
        .from(variant)
        .innerJoin(price, eq(price.variantId, variant.id))
        .where(
          and(
            eq(variant.productId, product.id),
            eq(variant.isActive, true),
            eq(price.currency, shopCurrency),
          ),
        ),
    );
  }

  private activeProductsWhere(filter: ProductListFilter): SQL | undefined {
    const conditions: (SQL | undefined)[] = [
      eq(product.status, "active"),
      this.hasSellableVariant(filter.shopCurrency),
    ];
    if (filter.brandSlug !== undefined) {
      conditions.push(
        inArray(
          product.brandId,
          this.db.select({ id: brand.id }).from(brand).where(eq(brand.slug, filter.brandSlug)),
        ),
      );
    }
    if (filter.categoryIds !== undefined) {
      conditions.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(productCategory)
            .where(
              and(
                eq(productCategory.productId, product.id),
                inArray(productCategory.categoryId, [...filter.categoryIds]),
              ),
            ),
        ),
      );
    }
    return and(...conditions);
  }

  /**
   * Newest first; the id breaks ties so pages are stable. The explicit `nulls last` matches the index
   * `product_status_published_at_id_idx`, so Postgres reads it in order instead of sorting (active products
   * never have a NULL `published_at`, so the visible order is the same).
   */
  async listProducts(
    filter: ProductListFilter,
    page: { limit: number; offset: number },
  ): Promise<{ rows: ProductListRow[]; total: number }> {
    const where = this.activeProductsWhere(filter);
    const [rows, total] = await Promise.all([
      this.db
        .select({
          id: product.id,
          slug: product.slug,
          title: product.title,
          publishedAt: product.publishedAt,
          brandSlug: brand.slug,
          brandName: brand.name,
        })
        .from(product)
        .leftJoin(brand, eq(brand.id, product.brandId))
        .where(where)
        .orderBy(sql`${product.publishedAt} desc nulls last`, sql`${product.id} desc nulls last`)
        .limit(page.limit)
        .offset(page.offset),
      this.db.$count(product, where),
    ]);
    return { rows, total };
  }

  /** Media of many products in one query, in display order. */
  listMediaForProducts(productIds: readonly string[]): Promise<ProductMediaRow[]> {
    if (productIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.db
      .select({
        productId: media.productId,
        url: media.url,
        alt: media.alt,
        optionValueId: media.optionValueId,
      })
      .from(media)
      .where(inArray(media.productId, [...productIds]))
      .orderBy(asc(media.position), asc(media.id));
  }

  async findActiveProductBySlug(
    slug: string,
    shopCurrency: string,
  ): Promise<ProductDetailRow | undefined> {
    const [row] = await this.db
      .select({
        id: product.id,
        productTypeId: product.productTypeId,
        slug: product.slug,
        title: product.title,
        description: product.description,
        attributes: product.attributes,
        publishedAt: product.publishedAt,
        brandSlug: brand.slug,
        brandName: brand.name,
      })
      .from(product)
      .leftJoin(brand, eq(brand.id, product.brandId))
      .where(
        and(
          eq(product.slug, slug),
          eq(product.status, "active"),
          this.hasSellableVariant(shopCurrency),
        ),
      );
    return row;
  }

  /** The category ids a product is assigned to, primary first. Visibility is applied by the caller. */
  async listCategoryIds(productId: string): Promise<string[]> {
    const rows = await this.db
      .select({ categoryId: productCategory.categoryId })
      .from(productCategory)
      .where(eq(productCategory.productId, productId))
      .orderBy(
        desc(productCategory.isPrimary),
        asc(productCategory.position),
        asc(productCategory.categoryId),
      );
    return rows.map((row) => row.categoryId);
  }

  /** Attribute assignments of a product type with their select options, in one query. */
  async listTypeAttributes(productTypeId: string): Promise<TypeAttributeRow[]> {
    const rows = await this.db
      .select({
        level: productTypeAttribute.level,
        attribute,
        optionCode: attributeOption.code,
        optionLabel: attributeOption.label,
        optionPosition: attributeOption.position,
      })
      .from(productTypeAttribute)
      .innerJoin(attribute, eq(attribute.id, productTypeAttribute.attributeId))
      .leftJoin(attributeOption, eq(attributeOption.attributeId, attribute.id))
      .where(eq(productTypeAttribute.productTypeId, productTypeId))
      .orderBy(
        asc(productTypeAttribute.position),
        asc(attribute.code),
        asc(attributeOption.position),
        asc(attributeOption.code),
      );
    const assignments = new Map<string, TypeAttributeRow>();
    for (const row of rows) {
      const existing = assignments.get(row.attribute.id) ?? {
        level: row.level,
        attribute: row.attribute,
        options: [],
      };
      if (row.optionCode !== null && row.optionLabel !== null && row.optionPosition !== null) {
        existing.options.push({
          code: row.optionCode,
          label: row.optionLabel,
          position: row.optionPosition,
        });
      }
      assignments.set(row.attribute.id, existing);
    }
    return [...assignments.values()];
  }

  listProductOptions(productId: string) {
    return this.db
      .select({ id: option.id, code: option.code, name: option.name })
      .from(productOption)
      .innerJoin(option, eq(option.id, productOption.optionId))
      .where(eq(productOption.productId, productId))
      .orderBy(asc(productOption.position), asc(option.code));
  }

  /** The values the product chose (all options at once), in the product's order. */
  listProductOptionValues(productId: string) {
    return this.db
      .select({
        id: optionValue.id,
        optionId: optionValue.optionId,
        code: optionValue.code,
        label: optionValue.label,
      })
      .from(productOptionValue)
      .innerJoin(optionValue, eq(optionValue.id, productOptionValue.optionValueId))
      .where(eq(productOptionValue.productId, productId))
      .orderBy(asc(productOptionValue.position), asc(optionValue.position), asc(optionValue.code));
  }

  /**
   * Active variants with their shop-currency price, of many products in one query, in display order. A price in any
   * other currency never leaves the database: it is not selected and not joined.
   */
  listSellableVariants(
    productIds: readonly string[],
    shopCurrency: string,
  ): Promise<SellableVariantRow[]> {
    if (productIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.db
      .select({
        id: variant.id,
        productId: variant.productId,
        sku: variant.sku,
        attributes: variant.attributes,
        trackInventory: variant.trackInventory,
        allowBackorder: variant.allowBackorder,
        priceAmount: price.amount,
        priceCurrency: price.currency,
        compareAtAmount: price.compareAtAmount,
      })
      .from(variant)
      .innerJoin(price, and(eq(price.variantId, variant.id), eq(price.currency, shopCurrency)))
      .where(and(inArray(variant.productId, [...productIds]), eq(variant.isActive, true)))
      .orderBy(asc(variant.position), asc(variant.sku), asc(variant.id));
  }

  /** The inventory levels (all locations) of the active variants of many products, in one query. */
  listStockLevels(productIds: readonly string[]): Promise<StockLevelRow[]> {
    if (productIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.db
      .select({
        variantId: inventoryLevel.variantId,
        onHand: inventoryLevel.onHand,
        reserved: inventoryLevel.reserved,
      })
      .from(inventoryLevel)
      .innerJoin(variant, eq(variant.id, inventoryLevel.variantId))
      .where(and(inArray(variant.productId, [...productIds]), eq(variant.isActive, true)));
  }

  /** Option value codes of the active variants of a product (all variants at once). */
  listActiveVariantOptionValues(productId: string) {
    return this.db
      .select({
        variantId: variantOptionValue.variantId,
        optionId: variantOptionValue.optionId,
        optionCode: option.code,
        optionValueId: variantOptionValue.optionValueId,
        valueCode: optionValue.code,
      })
      .from(variantOptionValue)
      .innerJoin(variant, eq(variant.id, variantOptionValue.variantId))
      .innerJoin(option, eq(option.id, variantOptionValue.optionId))
      .innerJoin(optionValue, eq(optionValue.id, variantOptionValue.optionValueId))
      .where(and(eq(variantOptionValue.productId, productId), eq(variant.isActive, true)));
  }
}
