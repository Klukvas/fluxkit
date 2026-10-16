import { Injectable } from "@nestjs/common";
import { and, asc, eq, exists, inArray, like, type SQL } from "drizzle-orm";
import type { PaginationQuery } from "../../../common/pagination.js";
import type { DbExecutor } from "../../../common/transaction.js";
import {
  attribute,
  attributeOption,
  brand,
  category,
  media,
  option,
  optionValue,
  price,
  product,
  productCategory,
  productOption,
  productOptionValue,
  productType,
  productTypeAttribute,
  productTypeOption,
  variant,
  variantOptionValue,
} from "../../../database/schema/index.js";
import { required } from "../../shared/rules.js";

export type ProductRow = typeof product.$inferSelect;
export type NewProduct = typeof product.$inferInsert;
export type ProductChanges = Partial<
  Pick<
    NewProduct,
    "title" | "description" | "brandId" | "slug" | "attributes" | "status" | "publishedAt"
  >
>;
export type NewVariant = typeof variant.$inferInsert;
export type VariantRow = typeof variant.$inferSelect;
export type MediaRow = typeof media.$inferSelect;
export type NewMedia = Omit<
  typeof media.$inferInsert,
  "id" | "productId" | "createdAt" | "updatedAt"
>;
export type CategoryAssignmentRow = typeof productCategory.$inferSelect;
type AttributeRow = typeof attribute.$inferSelect;

export interface ProductTypeRows {
  code: string;
  assignments: { level: string; isRequired: boolean; attribute: AttributeRow }[];
  attributeOptions: {
    attributeId: string;
    code: string;
    label: Record<string, string>;
    position: number;
  }[];
  allowedOptionCodes: string[];
}

export interface VariantOptionValueRow {
  variantId: string;
  optionId: string;
  optionCode: string;
  optionValueId: string;
  valueCode: string;
}

export interface ProductOptionRow {
  optionId: string;
  optionCode: string;
  position: number;
}

export interface ProductOptionValueRow {
  optionId: string;
  optionValueId: string;
  valueCode: string;
  position: number;
}

export interface ProductListFilter {
  status?: string | undefined;
  categoryId?: string | undefined;
  brandId?: string | undefined;
}

/** Queries only (Drizzle query builder, parameterized). Every method runs on the executor it is given. */
@Injectable()
export class ProductsRepository {
  async insertProduct(db: DbExecutor, values: NewProduct): Promise<ProductRow> {
    const [row] = await db.insert(product).values(values).returning();
    return required(row);
  }

  async insertVariant(db: DbExecutor, values: NewVariant): Promise<VariantRow> {
    const [row] = await db.insert(variant).values(values).returning();
    return required(row);
  }

  async findById(db: DbExecutor, id: string): Promise<ProductRow | undefined> {
    const [row] = await db.select().from(product).where(eq(product.id, id));
    return row;
  }

  /** Locks the row until the transaction ends, so lifecycle, edits and child replacements are serialized. */
  async findByIdForUpdate(db: DbExecutor, id: string): Promise<ProductRow | undefined> {
    const [row] = await db.select().from(product).where(eq(product.id, id)).for("update");
    return row;
  }

  /** Stable order: slug, then id. */
  async list(
    db: DbExecutor,
    page: PaginationQuery,
    filter: ProductListFilter,
  ): Promise<{ rows: ProductRow[]; total: number }> {
    const conditions: (SQL | undefined)[] = [
      filter.status === undefined ? undefined : eq(product.status, filter.status),
      filter.brandId === undefined ? undefined : eq(product.brandId, filter.brandId),
      filter.categoryId === undefined
        ? undefined
        : exists(
            db
              .select({ one: productCategory.productId })
              .from(productCategory)
              .where(
                and(
                  eq(productCategory.productId, product.id),
                  eq(productCategory.categoryId, filter.categoryId),
                ),
              ),
          ),
    ];
    const where = and(...conditions);
    const [rows, total] = await Promise.all([
      db
        .select()
        .from(product)
        .where(where)
        .orderBy(asc(product.slug), asc(product.id))
        .limit(page.limit)
        .offset(page.offset),
      db.$count(product, where),
    ]);
    return { rows, total };
  }

