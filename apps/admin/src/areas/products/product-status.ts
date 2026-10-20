import type { ProductStatus } from "@fluxkit/api-client";
import type { StatusTone } from "@fluxkit/ui";

/** The badge of a product status: the text says it, the tone is a hint only. */
export const STATUS_TONES: Record<ProductStatus, StatusTone> = {
  draft: "neutral",
  active: "success",
  archived: "warning",
};

export function statusLabelKey(status: ProductStatus): string {
  return `products.status.${status}`;
}
