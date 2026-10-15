import { inputTypeSchema } from "./attributes.schemas.js";
import type { attribute, attributeOption } from "../../../database/schema/index.js";
import type {
  AttributeDetailResponse,
  AttributeOptionResponse,
  AttributeResponse,
} from "./attributes.schemas.js";

type AttributeRow = typeof attribute.$inferSelect;
type AttributeOptionRow = typeof attributeOption.$inferSelect;

/** Database row -> API shape. The only place where column names meet API field names. */
export function toAttributeResponse(row: AttributeRow): AttributeResponse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    inputType: inputTypeSchema.parse(row.inputType),
    isLocalized: row.isLocalized,
    unit: row.unit,
    validation: row.validation,
    isFilterable: row.isFilterable,
    isSearchable: row.isSearchable,
    isVisibleOnStorefront: row.isVisibleOnStorefront,
    isComparable: row.isComparable,
    isSortable: row.isSortable,
    isInternal: row.isInternal,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAttributeOptionResponse(row: AttributeOptionRow): AttributeOptionResponse {
  return {
    id: row.id,
    attributeId: row.attributeId,
    code: row.code,
    label: row.label,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAttributeDetailResponse(
  row: AttributeRow,
  options: AttributeOptionRow[],
): AttributeDetailResponse {
  return { ...toAttributeResponse(row), options: options.map(toAttributeOptionResponse) };
}
