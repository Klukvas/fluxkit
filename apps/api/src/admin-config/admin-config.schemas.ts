import { z } from "zod";

/** `GET /admin/config`: what the admin UI needs to edit translated texts and money; read from the environment, nothing else. */
export const adminConfigResponseSchema = z.object({
  defaultLocale: z
    .string()
    .meta({ description: "`DEFAULT_LOCALE`: the locale every required text must contain." }),
  locales: z
    .array(z.string())
    .meta({ description: "`LOCALES`: the locales accepted in translated texts." }),
  shopCurrency: z
    .string()
    .meta({ description: "`SHOP_CURRENCY`: the one currency the shop sells in." }),
  currencyExponent: z.number().int().min(0).meta({
    description: "Digits after the decimal point of the shop currency (minor-unit exponent).",
  }),
  supportedCurrencies: z
    .array(z.object({ code: z.string(), exponent: z.number().int().min(0) }))
    .meta({
      description: "Every currency a price can be stored in, with its minor-unit exponent.",
    }),
  pricesIncludeTax: z.boolean().meta({ description: "`PRICES_INCLUDE_TAX`." }),
  lowStockThreshold: z.number().int().min(0).meta({ description: "`LOW_STOCK_THRESHOLD`." }),
});

export type AdminConfigResponse = z.output<typeof adminConfigResponseSchema>;
