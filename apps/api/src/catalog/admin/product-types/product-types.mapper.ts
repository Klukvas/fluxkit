import type { attribute, attributeOption, productType } from "../../../database/schema/index.js";
import { toAttributeDetailResponse } from "../attributes/attributes.mapper.js";
import {
  attributeLevelSchema,
  type ProductTypeAttributeResponse,
  type ProductTypeDetailResponse,
  type ProductTypeOptionResponse,
  type ProductTypeResponse,
} from "./product-types.schemas.js";
import type { AttributeAssignmentRow, OptionAssignmentRow } from "./product-types.repository.js";

type ProductTypeRow = typeof productType.$inferSelect;
type AttributeRow = typeof attribute.$inferSelect;
type AttributeOptionRow = typeof attributeOption.$inferSelect;

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
  definitions: AttributeRow[],
  definitionOptions: AttributeOptionRow[],
): ProductTypeDetailResponse {
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  const optionsByAttribute = new Map<string, AttributeOptionRow[]>();
  for (const entry of definitionOptions) {
    const list = optionsByAttribute.get(entry.attributeId) ?? [];
    list.push(entry);
    optionsByAttribute.set(entry.attributeId, list);
  }
  return {
    ...toProductTypeResponse(row),
    attributes: attributes.map((assignment) => {
      const definition = definitionById.get(assignment.attributeId);
      if (definition === undefined) {
        // The foreign key makes this impossible; fail loudly rather than answer an assignment without its attribute.
        throw new Error(`Attribute ${assignment.attributeId} of an assignment was not found.`);
      }
      return {
        ...toAttributeAssignmentResponse(assignment),
        attribute: toAttributeDetailResponse(
          definition,
          optionsByAttribute.get(assignment.attributeId) ?? [],
        ),
      };
    }),
    options: options.map(toOptionAssignmentResponse),
  };
}
