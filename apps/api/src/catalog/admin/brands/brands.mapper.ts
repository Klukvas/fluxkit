import type { brand } from "../../../database/schema/index.js";
import type { BrandResponse } from "./brands.schemas.js";

type BrandRow = typeof brand.$inferSelect;

/** Database row -> API shape. The only place where column names meet API field names. */
export function toBrandResponse(row: BrandRow): BrandResponse {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    logoUrl: row.logoUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
