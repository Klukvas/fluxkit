import type { category } from "../../../database/schema/index.js";
import type { CategoryResponse } from "./categories.schemas.js";

type CategoryRow = typeof category.$inferSelect;

/** Database row -> API shape. The only place where column names meet API field names. */
export function toCategoryResponse(row: CategoryRow): CategoryResponse {
  return {
    id: row.id,
    parentId: row.parentId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    position: row.position,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
