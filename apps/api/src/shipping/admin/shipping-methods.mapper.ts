import type { shippingMethod } from "../../database/schema/index.js";
import type { ShippingMethodResponse } from "./shipping-methods.schemas.js";

type ShippingMethodRow = typeof shippingMethod.$inferSelect;

/**
 * Database row -> API shape. `pricing` and the text maps are JSONB that the write path validated; a row edited by hand can
 * hold something else, and the admin sees it as stored (checkout treats such a method as unavailable, ADR 0029 decision 3).
 */
export function toShippingMethodResponse(row: ShippingMethodRow): ShippingMethodResponse {
  return {
    id: row.id,
    code: row.code,
    title: row.title as Record<string, string>,
    description: row.description as Record<string, string> | null,
    kind: row.kind as ShippingMethodResponse["kind"],
    providerCode: row.providerCode,
    providerService: row.providerService,
    pricing: row.pricing as ShippingMethodResponse["pricing"],
    currency: row.currency,
    countryCodes: row.countryCodes,
    isActive: row.isActive,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
