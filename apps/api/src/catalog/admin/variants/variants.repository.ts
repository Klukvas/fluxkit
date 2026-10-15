import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { PaginationQuery } from "../../../common/pagination.js";
import type { DbExecutor } from "../../../common/transaction.js";
import {
  option,
  optionValue,
  variant,
  variantOptionValue,
} from "../../../database/schema/index.js";
import { required } from "../../shared/rules.js";
import type {
  NewVariant,
  VariantOptionValueRow,
  VariantRow,
} from "../products/products.repository.js";

export type VariantChanges = Partial<
  Pick<NewVariant, "sku" | "barcode" | "attributes" | "isActive" | "isDefault" | "position">
>;
export type NewVariantOptionValue = typeof variantOptionValue.$inferInsert;

/** Queries only (Drizzle query builder, parameterized). Every method runs on the executor it is given. */
@Injectable()
export class VariantsRepository {
  async findVariant(
    db: DbExecutor,
    productId: string,
    variantId: string,
  ): Promise<VariantRow | undefined> {
    const [row] = await db
      .select()
      .from(variant)
      .where(and(eq(variant.id, variantId), eq(variant.productId, productId)));
    return row;
  }

  /** Position, then SKU, then id (the order of the product detail). */
  async listPage(
    db: DbExecutor,
    productId: string,
    page: PaginationQuery,
  ): Promise<{ rows: VariantRow[]; total: number }> {
    const where = eq(variant.productId, productId);
    const [rows, total] = await Promise.all([
      db
        .select()
        .from(variant)
        .where(where)
        .orderBy(asc(variant.position), asc(variant.sku), asc(variant.id))
        .limit(page.limit)
        .offset(page.offset),
      db.$count(variant, where),
    ]);
    return { rows, total };
  }

  async listOptionValues(
    db: DbExecutor,
    variantIds: readonly string[],
  ): Promise<VariantOptionValueRow[]> {
    if (variantIds.length === 0) {
      return [];
    }
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
      .where(inArray(variantOptionValue.variantId, [...variantIds]))
      .orderBy(asc(option.code));
  }

  async insertVariants(db: DbExecutor, values: readonly NewVariant[]): Promise<VariantRow[]> {
    if (values.length === 0) {
      return [];
    }
    return db
      .insert(variant)
      .values([...values])
      .returning();
  }

  async insertVariant(db: DbExecutor, values: NewVariant): Promise<VariantRow> {
    const [row] = await db.insert(variant).values(values).returning();
    return required(row);
  }

  async insertOptionValues(
    db: DbExecutor,
    values: readonly NewVariantOptionValue[],
  ): Promise<void> {
    if (values.length > 0) {
      await db.insert(variantOptionValue).values([...values]);
    }
  }

  async update(db: DbExecutor, id: string, changes: VariantChanges): Promise<void> {
    // `updated_at` is refreshed by the column's $onUpdate, which only the query builder applies.
    await db.update(variant).set(changes).where(eq(variant.id, id));
  }

  async delete(db: DbExecutor, id: string): Promise<void> {
    await db.delete(variant).where(eq(variant.id, id));
  }

  /** Cascades to `variant_option_value`. */
  async deleteAllOfProduct(db: DbExecutor, productId: string): Promise<void> {
    await db.delete(variant).where(eq(variant.productId, productId));
  }
}
