import { z } from "zod";
import { SEARCH_LIMITS, SEARCH_SORTS } from "@fluxkit/core";
import { storeProductListItemSchema } from "../../catalog/store/store.schemas.js";

/**
 * `GET /store/search` and `GET /store/search/suggest` (ADR 0034 decision 10, `docs/api/search.md`). The query is strict:
 * an unknown parameter is a 400. Only the SHAPES are checked here (lengths, digits); the meaning (facet keys, values,
 * ranges, page limits) is checked by core in the service, which answers 400 with the parameter it refused.
 */
const textParam = z.string().max(2_000);

export const storeSearchQuerySchema = z.strictObject({
  q: textParam.optional().meta({
    description: `The text the shopper typed, at most ${String(SEARCH_LIMITS.maxQueryLength)} characters and no control characters; at most ${String(SEARCH_LIMITS.maxQueryWords)} words are used. Missing or empty browses with facets (sort newest).`,
  }),
  locale: z.string().max(35).optional(),
  f: z
    .union([
      z.string().max(300),
      z.array(z.string().max(300)).max(SEARCH_LIMITS.maxSelectionValues + 1),
    ])
    .optional()
    .meta({
      description:
        "Repeated `<facetKey>:<value>`: `brand:<slug>`, `category:<uuid>`, `inStock:true|false`, `opt.<code>:<valueCode>`, `attr.<code>:<valueCode|true|false|min..max>`. Values of one key are alternatives (OR), keys narrow each other (AND). An unknown key is a 400.",
    }),
  price: z.string().max(40).optional().meta({
    description: "`<min>..<max>` in minor units of the shop currency; either end may be left out.",
  }),
  sort: z
    .string()
    .max(20)
    .optional()
    .meta({ description: `One of ${SEARCH_SORTS.join(", ")}.` }),
  page: z
    .string()
    .regex(/^[1-9][0-9]{0,4}$/, "must be a whole number from 1")
    .optional(),
  limit: z
    .string()
    .regex(/^[1-9][0-9]{0,2}$/, "must be a whole number from 1")
    .optional(),
});

export type StoreSearchQuery = z.output<typeof storeSearchQuerySchema>;

export const storeSuggestQuerySchema = z.strictObject({
  q: textParam,
  locale: z.string().max(35).optional(),
});

export type StoreSuggestQuery = z.output<typeof storeSuggestQuerySchema>;

const facetValueSchema = z.object({
  code: z.string().meta({ description: "The value as it goes into `f` (`<key>:<code>`)." }),
  label: z.string().nullable().meta({
    description:
      "Text in the request's locale; null for `true`/`false` values (the storefront words them).",
  }),
  count: z.number().int().min(0).nullable().meta({
    description:
      "Products with this value among the results (other values of the same facet ignored); null for variant-level facets, which list values without counts (ADR 0034 decision 4).",
  }),
  selected: z.boolean(),
});

export const storeSearchFacetSchema = z.object({
  key: z
    .string()
    .meta({ description: "`brand`, `category`, `inStock`, `opt.<code>` or `attr.<code>`." }),
  kind: z.enum(["slug", "uuid", "code", "boolean", "range"]),
  level: z.enum(["product", "variant"]),
  label: z.string().nullable().meta({
    description: "Option or attribute name in the locale; null for brand, category and inStock.",
  }),
  counted: z.boolean().meta({ description: "Whether `count` is given (product-level facets)." }),
  values: z.array(facetValueSchema),
  range: z.object({ min: z.number(), max: z.number() }).nullable().meta({
    description:
      "Smallest and largest value of a number attribute among the results; null otherwise.",
  }),
});

export const storeSearchResponseSchema = z.object({
  items: z.array(storeProductListItemSchema),
  total: z.number().int().min(0).meta({
    description:
      "Products the engine found (at most 10 000 can be paged). The page may hold fewer items than `limit` when a product stopped being for sale after it was indexed.",
  }),
  page: z.number().int().min(1),
  pageCount: z.number().int().min(0),
  limit: z.number().int().min(1),
  sort: z.enum(SEARCH_SORTS),
  relaxed: z.boolean().meta({
    description:
      "True when the complete words matched nothing and a second pass answered: the last word matched as a prefix (an unfinished word) and, with two or more words, only some of the words: show it as partial matches.",
  }),
  query: z.object({ normalized: z.string() }),
  facets: z.array(storeSearchFacetSchema),
  price: z.object({ min: z.number().int(), max: z.number().int() }).nullable().meta({
    description:
      "Lowest and highest variant price of the results ignoring the price filter; null without results.",
  }),
});

export type StoreSearchResponse = z.output<typeof storeSearchResponseSchema>;
export type StoreSearchFacet = z.output<typeof storeSearchFacetSchema>;

export const storeSuggestResponseSchema = z.object({
  items: z
    .array(z.object({ slug: z.string(), title: z.string() }))
    .max(SEARCH_LIMITS.maxSuggestions),
});

export type StoreSuggestResponse = z.output<typeof storeSuggestResponseSchema>;
