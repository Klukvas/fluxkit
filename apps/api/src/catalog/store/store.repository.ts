import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, exists, inArray, sql, type SQL } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  attribute,
  attributeOption,
  brand,
  category,
  media,
  option,
  optionValue,
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

export interface ProductListFilter {
  /** Category ids to match (the filtered category and its visible descendants); undefined = no category filter. */
  categoryIds: readonly string[] | undefined;
  brandSlug: string | undefined;
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

  private activeProductsWhere(filter: ProductListFilter): SQL | undefined {
    const conditions: (SQL | undefined)[] = [eq(product.status, "active")];
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

  /** Newest first; the id breaks ties so pages are stable. */
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
        .orderBy(desc(product.publishedAt), desc(product.id))
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

  async findActiveProductBySlug(slug: string): Promise<ProductDetailRow | undefined> {
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
      .where(and(eq(product.slug, slug), eq(product.status, "active")));
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

  /** Active variants only. */
  listActiveVariants(productId: string) {
    return this.db
      .select({ id: variant.id, sku: variant.sku, attributes: variant.attributes })
      .from(variant)
      .where(and(eq(variant.productId, productId), eq(variant.isActive, true)))
      .orderBy(asc(variant.position), asc(variant.sku), asc(variant.id));
  }

  /** Option value codes of the active variants of a product (all variants at once). */
  listActiveVariantOptionValues(productId: string) {
    return this.db
      .select({
        variantId: variantOptionValue.variantId,
        optionId: variantOptionValue.optionId,
        optionCode: option.code,
        valueCode: optionValue.code,
      })
      .from(variantOptionValue)
      .innerJoin(variant, eq(variant.id, variantOptionValue.variantId))
      .innerJoin(option, eq(option.id, variantOptionValue.optionId))
      .innerJoin(optionValue, eq(optionValue.id, variantOptionValue.optionValueId))
      .where(and(eq(variantOptionValue.productId, productId), eq(variant.isActive, true)));
  }
}
