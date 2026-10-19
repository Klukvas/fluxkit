import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { PaginationQuery } from "../common/pagination.js";
import type { DbExecutor } from "../common/transaction.js";
import {
  inventoryLevel,
  location,
  orderItem,
  orderItemReservation,
  reservation,
  stockMovement,
  variant,
} from "../database/schema/index.js";

export type LocationRow = typeof location.$inferSelect;
export type LevelRow = typeof inventoryLevel.$inferSelect;
export type MovementRow = typeof stockMovement.$inferSelect;
export type NewMovement = Pick<
  typeof stockMovement.$inferInsert,
  "variantId" | "locationId" | "delta" | "kind" | "onHandAfter" | "reason" | "reference" | "actorId"
>;

export interface LevelWithLocation {
  locationId: string;
  locationCode: string;
  onHand: number;
  reserved: number;
}

export interface MovementWithLocation extends MovementRow {
  locationCode: string;
}

export interface LevelOfVariantRow extends LevelWithLocation {
  variantId: string;
}

/** A reservation of one variant as the admin list shows it; `orderId` is null for a hold no order owns. */
export interface ReservationListRow {
  status: string;
  quantity: number;
  expiresAt: Date;
  reference: string | null;
  orderId: string | null;
  locationCode: string;
  createdAt: Date;
}

export interface VariantStockRow {
  id: string;
  trackInventory: boolean;
  allowBackorder: boolean;
}

/**
 * Queries only (Drizzle query builder, parameterized). Every method runs on the executor it is given. The stock
 * write helpers assume the caller holds the level row lock (`lockLevel`) in the same transaction, and nothing here
 * ever updates or deletes a `stock_movement` row: the journal is append-only (ADR 0012).
 */
@Injectable()
export class InventoryRepository {
  /** Code order, so the list is stable. */
  listLocations(db: DbExecutor): Promise<LocationRow[]> {
    return db.select().from(location).orderBy(asc(location.code));
  }

  async findLocation(db: DbExecutor, id: string): Promise<LocationRow | undefined> {
    const [row] = await db.select().from(location).where(eq(location.id, id));
    return row;
  }

  async findDefaultLocation(db: DbExecutor): Promise<LocationRow | undefined> {
    const [row] = await db.select().from(location).where(eq(location.isDefault, true));
    return row;
  }

  async findVariantOfProduct(
    db: DbExecutor,
    productId: string,
    variantId: string,
  ): Promise<VariantStockRow | undefined> {
    const [row] = await db
      .select({
        id: variant.id,
        trackInventory: variant.trackInventory,
        allowBackorder: variant.allowBackorder,
      })
      .from(variant)
      .where(and(eq(variant.id, variantId), eq(variant.productId, productId)));
    return row;
  }

  /** The variants of the product in variant order (position, then id), one statement. */
  listVariantsOfProduct(db: DbExecutor, productId: string): Promise<VariantStockRow[]> {
    return db
      .select({
        id: variant.id,
        trackInventory: variant.trackInventory,
        allowBackorder: variant.allowBackorder,
      })
      .from(variant)
      .where(eq(variant.productId, productId))
      .orderBy(asc(variant.position), asc(variant.id));
  }

  /** Every level row of every variant of the product, location code order within a variant, one statement. */
  listLevelsOfProduct(db: DbExecutor, productId: string): Promise<LevelOfVariantRow[]> {
    return db
      .select({
        variantId: inventoryLevel.variantId,
        locationId: inventoryLevel.locationId,
        locationCode: location.code,
        onHand: inventoryLevel.onHand,
        reserved: inventoryLevel.reserved,
      })
      .from(inventoryLevel)
      .innerJoin(variant, eq(variant.id, inventoryLevel.variantId))
      .innerJoin(location, eq(location.id, inventoryLevel.locationId))
      .where(eq(variant.productId, productId))
      .orderBy(asc(location.code));
  }

  listLevelsOfVariant(db: DbExecutor, variantId: string): Promise<LevelWithLocation[]> {
    return db
      .select({
        locationId: inventoryLevel.locationId,
        locationCode: location.code,
        onHand: inventoryLevel.onHand,
        reserved: inventoryLevel.reserved,
      })
      .from(inventoryLevel)
      .innerJoin(location, eq(location.id, inventoryLevel.locationId))
      .where(eq(inventoryLevel.variantId, variantId))
      .orderBy(asc(location.code));
  }

