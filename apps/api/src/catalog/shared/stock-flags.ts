/**
 * Stock flags a new variant starts with. A product type that does not ship (digital goods) has no stock to count, so
 * its variants start untracked (plan assumption, `docs/plans/2026-10-16-pricing-and-inventory.md`); every other
 * variant keeps the column defaults (tracked, no backorder). Changing `requires_shipping` later does not touch
 * variants that already exist.
 */
export function initialStockFlags(requiresShipping: boolean): { trackInventory?: false } {
  return requiresShipping ? {} : { trackInventory: false };
}
