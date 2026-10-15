import type { productType } from "../../../database/schema/index.js";
import {
  attributeLevelSchema,
  type ProductTypeAttributeResponse,
  type ProductTypeDetailResponse,
  type ProductTypeOptionResponse,
  type ProductTypeResponse,
} from "./product-types.schemas.js";
import type { AttributeAssignmentRow, OptionAssignmentRow } from "./product-types.repository.js";

type ProductTypeRow = typeof productType.$inferSelect;

/** Database row -> API shape. The only place where column names meet API field names. */
export function toProductTypeResponse(row: ProductTypeRow): ProductTypeResponse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    requiresShipping: row.requiresShipping,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAttributeAssignmentResponse(
  row: AttributeAssignmentRow,
): ProductTypeAttributeResponse {
  return {
    productTypeId: row.productTypeId,
    attributeId: row.attributeId,
    attributeCode: row.attributeCode,
    level: attributeLevelSchema.parse(row.level),
    isRequired: row.isRequired,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toOptionAssignmentResponse(row: OptionAssignmentRow): ProductTypeOptionResponse {
  return {
    productTypeId: row.productTypeId,
    optionId: row.optionId,
    optionCode: row.optionCode,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toProductTypeDetailResponse(
  row: ProductTypeRow,
  attributes: AttributeAssignmentRow[],
  options: OptionAssignmentRow[],
): ProductTypeDetailResponse {
  return {
    ...toProductTypeResponse(row),
    attributes: attributes.map(toAttributeAssignmentResponse),
    options: options.map(toOptionAssignmentResponse),
  };
}
