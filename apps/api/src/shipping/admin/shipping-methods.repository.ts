import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";
import type { PaginationQuery } from "../../common/pagination.js";
import type { DbExecutor } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { orderShipping, shippingMethod } from "../../database/schema/index.js";

export type ShippingMethodRow = typeof shippingMethod.$inferSelect;
export type NewShippingMethod = typeof shippingMethod.$inferInsert;
export type ShippingMethodChanges = Partial<
  Omit<NewShippingMethod, "id" | "code" | "createdAt" | "updatedAt">
>;

/** Queries only (Drizzle query builder, parameterized). Business rules live in ShippingMethodsService. */
@Injectable()
export class ShippingMethodsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insert(values: NewShippingMethod): Promise<ShippingMethodRow> {
    const [row] = await this.db.insert(shippingMethod).values(values).returning();
    return required(row);
  }

  async findById(id: string): Promise<ShippingMethodRow | undefined> {
    const [row] = await this.db.select().from(shippingMethod).where(eq(shippingMethod.id, id));
    return row;
  }

  /**
   * The method row, locked until the transaction ends. `"update"` (a delete) conflicts with the key-share lock that an order
   * placement takes on the row through the `order_shipping.method_id` foreign key, so a delete and a new order of this method
   * cannot both pass unseen. `"no key update"` (a PATCH, no key column changes) waits for other writers but never for orders.
   */
  async lockById(
    id: string,
    strength: "update" | "no key update",
    db: DbExecutor,
  ): Promise<ShippingMethodRow | undefined> {
    const [row] = await db
      .select()
      .from(shippingMethod)
      .where(eq(shippingMethod.id, id))
      .for(strength);
    return row;
  }

  /** Stable order: position, code, id. */
  async list(page: PaginationQuery): Promise<{ rows: ShippingMethodRow[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(shippingMethod)
        .orderBy(asc(shippingMethod.position), asc(shippingMethod.code), asc(shippingMethod.id))
        .limit(page.limit)
        .offset(page.offset),
      this.db.$count(shippingMethod),
    ]);
    return { rows, total };
  }

  async update(
    id: string,
    changes: ShippingMethodChanges,
    db: DbExecutor,
  ): Promise<ShippingMethodRow | undefined> {
    // `updated_at` is refreshed by the column's $onUpdate, which only the query builder applies.
    const [row] = await db
      .update(shippingMethod)
      .set(changes)
      .where(eq(shippingMethod.id, id))
      .returning();
    return row;
  }

  /** True when an order's shipping snapshot still links this method. One indexed probe, never a scan of orders. */
  async isUsedByOrder(id: string, db: DbExecutor): Promise<boolean> {
    const rows = await db
      .select({ one: sql<number>`1` })
      .from(orderShipping)
      .where(eq(orderShipping.methodId, id))
      .limit(1);
    return rows.length > 0;
  }

  async delete(id: string, db: DbExecutor): Promise<void> {
    await db.delete(shippingMethod).where(eq(shippingMethod.id, id));
  }
}

function required<T>(row: T | undefined): T {
  if (row === undefined) {
    throw new Error("The database returned no row for a statement that must return one.");
  }
  return row;
}
