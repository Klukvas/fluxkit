import type { AdminConfig } from "@fluxkit/api-client";

/**
 * The exponent of `currency` from the admin config (`supportedCurrencies`, the shop currency). An order keeps the
 * currency it was placed in; if the config no longer lists it, the ISO exponent that `Intl` knows is used.
 */
export function exponentOf(config: AdminConfig, currency: string): number {
  const listed = config.supportedCurrencies.find((entry) => entry.code === currency);
  if (listed !== undefined) return listed.exponent;
  if (currency === config.shopCurrency) return config.currencyExponent;
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits as number;
}