  async update(
    db: DbExecutor,
    id: string,
    changes: ProductChanges,
  ): Promise<ProductRow | undefined> {
    // `updated_at` is refreshed by the column's $onUpdate, which only the query builder applies.
    const [row] = await db.update(product).set(changes).where(eq(product.id, id)).returning();
    return row;
  }

  async delete(db: DbExecutor, id: string): Promise<void> {
    await db.delete(product).where(eq(product.id, id));
  }

  async brandExists(db: DbExecutor, id: string): Promise<boolean> {
    return (await db.$count(brand, eq(brand.id, id))) > 0;
  }

  /** Slugs that start with `prefix`, to let core pick the next free `-2`, `-3` suffix. `prefix` is a slug (a-z, 0-9, `-`). */
  async findSlugsStartingWith(db: DbExecutor, prefix: string): Promise<Set<string>> {
    const rows = await db
      .select({ slug: product.slug })
      .from(product)
      .where(like(product.slug, `${prefix}%`));
    return new Set(rows.map((row) => row.slug));
  }

  /** SKUs that start with `prefix` (uppercase letters, digits, `-`). */
  async findSkusStartingWith(db: DbExecutor, prefix: string): Promise<Set<string>> {
    const rows = await db
      .select({ sku: variant.sku })
      .from(variant)
      .where(like(variant.sku, `${prefix}%`));
    return new Set(rows.map((row) => row.sku));
  }

  /** Whether the product type ships goods; variants of a type that does not (digital) start untracked. */
  async requiresShipping(db: DbExecutor, productTypeId: string): Promise<boolean> {
    const [row] = await db
      .select({ requiresShipping: productType.requiresShipping })
      .from(productType)
      .where(eq(productType.id, productTypeId));
    if (row === undefined) {
      throw new Error(`Product type ${productTypeId} is missing.`);
    }
    return row.requiresShipping;
  }

  /** The product type with the attribute definitions (and select options) and option codes core needs. */
  async findProductTypeRows(db: DbExecutor, id: string): Promise<ProductTypeRows | undefined> {
    const [type] = await db.select().from(productType).where(eq(productType.id, id));
    if (type === undefined) {
      return undefined;
    }
    const assignments = await db
      .select({
        level: productTypeAttribute.level,
        isRequired: productTypeAttribute.isRequired,
        attribute,
      })
      .from(productTypeAttribute)
      .innerJoin(attribute, eq(attribute.id, productTypeAttribute.attributeId))
      .where(eq(productTypeAttribute.productTypeId, id))
      .orderBy(asc(productTypeAttribute.position), asc(attribute.code));
    const attributeIds = assignments.map((assignment) => assignment.attribute.id);
    const attributeOptions =
      attributeIds.length === 0
        ? []
        : await db
            .select({
              attributeId: attributeOption.attributeId,
              code: attributeOption.code,
              label: attributeOption.label,
              position: attributeOption.position,
            })
            .from(attributeOption)
            .where(inArray(attributeOption.attributeId, attributeIds))
            .orderBy(asc(attributeOption.position), asc(attributeOption.code));
    const allowedOptions = await db
      .select({ code: option.code })
      .from(productTypeOption)
      .innerJoin(option, eq(option.id, productTypeOption.optionId))
      .where(eq(productTypeOption.productTypeId, id))
      .orderBy(asc(productTypeOption.position), asc(option.code));
    return {
      code: type.code,
      assignments,
      attributeOptions,
      allowedOptionCodes: allowedOptions.map((row) => row.code),
    };
  }

  /** Position, then id. */
  listVariants(db: DbExecutor, productId: string): Promise<VariantRow[]> {
    return db
      .select()
      .from(variant)
      .where(eq(variant.productId, productId))
      .orderBy(asc(variant.position), asc(variant.sku), asc(variant.id));
  }

