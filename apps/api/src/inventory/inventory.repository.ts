import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { PaginationQuery } from "../common/pagination.js";
import type { DbExecutor } from "../common/transaction.js";
import { inventoryLevel, location, stockMovement, variant } from "../database/schema/index.js";

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
}
