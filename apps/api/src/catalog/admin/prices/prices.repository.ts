import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "../../../common/transaction.js";
import { price, variant } from "../../../database/schema/index.js";

export type PriceRow = typeof price.$inferSelect;
export type NewPrice = Pick<
  typeof price.$inferInsert,
  "variantId" | "currency" | "amount" | "compareAtAmount"
>;

/** Queries only (Drizzle query builder, parameterized). Every method runs on the executor it is given. */
@Injectable()
export class PricesRepository {
  /** Currency order, so the list is stable. */
  async listOfVariant(db: DbExecutor, variantId: string): Promise<PriceRow[]> {
    return db
      .select()
      .from(price)
      .where(eq(price.variantId, variantId))
      .orderBy(asc(price.currency));
  }

  /**
   * Every price of every variant of the product in one statement: variant position, variant id, then currency, so the
   * list is stable. A product has at most 250 variants and the table 10 currencies, so it is never paged.
   */
  async listOfProduct(db: DbExecutor, productId: string): Promise<PriceRow[]> {
    const rows = await db
      .select({ price })
      .from(price)
      .innerJoin(variant, eq(variant.id, price.variantId))
      .where(eq(variant.productId, productId))
      .orderBy(asc(variant.position), asc(variant.id), asc(price.currency));
    return rows.map((row) => row.price);
  }

  async find(db: DbExecutor, variantId: string, currency: string): Promise<PriceRow | undefined> {
    const [row] = await db
      .select()
      .from(price)
      .where(and(eq(price.variantId, variantId), eq(price.currency, currency)));
    return row;
  }

  /** The variants of the product among `variantIds`, with their `is_active` flag. Missing and foreign ids are absent. */
  async findVariantsOfProduct(
    db: DbExecutor,
    productId: string,
    variantIds: readonly string[],
  ): Promise<{ id: string; isActive: boolean }[]> {
    if (variantIds.length === 0) {
      return [];
    }
    return db
      .select({ id: variant.id, isActive: variant.isActive })
      .from(variant)
      .where(and(eq(variant.productId, productId), inArray(variant.id, [...variantIds])));
  }

  /**
   * Creates the prices or replaces the amounts of existing ones (the unique key is variant and currency). One
   * statement for all rows; callers guarantee a key appears once. Returns the rows in the order of `values`.
   */
  async upsertMany(db: DbExecutor, values: readonly NewPrice[]): Promise<PriceRow[]> {
    if (values.length === 0) {
      return [];
    }
    const rows = await db
      .insert(price)
      .values([...values])
      .onConflictDoUpdate({
        target: [price.variantId, price.currency],
        set: {
          amount: sql`excluded.amount`,
          compareAtAmount: sql`excluded.compare_at_amount`,
          // `$onUpdate` does not apply to the conflict branch of an insert.
          updatedAt: sql`now()`,
        },
      })
      .returning();
    const byKey = new Map(rows.map((row) => [priceKey(row.variantId, row.currency), row]));
    return values.map((value) => {
      const row = byKey.get(priceKey(value.variantId, value.currency));
      if (row === undefined) {
        throw new Error("An upserted price was not returned.");
      }
      return row;
    });
  }

  async delete(db: DbExecutor, variantId: string, currency: string): Promise<void> {
    await db.delete(price).where(and(eq(price.variantId, variantId), eq(price.currency, currency)));
  }
}

export function priceKey(variantId: string, currency: string): string {
  return `${variantId}:${currency}`;
}
