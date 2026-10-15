import type { option, optionValue } from "../../../database/schema/index.js";
import type {
  OptionDetailResponse,
  OptionResponse,
  OptionValueResponse,
} from "./options.schemas.js";

type OptionRow = typeof option.$inferSelect;
type OptionValueRow = typeof optionValue.$inferSelect;

/** Database row -> API shape. The only place where column names meet API field names. */
export function toOptionResponse(row: OptionRow): OptionResponse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toOptionValueResponse(row: OptionValueRow): OptionValueResponse {
  return {
    id: row.id,
    optionId: row.optionId,
    code: row.code,
    label: row.label,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toOptionDetailResponse(
  row: OptionRow,
  values: OptionValueRow[],
): OptionDetailResponse {
  return { ...toOptionResponse(row), values: values.map(toOptionValueResponse) };
}