  /** Ids of the product's variants that have a price in `currency`: one query for the whole product (no N+1). */
  async findVariantIdsWithPrice(
    db: DbExecutor,
    productId: string,
    currency: string,
  ): Promise<Set<string>> {
    const rows = await db
      .select({ variantId: price.variantId })
      .from(price)
      .innerJoin(variant, eq(variant.id, price.variantId))
      .where(and(eq(variant.productId, productId), eq(price.currency, currency)));
    return new Set(rows.map((row) => row.variantId));
  }

  listVariantOptionValues(db: DbExecutor, productId: string): Promise<VariantOptionValueRow[]> {
    return db
      .select({
        variantId: variantOptionValue.variantId,
        optionId: variantOptionValue.optionId,
        optionCode: option.code,
        optionValueId: variantOptionValue.optionValueId,
        valueCode: optionValue.code,
      })
      .from(variantOptionValue)
      .innerJoin(option, eq(option.id, variantOptionValue.optionId))
      .innerJoin(optionValue, eq(optionValue.id, variantOptionValue.optionValueId))
      .where(eq(variantOptionValue.productId, productId))
      .orderBy(asc(option.code));
  }

  /** Position, then option code. */
  listProductOptions(db: DbExecutor, productId: string): Promise<ProductOptionRow[]> {
    return db
      .select({
        optionId: productOption.optionId,
        optionCode: option.code,
        position: productOption.position,
      })
      .from(productOption)
      .innerJoin(option, eq(option.id, productOption.optionId))
      .where(eq(productOption.productId, productId))
      .orderBy(asc(productOption.position), asc(option.code));
  }

  /** Position, then value code. */
  listProductOptionValues(db: DbExecutor, productId: string): Promise<ProductOptionValueRow[]> {
    return db
      .select({
        optionId: productOptionValue.optionId,
        optionValueId: productOptionValue.optionValueId,
        valueCode: optionValue.code,
        position: productOptionValue.position,
      })
      .from(productOptionValue)
      .innerJoin(optionValue, eq(optionValue.id, productOptionValue.optionValueId))
      .where(eq(productOptionValue.productId, productId))
      .orderBy(asc(productOptionValue.position), asc(optionValue.code));
  }

  /** Position, then category id. */
  listCategoryAssignments(db: DbExecutor, productId: string): Promise<CategoryAssignmentRow[]> {
    return db
      .select()
      .from(productCategory)
      .where(eq(productCategory.productId, productId))
      .orderBy(asc(productCategory.position), asc(productCategory.categoryId));
  }

  async findExistingCategoryIds(db: DbExecutor, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) {
      return new Set();
    }
    const rows = await db
      .select({ id: category.id })
      .from(category)
      .where(inArray(category.id, [...ids]));
    return new Set(rows.map((row) => row.id));
  }

  /** Replaces the whole set: delete first, so the partial unique index on the primary never sees two rows. */
  async replaceCategoryAssignments(
    db: DbExecutor,
    productId: string,
    assignments: readonly { categoryId: string; position: number; isPrimary: boolean }[],
  ): Promise<void> {
    await db.delete(productCategory).where(eq(productCategory.productId, productId));
    if (assignments.length > 0) {
      await db
        .insert(productCategory)
        .values(assignments.map((assignment) => ({ productId, ...assignment })));
    }
  }

  /** Position, then id. */
  listMedia(db: DbExecutor, productId: string): Promise<MediaRow[]> {
    return db
      .select()
      .from(media)
      .where(eq(media.productId, productId))
      .orderBy(asc(media.position), asc(media.id));
  }

  async replaceMedia(db: DbExecutor, productId: string, items: readonly NewMedia[]): Promise<void> {
    await db.delete(media).where(eq(media.productId, productId));
    if (items.length > 0) {
      await db.insert(media).values(items.map((item) => ({ productId, ...item })));
    }
  }
}
