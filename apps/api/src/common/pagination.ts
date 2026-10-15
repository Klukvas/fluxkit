import { CATALOG_LIMITS } from "@fluxkit/core";
import { z } from "zod";

export const ADMIN_DEFAULT_PAGE_SIZE = 50;
export const ADMIN_MAX_PAGE_SIZE = CATALOG_LIMITS.maxPageSize;
export const MAX_OFFSET = CATALOG_LIMITS.maxOffset;

const integerString = z.string().regex(/^\d{1,9}$/, "must be a non-negative integer");

/** `?limit` (1 to 100, default 50) and `?offset` (0 to 10 000, default 0). Extend it for list-specific filters. */
export const paginationQuerySchema = z.object({
  limit: integerString
    .transform(Number)
    .pipe(z.number().int().min(1).max(ADMIN_MAX_PAGE_SIZE))
    .default(ADMIN_DEFAULT_PAGE_SIZE),
  offset: integerString.transform(Number).pipe(z.number().int().min(0).max(MAX_OFFSET)).default(0),
});

export type PaginationQuery = z.output<typeof paginationQuerySchema>;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export function toPage<T>(items: T[], total: number, pagination: PaginationQuery): Page<T> {
  return { items, total, limit: pagination.limit, offset: pagination.offset };
}

/** Response schema of a list endpoint, for OpenAPI. */
export function pageSchema<TItem extends z.ZodType>(item: TItem) {
  return z.object({
    items: z.array(item),
    total: z.number().int().min(0),
    limit: z.number().int(),
    offset: z.number().int(),
  });
}