  /** Locks the level row until the transaction ends: every stock write goes through here first (ADR 0011). */
  async lockLevel(
    db: DbExecutor,
    variantId: string,
    locationId: string,
  ): Promise<LevelRow | undefined> {
    const [row] = await db
      .select()
      .from(inventoryLevel)
      .where(
        and(eq(inventoryLevel.variantId, variantId), eq(inventoryLevel.locationId, locationId)),
      )
      .for("update");
    return row;
  }

  /**
   * Creates the level row with zero stock unless it exists. Race-safe: parallel callers for the same pair create one
   * row; the caller then locks it with `lockLevel`.
   */
  async insertEmptyLevel(db: DbExecutor, variantId: string, locationId: string): Promise<void> {
    await db
      .insert(inventoryLevel)
      .values({ variantId, locationId, onHand: 0, reserved: 0 })
      .onConflictDoNothing({ target: [inventoryLevel.variantId, inventoryLevel.locationId] });
  }

  async updateLevel(
    db: DbExecutor,
    variantId: string,
    locationId: string,
    level: { onHand: number; reserved: number },
  ): Promise<void> {
    await db
      .update(inventoryLevel)
      .set({ onHand: level.onHand, reserved: level.reserved })
      .where(
        and(eq(inventoryLevel.variantId, variantId), eq(inventoryLevel.locationId, locationId)),
      );
  }

  /**
   * Appends one journal row. `created_at` is taken with `clock_timestamp()`, that is when the row is written under the
   * level lock, not the transaction start `now()` would give: parallel writers then appear in the journal in the
   * order they held the lock, which keeps `on_hand_after` a running sum when the list is sorted by time.
   */
  async insertMovement(db: DbExecutor, values: NewMovement): Promise<MovementRow> {
    const [row] = await db
      .insert(stockMovement)
      .values({ ...values, createdAt: sql`clock_timestamp()` })
      .returning();
    if (row === undefined) {
      throw new Error("An inserted stock movement was not returned.");
    }
    return row;
  }

  /** Newest first; the id breaks ties of equal timestamps (the order of `stock_movement_variant_id_created_at_idx`). */
  async listMovementsPage(
    db: DbExecutor,
    variantId: string,
    page: PaginationQuery,
  ): Promise<{ rows: MovementWithLocation[]; total: number }> {
    const where = eq(stockMovement.variantId, variantId);
    const [rows, total] = await Promise.all([
      db
        .select({ movement: stockMovement, locationCode: location.code })
        .from(stockMovement)
        .innerJoin(location, eq(location.id, stockMovement.locationId))
        .where(where)
        .orderBy(desc(stockMovement.createdAt), desc(stockMovement.id))
        .limit(page.limit)
        .offset(page.offset),
      db.$count(stockMovement, where),
    ]);
    return {
      rows: rows.map(({ movement, locationCode }) => ({ ...movement, locationCode })),
      total,
    };
  }

  /**
   * One page of the reservations of a variant in one status, newest first (id breaks ties), with the order that holds
   * each one (left joins through `order_item_reservation`, unique per reservation, so a row never doubles) and the
   * location code. Served by `reservation_variant_id_idx`. Selects nothing about the order but its id.
   */
  async listReservationsPage(
    db: DbExecutor,
    variantId: string,
    status: string,
    page: PaginationQuery,
  ): Promise<{ rows: ReservationListRow[]; total: number }> {
    const where = and(eq(reservation.variantId, variantId), eq(reservation.status, status));
    const [rows, total] = await Promise.all([
      db
        .select({
          status: reservation.status,
          quantity: reservation.quantity,
          expiresAt: reservation.expiresAt,
          reference: reservation.reference,
          orderId: orderItem.orderId,
          locationCode: location.code,
          createdAt: reservation.createdAt,
        })
        .from(reservation)
        .innerJoin(location, eq(location.id, reservation.locationId))
        .leftJoin(orderItemReservation, eq(orderItemReservation.reservationId, reservation.id))
        .leftJoin(orderItem, eq(orderItem.id, orderItemReservation.orderItemId))
        .where(where)
        .orderBy(desc(reservation.createdAt), desc(reservation.id))
        .limit(page.limit)
        .offset(page.offset),
      db.$count(reservation, where),
    ]);
    return { rows, total };
  }
}
