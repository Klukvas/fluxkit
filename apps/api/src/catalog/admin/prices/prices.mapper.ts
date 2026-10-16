import { MAX_AMOUNT } from "@fluxkit/core";
import type { PriceRow } from "./prices.repository.js";
import type { PriceResponse } from "./prices.schemas.js";

/**
 * `bigint` columns reach the driver as strings and Drizzle converts them with `Number`. The CHECK constraints keep
 * every stored amount at or below MAX_AMOUNT (far below 2^53), so the conversion is exact; this guard turns a row
 * that broke the constraint into a loud error instead of a silently rounded price.
 */
export function toSafeAmount(value: number, column: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_AMOUNT) {
    throw new RangeError(
      `Stored ${column} ${String(value)} is outside the supported amount range.`,
    );
  }
  return value;
}

/** Database row -> API shape (the money shape: amount in minor units, currency, compareAtAmount or null). */
export function toPriceResponse(row: PriceRow): PriceResponse {
  return {
    id: row.id,
    variantId: row.variantId,
    currency: row.currency,
    amount: toSafeAmount(row.amount, "amount"),
    compareAtAmount:
      row.compareAtAmount === null ? null : toSafeAmount(row.compareAtAmount, "compare_at_amount"),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
