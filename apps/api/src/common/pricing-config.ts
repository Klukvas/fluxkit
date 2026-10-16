import { DEFAULT_LOW_STOCK_THRESHOLD, DEFAULT_PRICES_INCLUDE_TAX } from "@fluxkit/config";
import { isSupportedCurrency, type SupportedCurrency } from "@fluxkit/core";

export const PRICING_CONFIG = Symbol("PRICING_CONFIG");

/** From `SHOP_CURRENCY`, `PRICES_INCLUDE_TAX` and `LOW_STOCK_THRESHOLD` (docs/contracts/config.md). */
export interface PricingConfig {
  /** The one currency the shop sells in; an active variant needs a price in it. */
  readonly shopCurrency: SupportedCurrency;
  readonly pricesIncludeTax: boolean;
  readonly lowStockThreshold: number;
}

export const DEFAULT_PRICING_CONFIG: PricingConfig = Object.freeze({
  shopCurrency: "UAH",
  pricesIncludeTax: DEFAULT_PRICES_INCLUDE_TAX,
  lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
});

/**
 * Narrows the already validated config strings to core's currency type. `loadEnv` rejects unsupported codes, so a
 * failure here means the config package and core disagree (a test asserts they do not): fail loudly.
 */
export function toPricingConfig(source: {
  shopCurrency: string;
  pricesIncludeTax: boolean;
  lowStockThreshold: number;
}): PricingConfig {
  if (!isSupportedCurrency(source.shopCurrency)) {
    throw new RangeError(`SHOP_CURRENCY "${source.shopCurrency}" is not a supported currency.`);
  }
  return {
    shopCurrency: source.shopCurrency,
    pricesIncludeTax: source.pricesIncludeTax,
    lowStockThreshold: source.lowStockThreshold,
  };
}
