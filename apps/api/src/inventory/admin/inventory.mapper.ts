import { MAX_ON_HAND, type StockMovementKind } from "@fluxkit/core";
import type {
  LevelWithLocation,
  LocationRow,
  MovementWithLocation,
} from "../inventory.repository.js";
import type { LocationResponse } from "./locations.schemas.js";
import type { LevelResponse, MovementResponse } from "./inventory.schemas.js";

/** A level row that broke its CHECK constraints is a damaged database: fail loudly instead of showing it. */
function assertStoredQuantity(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_ON_HAND) {
    throw new RangeError(`Stored ${what} ${String(value)} is outside the supported range.`);
  }
  return value;
}

export function toLevelResponse(row: LevelWithLocation): LevelResponse {
  const onHand = assertStoredQuantity(row.onHand, "on_hand");
  if (!Number.isSafeInteger(row.reserved) || row.reserved < 0) {
    throw new RangeError(`Stored reserved ${String(row.reserved)} is outside the supported range.`);
  }
  return {
    locationId: row.locationId,
    locationCode: row.locationCode,
    onHand,
    reserved: row.reserved,
    available: Math.max(0, onHand - row.reserved),
  };
}

function toKind(value: string): StockMovementKind {
  if (value === "receipt" || value === "adjustment" || value === "sale" || value === "return") {
    return value;
  }
  throw new RangeError(`Unknown stock movement kind in the database: ${value}`);
}

export function toMovementResponse(row: MovementWithLocation): MovementResponse {
  return {
    id: row.id,
    variantId: row.variantId,
    locationId: row.locationId,
    locationCode: row.locationCode,
    kind: toKind(row.kind),
    delta: row.delta,
    onHandAfter: assertStoredQuantity(row.onHandAfter, "on_hand_after"),
    reason: row.reason,
    reference: row.reference,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toLocationResponse(row: LocationRow): LocationResponse {
  return { id: row.id, code: row.code, name: row.name, isDefault: row.isDefault };
}
