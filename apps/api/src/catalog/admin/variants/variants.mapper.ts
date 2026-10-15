import { toVariantResponse } from "../products/products.mapper.js";
import type { VariantOptionValueRow, VariantRow } from "../products/products.repository.js";
import type { VariantResponse } from "./variants.schemas.js";

/** Rows -> API shape. Same shape as the variants inside the product detail, so both stay in step. */
export function toVariantResponses(
  rows: readonly VariantRow[],
  optionValues: readonly VariantOptionValueRow[],
): VariantResponse[] {
  return rows.map((row) => toVariantResponse(row, optionValues));
}
