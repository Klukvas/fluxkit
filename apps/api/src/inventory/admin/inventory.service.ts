import { Inject, Injectable } from "@nestjs/common";
import {
  decideAdjustment,
  type StockAdjustment,
  type StockLevel,
  type StockRefusal,
} from "@fluxkit/core";
import { toPage, type Page } from "../../common/pagination.js";
import { notFound, ruleViolation, validationFailed } from "../../common/problem.js";
import { withTransaction, type DbExecutor } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  ProductsRepository,
  type ProductRow,
} from "../../catalog/admin/products/products.repository.js";
import {
  InventoryRepository,
  type LevelWithLocation,
  type LocationRow,
  type VariantStockRow,
} from "../inventory.repository.js";
import { toLevelResponse, toLocationResponse, toMovementResponse } from "./inventory.mapper.js";
import type {
  AdjustmentBody,
  AdjustmentResponse,
  InventoryResponse,
  ListMovementsQuery,
  MovementResponse,
} from "./inventory.schemas.js";
import type { LocationListResponse } from "./locations.schemas.js";

/** Refusals about the request itself (a number that is not usable); the others are rules about the current stock. */
const VALIDATION_REFUSALS: ReadonlySet<StockRefusal> = new Set([
  "invalid_quantity",
  "on_hand_out_of_range",
]);

const RULE_DETAILS: Partial<Record<StockRefusal, string>> = {
  negative_on_hand: "The change would leave less than zero units on hand.",
  below_reserved:
    "The change would leave fewer units on hand than are reserved; release the reservations first.",
  no_change: "The change leaves the quantity on hand as it is.",
  kind_requires_increase: "A receipt or a return must add stock; use an adjustment to remove it.",
};

@Injectable()
export class InventoryService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly inventory: InventoryRepository,
    @Inject(DRIZZLE) private readonly database: Database,
  ) {}

  async listLocations(): Promise<LocationListResponse> {
    const rows = await this.inventory.listLocations(this.database);
    return { items: rows.map(toLocationResponse) };
  }

  /** Reads only: a variant without level rows shows an empty list, nothing is created. */
  async get(productId: string, variantId: string): Promise<InventoryResponse> {
    await this.requireProduct(this.database, productId);
    const variant = await this.requireVariant(this.database, productId, variantId);
    const rows = await this.inventory.listLevelsOfVariant(this.database, variantId);
    const levels = rows.map(toLevelResponse);
    return {
      variantId,
      trackInventory: variant.trackInventory,
      allowBackorder: variant.allowBackorder,
      levels,
      totalAvailable: levels.reduce((sum, level) => sum + level.available, 0),
    };
  }

  async listMovements(
    productId: string,
    variantId: string,
    query: ListMovementsQuery,
  ): Promise<Page<MovementResponse>> {
    await this.requireProduct(this.database, productId);
    await this.requireVariant(this.database, productId, variantId);
    const { rows, total } = await this.inventory.listMovementsPage(this.database, variantId, query);
    return toPage(rows.map(toMovementResponse), total, query);
  }

  /**
   * One transaction: product row lock (the order every variant write uses: product, then level), the level row lock,
   * the core decision, the level update and the journal row. A refusal throws, which rolls back everything including
   * the empty level row a first-time change may have created, so a refused change leaves no trace.
   */
  async adjust(
    productId: string,
    variantId: string,
    body: AdjustmentBody,
    actorId: string,
  ): Promise<AdjustmentResponse> {
    return withTransaction(this.database, async (tx) => {
      await this.lockProduct(tx, productId);
      await this.requireVariant(tx, productId, variantId);
      const location = await this.resolveLocation(tx, body.locationId);

      let row = await this.inventory.lockLevel(tx, variantId, location.id);
      if (row === undefined) {
        // Parallel first receipts: one insert wins, the others do nothing, and all of them then lock the same row.
        await this.inventory.insertEmptyLevel(tx, variantId, location.id);
        row = await this.inventory.lockLevel(tx, variantId, location.id);
      }
      if (row === undefined) {
        throw new Error("The inventory level row vanished after it was created.");
      }

      const current: StockLevel = { onHand: row.onHand, reserved: row.reserved };
      const decision = decideAdjustment(current, toAdjustment(body));
      if (!decision.ok) {
        throw refusalToProblem(decision.reason, body);
      }
      await this.inventory.updateLevel(tx, variantId, location.id, decision.level);
      const movement = await this.inventory.insertMovement(tx, {
        variantId,
        locationId: location.id,
        delta: decision.movement.delta,
        kind: decision.movement.kind,
        onHandAfter: decision.movement.onHandAfter,
        reason: emptyToNull(body.reason),
        reference: emptyToNull(body.reference),
        actorId,
      });
      const level: LevelWithLocation = {
        locationId: location.id,
        locationCode: location.code,
        onHand: decision.level.onHand,
        reserved: decision.level.reserved,
      };
      return {
        level: toLevelResponse(level),
        movement: toMovementResponse({ ...movement, locationCode: location.code }),
      };
    });
  }

  private async resolveLocation(
    tx: DbExecutor,
    locationId: string | undefined,
  ): Promise<LocationRow> {
    if (locationId !== undefined) {
      const found = await this.inventory.findLocation(tx, locationId);
      if (found === undefined) {
        throw validationFailed([{ path: "locationId", code: "invalid_reference" }]);
      }
      return found;
    }
    const fallback = await this.inventory.findDefaultLocation(tx);
    if (fallback === undefined) {
      throw new Error("There is no default location; the migration creates one named main.");
    }
    return fallback;
  }

  private async requireProduct(db: DbExecutor, productId: string): Promise<ProductRow> {
    const row = await this.products.findById(db, productId);
    if (row === undefined) {
      throw notFound("Product");
    }
    return row;
  }

  private async lockProduct(tx: DbExecutor, productId: string): Promise<ProductRow> {
    const row = await this.products.findByIdForUpdate(tx, productId);
    if (row === undefined) {
      throw notFound("Product");
    }
    return row;
  }

  private async requireVariant(
    db: DbExecutor,
    productId: string,
    variantId: string,
  ): Promise<VariantStockRow> {
    const row = await this.inventory.findVariantOfProduct(db, productId, variantId);
    if (row === undefined) {
      throw notFound("Variant");
    }
    return row;
  }
}

function toAdjustment(body: AdjustmentBody): StockAdjustment {
  // The schema guarantees exactly one of the two is present.
  if (body.delta !== undefined) {
    return { mode: "delta", delta: body.delta, kind: body.kind };
  }
  if (body.setOnHand !== undefined) {
    return { mode: "setOnHand", onHand: body.setOnHand, kind: body.kind };
  }
  throw new Error("An adjustment body without delta and setOnHand passed validation.");
}

/** Core decides; this only shapes the verdict: a bad number is a 400 on its field, a stock rule is a 409. */
function refusalToProblem(reason: StockRefusal, body: AdjustmentBody) {
  if (VALIDATION_REFUSALS.has(reason)) {
    return validationFailed([
      { path: body.delta !== undefined ? "delta" : "setOnHand", code: reason },
    ]);
  }
  return ruleViolation(RULE_DETAILS[reason] ?? "The stock change is not allowed.", reason);
}

function emptyToNull(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === "" ? null : value;
}
