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
  media: z
    .object({
      uploadsEnabled: z.boolean().meta({
        description:
          "False with `MEDIA_STORAGE_DRIVER=none`: the upload route answers 503 uploads_disabled; enter image URLs instead.",
      }),
      maxBytes: z.number().int().min(1).meta({
        description: "`MEDIA_MAX_BYTES`: the largest file `POST /admin/media/uploads` accepts.",
      }),
      contentTypes: z.array(z.string()).meta({
        description: "The image types an upload may have (decided by content, not by name).",
      }),
    })
    .meta({
      description:
        "Image upload settings (ADR 0028), so the admin UI can mirror the server's limits.",
    }),
});

export type AdminConfigResponse = z.output<typeof adminConfigResponseSchema>;
