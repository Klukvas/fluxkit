import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  orderAdjustment,
  orderShipping,
  shippingMethod,
  shippingProviderSetting,
} from "../../database/schema/index.js";

export type StoreShippingMethodRow = typeof shippingMethod.$inferSelect;
export type NewOrderShippingRow = typeof orderShipping.$inferInsert;
export type NewOrderAdjustmentRow = typeof orderAdjustment.$inferInsert;

/**
 * Reads of the store shipping routes and the checkout, and the two inserts of the checkout's shipping snapshot. Queries
 * only (parameterized query builder); the rules are core's (`quoteShippingMethod`) and `ShippingCheckoutService`'s. Reads
 * take no lock: the checkout reads the method inside its transaction without one, so the lock order of ADR 0015 is
 * unchanged (the `order_shipping` insert takes the foreign key's share lock on the method row after the inventory locks).
 */
@Injectable()
export class ShippingStoreRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** The active methods in the order the storefront shows them (position, code, id), at most `limit`. */
  async listActive(limit: number, db: DbExecutor = this.db): Promise<StoreShippingMethodRow[]> {
    return db
      .select()
      .from(shippingMethod)
      .where(eq(shippingMethod.isActive, true))
      .orderBy(asc(shippingMethod.position), asc(shippingMethod.code), asc(shippingMethod.id))
      .limit(limit);
  }

  /** Whether the shop has at least one active method (the switch of `shipping_method_required`). */
  async activeExists(db: DbExecutor): Promise<boolean> {
    const rows = await db
      .select({ one: sql<number>`1` })
      .from(shippingMethod)
      .where(eq(shippingMethod.isActive, true))
      .limit(1);
    return rows.length > 0;
  }

  async findByCode(
    code: string,
    db: DbExecutor = this.db,
  ): Promise<StoreShippingMethodRow | undefined> {
    const [row] = await db.select().from(shippingMethod).where(eq(shippingMethod.code, code));
    return row;
  }

  /** The non-secret settings of a provider (`{}` before the first save). */
  async providerSettings(providerCode: string): Promise<Readonly<Record<string, unknown>>> {
    const [row] = await this.db
      .select({ settings: shippingProviderSetting.settings })
      .from(shippingProviderSetting)
      .where(eq(shippingProviderSetting.providerCode, providerCode));
    const settings = row?.settings;
    return typeof settings === "object" && settings !== null && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  }

  async insertOrderShipping(db: DbExecutor, values: NewOrderShippingRow): Promise<void> {
    await db.insert(orderShipping).values(values);
  }

  async insertAdjustment(db: DbExecutor, values: NewOrderAdjustmentRow): Promise<void> {
    await db.insert(orderAdjustment).values(values);
  }

  /** The shipping snapshot of an order, if it has one. */
  async findOrderShipping(
    db: DbExecutor,
    orderId: string,
  ): Promise<typeof orderShipping.$inferSelect | undefined> {
    const [row] = await db
      .select()
      .from(orderShipping)
      .where(and(eq(orderShipping.orderId, orderId)));
    return row;
  }
}
