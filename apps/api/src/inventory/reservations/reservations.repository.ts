import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { DbExecutor } from "../../common/transaction.js";
import { price, product, reservation, variant } from "../../database/schema/index.js";

export type ReservationRow = typeof reservation.$inferSelect;
export type NewReservation = Pick<
  typeof reservation.$inferInsert,
  "variantId" | "locationId" | "quantity" | "expiresAt" | "reference"
>;

export interface ReservableVariantRow {
  id: string;
  productId: string;
  isActive: boolean;
  trackInventory: boolean;
  allowBackorder: boolean;
  productStatus: string;
  /** The variant has a price in the shop currency (part of the sellable rule, `isVariantSellable`). */
  hasShopPrice: boolean;
}

/** Keyset position in the due list: the last reservation looked at. Both fields come from `DueReservation`. */
export interface DueCursor {
  /** UTC ISO text with microseconds, as the database printed it. */
  expiresAt: string;
  id: string;
}

export type DueReservation = DueCursor;

/** Queries only (Drizzle query builder, parameterized). Level and journal queries live in `InventoryRepository`. */
@Injectable()
export class ReservationsRepository {
  /**
   * The product id of each variant, read WITHOUT a lock, so the caller knows which product rows to lock first. A
   * variant that does not exist is missing from the map. Keys are the ids as the database prints them (lower case).
   */
  async findProductIdsOfVariants(
    db: DbExecutor,
    variantIds: readonly string[],
  ): Promise<Map<string, string>> {
    const rows = await db
      .select({ id: variant.id, productId: variant.productId })
      .from(variant)
      .where(inArray(variant.id, [...variantIds]));
    return new Map(rows.map((row) => [row.id, row.productId]));
  }

  /**
   * Locks the product rows `FOR SHARE`, in id order, until the transaction ends: publishing, unpublishing, price
   * writes, variant edits and variant deletes all take the product row (`FOR UPDATE`), so they either finish before
   * the reservation reads the sellable facts or wait until it ends. Taking the rows in id order is part of the lock
   * order (checkout: cart -> products -> variants -> levels); a caller that already holds them is not blocked.
   */
  async lockProductsShared(db: DbExecutor, productIds: readonly string[]): Promise<void> {
    await db
      .select({ id: product.id })
      .from(product)
      .where(inArray(product.id, [...productIds]))
      .orderBy(asc(product.id))
      .for("share");
  }

  /**
   * The variants with their product status and whether each has a price in `shopCurrency`, the variant rows locked
   * `FOR SHARE` in id order until the transaction ends: a flag or activity change (which updates the variant row)
   * waits for the reservation in progress instead of slipping in between the read and the write, and deleting the
   * variant waits too. A variant that does not exist is missing from the result.
   */
  async findVariantsForReservation(
    db: DbExecutor,
    variantIds: readonly string[],
    shopCurrency: string,
  ): Promise<ReservableVariantRow[]> {
    return db
      .select({
        id: variant.id,
        productId: variant.productId,
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
      .where(inArray(variant.id, [...variantIds]))
      .orderBy(asc(variant.id))
      .for("share", { of: variant });
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

  /** Only the expiry changes; the caller holds the level and reservation locks and has asked `decideExtend`. */
  async setExpiresAt(db: DbExecutor, id: string, expiresAt: Date): Promise<ReservationRow> {
    const [row] = await db
      .update(reservation)
      .set({ expiresAt })
      .where(eq(reservation.id, id))
      .returning();
    if (row === undefined) {
      throw new Error("An updated reservation was not returned.");
    }
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

  /**
   * Active reservations due at `now` (`expires_at <= now`), ordered by `(expires_at, id)`, at most `limit`, strictly
   * after the keyset cursor `after` when given. Uses `reservation_status_expires_at_idx`. `expiresAt` of each row is
   * returned as text with microseconds (UTC ISO form) so a cursor built from it compares exactly: a JavaScript `Date`
   * has milliseconds only and could name the same row again.
   */
  async listDue(
    db: DbExecutor,
    now: Date,
    limit: number,
    after: DueCursor | undefined,
  ): Promise<DueReservation[]> {
    return db
      .select({
        id: reservation.id,
        expiresAt: sql<string>`to_char(${reservation.expiresAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(reservation)
      .where(
        and(
          eq(reservation.status, "active"),
          lte(reservation.expiresAt, now),
          after === undefined
            ? undefined
            : sql`(${reservation.expiresAt}, ${reservation.id}) > (${after.expiresAt}::timestamptz, ${after.id}::uuid)`,
        ),
      )
      .orderBy(asc(reservation.expiresAt), asc(reservation.id))
      .limit(limit);
  }
}
