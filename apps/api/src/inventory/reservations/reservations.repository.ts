import { Injectable } from "@nestjs/common";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { DbExecutor } from "../../common/transaction.js";
import { price, product, reservation, variant } from "../../database/schema/index.js";

export type ReservationRow = typeof reservation.$inferSelect;
export type NewReservation = Pick<
  typeof reservation.$inferInsert,
  "variantId" | "locationId" | "quantity" | "expiresAt" | "reference"
>;

export interface ReservableVariantRow {
  id: string;
  isActive: boolean;
  trackInventory: boolean;
  allowBackorder: boolean;
  productStatus: string;
  /** The variant has a price in the shop currency (part of the sellable rule, `isVariantSellable`). */
  hasShopPrice: boolean;
}

/** Queries only (Drizzle query builder, parameterized). Level and journal queries live in `InventoryRepository`. */
@Injectable()
export class ReservationsRepository {
  /**
   * The variant with its product status and whether it has a price in `shopCurrency`, the variant row locked `FOR SHARE` until the transaction ends: a flag or
   * activity change (which updates the variant row) waits for the reservation in progress instead of slipping in
   * between the read and the write, and deleting the variant waits too.
   */
  async findVariantForReservation(
    db: DbExecutor,
    variantId: string,
    shopCurrency: string,
  ): Promise<ReservableVariantRow | undefined> {
    const [row] = await db
      .select({
        id: variant.id,
        isActive: variant.isActive,
        trackInventory: variant.trackInventory,
        allowBackorder: variant.allowBackorder,
        productStatus: product.status,
        hasShopPrice: sql<boolean>`exists (
          select 1 from ${price}
          where ${price.variantId} = ${variant.id} and ${price.currency} = ${shopCurrency}
        )`,
      })
      .from(variant)
      .innerJoin(product, eq(product.id, variant.productId))
      .where(eq(variant.id, variantId))
      .for("share", { of: variant });
    return row;
  }

  async insert(db: DbExecutor, values: NewReservation): Promise<ReservationRow> {
    const [row] = await db
      .insert(reservation)
      .values({ ...values, status: "active" })
      .returning();
    if (row === undefined) {
      throw new Error("An inserted reservation was not returned.");
    }
    return row;
  }

  /** A plain read, used to learn which level to lock before the locked read. */
  async find(db: DbExecutor, id: string): Promise<ReservationRow | undefined> {
    const [row] = await db.select().from(reservation).where(eq(reservation.id, id));
    return row;
  }

  /** The reservation row locked until the transaction ends; always taken after the level row lock. */
  async lock(db: DbExecutor, id: string): Promise<ReservationRow | undefined> {
    const [row] = await db.select().from(reservation).where(eq(reservation.id, id)).for("update");
    return row;
  }

  async setStatus(
    db: DbExecutor,
    id: string,
    status: "committed" | "released" | "expired",
  ): Promise<ReservationRow> {
    const [row] = await db
      .update(reservation)
      .set({ status })
      .where(eq(reservation.id, id))
      .returning();
    if (row === undefined) {
      throw new Error("An updated reservation was not returned.");
    }
    return row;
  }

  /** Ids of active reservations due at `now` (`expires_at <= now`), oldest first. Uses `reservation_status_expires_at_idx`. */
  async listDueIds(db: DbExecutor, now: Date, limit: number): Promise<string[]> {
    const rows = await db
      .select({ id: reservation.id })
      .from(reservation)
      .where(and(eq(reservation.status, "active"), lte(reservation.expiresAt, now)))
      .orderBy(asc(reservation.expiresAt), asc(reservation.id))
      .limit(limit);
    return rows.map((row) => row.id);
  }
}
