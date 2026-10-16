import type { ProductStatus } from "./types.js";

/**
 * The ONE definition of "this variant can be bought" (review finding R7): its product is `active`, the variant itself
 * is active, and it has a price in the shop currency. The public store lists and shows exactly these variants (its SQL
 * filter in `StoreRepository` must mean the same), and `ReservationsService.reserve` refuses everything else with
 * `variant_not_sellable`, so a line the store never showed can not be reserved.
 */
export function isVariantSellable(facts: {
  readonly productStatus: ProductStatus;
  readonly variantIsActive: boolean;
  readonly hasShopPrice: boolean;
}): boolean {
  return facts.productStatus === "active" && facts.variantIsActive && facts.hasShopPrice;
}
