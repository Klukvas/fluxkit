import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  DEFAULT_PRICES_INCLUDE_TAX,
  DEFAULT_SHOP_CURRENCY,
  SUPPORTED_SHOP_CURRENCIES,
  loadEnv,
} from "@fluxkit/config";
import { CURRENCY_CODES } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_PRICING_CONFIG, toPricingConfig } from "./pricing-config.js";

describe("pricing configuration", () => {
  it("the config package accepts exactly the currencies of the core table", () => {
    expect([...SUPPORTED_SHOP_CURRENCIES].sort()).toEqual([...CURRENCY_CODES].sort());
  });

  it("the API defaults equal the config package defaults and the documented ones", () => {
    expect(DEFAULT_PRICING_CONFIG).toEqual({
      shopCurrency: DEFAULT_SHOP_CURRENCY,
      pricesIncludeTax: DEFAULT_PRICES_INCLUDE_TAX,
      lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
    });
    expect(loadEnv({ DATABASE_URL: "postgres://x" })).toMatchObject(DEFAULT_PRICING_CONFIG);
  });

  it("narrows a validated environment and fails loudly on a currency core does not know", () => {
    const env = loadEnv({ DATABASE_URL: "postgres://x", SHOP_CURRENCY: "EUR" });
    expect(toPricingConfig(env).shopCurrency).toBe("EUR");
    expect(() =>
      toPricingConfig({ shopCurrency: "XXX", pricesIncludeTax: true, lowStockThreshold: 5 }),
    ).toThrow(/SHOP_CURRENCY/);
  });
});
