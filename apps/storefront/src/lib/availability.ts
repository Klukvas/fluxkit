import type { Availability } from "@fluxkit/api-client";
import type { BadgeVariant } from "@fluxkit/ui";

/** Message key and badge variant of an availability status from the API. Quantities never exist on the storefront. */
export function availabilityDisplay(availability: Availability): {
  messageKey: string;
  variant: BadgeVariant;
} {
  switch (availability) {
    case "in_stock":
      return { messageKey: "availability.in_stock", variant: "success" };
    case "low_stock":
      return { messageKey: "availability.low_stock", variant: "warning" };
    case "out_of_stock":
      return { messageKey: "availability.out_of_stock", variant: "danger" };
  }
}

/**
 * The add-to-cart button is offered unless the API reports `out_of_stock` (a variant that is untracked or allows backorder
 * is reported as `in_stock`, so this follows the shop's own rule). The cart would still accept such a line; the checkout
 * refuses it (`insufficient_stock`), so offering it only moves the failure later.
 */
export function canAddToCart(availability: Availability): boolean {
  return availability !== "out_of_stock";
}
