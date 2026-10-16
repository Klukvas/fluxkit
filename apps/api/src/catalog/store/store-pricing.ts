import {
  availabilityOf,
  isSupportedCurrency,
  pickSellablePrice,
  type Availability,
  type Price,
  type StockLevel,
  type SupportedCurrency,
} from "@fluxkit/core";
import type { PricingConfig } from "../../common/pricing-config.js";
import type { SellableVariantRow, StockLevelRow } from "./store.repository.js";

/**
 * Price and availability of the public store (ADR 0011, pricing plan). The numbers come from core: the price a shop
 * sells at is `pickSellablePrice`, a variant's availability is `availabilityOf`. This file only feeds core and
 * aggregates its results per product; it never reads a price or a quantity itself.
 */

export interface StoreVariantPricing {
  /** Shop currency only. */
  readonly price: Price;
  readonly availability: Availability;
}

export interface StoreProductPricing {
  readonly price: {
    readonly from: number;
    readonly to: number;
    readonly currency: SupportedCurrency;
  };
  readonly availability: Availability;
}

/** Best first: a product is as available as its best sellable variant. */
const AVAILABILITY_RANK: Readonly<Record<Availability, number>> = {
  in_stock: 2,
  low_stock: 1,
  out_of_stock: 0,
};

/**
 * A variant is sellable when it is active and has a valid price in the shop currency. The repository already returns
 * only such rows (it joins the shop-currency price); `pickSellablePrice` still decides, so a row without a price in the
 * shop currency is dropped here as well and never reaches a response.
 */
export function priceVariants(
  variants: readonly SellableVariantRow[],
  levels: readonly StockLevelRow[],
  pricing: PricingConfig,
): Map<string, StoreVariantPricing> {
  const levelsByVariant = new Map<string, StockLevel[]>();
  for (const level of levels) {
    const entry = levelsByVariant.get(level.variantId) ?? [];
    entry.push({ onHand: level.onHand, reserved: level.reserved });
    levelsByVariant.set(level.variantId, entry);
  }
  const result = new Map<string, StoreVariantPricing>();
  for (const variant of variants) {
    // A stored currency core does not know can never be the shop currency, so that row is not sellable either.
    const picked = isSupportedCurrency(variant.priceCurrency)
      ? pickSellablePrice(
          [
            {
              amount: variant.priceAmount,
              currency: variant.priceCurrency,
              compareAtAmount: variant.compareAtAmount,
            },
          ],
          pricing.shopCurrency,
        )
      : undefined;
    if (picked === undefined || !picked.ok) {
      continue;
    }
    result.set(variant.id, {
      price: picked.price,
      availability: availabilityOf(
        { trackInventory: variant.trackInventory, allowBackorder: variant.allowBackorder },
        levelsByVariant.get(variant.id) ?? [],
        pricing.lowStockThreshold,
      ),
    });
  }
  return result;
}

/**
 * Product level: `price` is the lowest and the highest variant price in the shop currency; `availability` is the best
 * availability among the sellable variants (in_stock, else low_stock, else out_of_stock). Undefined for a product with
 * no sellable variant, which the store does not show.
 */
export function summarizeProduct(
  variants: readonly StoreVariantPricing[],
  shopCurrency: SupportedCurrency,
): StoreProductPricing | undefined {
  const [first, ...rest] = variants;
  if (first === undefined) {
    return undefined;
  }
  let from = first.price.amount;
  let to = first.price.amount;
  let availability = first.availability;
  for (const variant of rest) {
    from = Math.min(from, variant.price.amount);
    to = Math.max(to, variant.price.amount);
    if (AVAILABILITY_RANK[variant.availability] > AVAILABILITY_RANK[availability]) {
      availability = variant.availability;
    }
  }
  return { price: { from, to, currency: shopCurrency }, availability };
}
