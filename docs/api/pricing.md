# API: pricing

Admin price endpoints (`/admin/products/...`). Model and decisions: `docs/adr/0011-money-and-stock-model.md`, `docs/adr/0012-pricing-inventory-schema.md`, plan `docs/plans/2026-10-16-pricing-and-inventory.md`.
Conventions shared with the catalog (session cookie, CSRF header, problem+json, ids, timestamps): `docs/api/catalog.md`. Source of truth for routes and schemas: `docs/api/openapi.json`. No feature flag: prices are core.
Inventory, stock flags, locations and the reservation service are in `docs/api/inventory.md`. The prices and availability of the public store API are in the Store section at the end of this file.

## Money in the API

- An amount is a JSON **integer in minor units** (kopiykas, cents) from 0 to 1 000 000 000 000; never a decimal, never a string. A value that is not an integer, is negative, is above the maximum, or is not a number is rejected; the API never rounds. The API validates the **parsed JSON number**, not the text you sent: JSON parsing turns `100.0` into the integer 100 (accepted as 100), and a literal such as `1000000000000.0000001` that IEEE-754 rounds to an exact integer is accepted as that integer. The safe-integer and range checks still apply to the parsed value. Send integers.
- `currency` is an upper-case ISO 4217 code from the supported table (`UAH`, `USD`, `EUR`, `PLN`, `GBP`, `CZK`, `CHF`, `CAD`, `JPY`, `KWD`), matched exactly (`uah` is rejected).
- A price is `{amount, currency, compareAtAmount}`; `compareAtAmount` (the old price) is `null` or an integer strictly greater than `amount`.
- One price per variant and currency. The shop sells only in `SHOP_CURRENCY` (default `UAH`, `docs/contracts/config.md`); prices in other currencies can be stored but are never sold and never converted.
- Server rules only: the client never sends totals, and the store never trusts a client price.

## Price shape

`{id, variantId, currency, amount, compareAtAmount (integer or null), createdAt, updatedAt}`.

## Endpoints

Permissions: `GET` needs `catalog.read`; `PUT` and `DELETE` need `catalog.write` (existing roles: `owner`, `manager`; `viewer` reads only). State-changing requests need the CSRF header. Every write takes the product row lock (the lock publishing and variant edits take), so a price change and a publish cannot interleave.

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `GET /admin/products/{id}/variants/{variantId}/prices` | admin | List the prices of a variant, ordered by currency | path `id`, `variantId` | 200 `{items: [price]}` (empty list when the variant has none) | 400 (malformed id), 404 (unknown product, unknown variant, variant of another product) | - |
| `GET /admin/products/{id}/prices` | admin | List the prices of every variant of a product, in every currency | path `id` | 200 `{items: [price]}` ordered by variant (position, then id) and currency; each item is the per-variant shape, `variantId` included; not paged (a product has at most 250 variants); two statements however many variants and prices (tested with 2 and with 200+ variants) | 400 (malformed id), 404 (unknown product) | - |
| `PUT /admin/products/{id}/variants/{variantId}/prices/{currency}` | admin | Set the price in one currency: creates it or replaces it entirely | path `currency` (supported, upper case); body (strict) `amount`, optional `compareAtAmount` (integer or `null`; `null` or absent clears the old price) | 201 price when new, 200 when it replaced one | 400 (`currency` `unsupported_currency` in the path; `amount`: `required`, `invalid_type`, `not_an_integer`, `negative_amount`, `amount_out_of_range`; `compareAtAmount`: `invalid_type`, `compare_at_not_an_integer`, `compare_at_out_of_range`, `compare_at_not_greater`; `unknown_field`), 404 | - |
| `DELETE /admin/products/{id}/variants/{variantId}/prices/{currency}` | admin | Delete the price of a variant in one currency | path `currency` (supported, upper case) | 204 | 400, 404 (unknown product, variant or price), 409 (`rule_violation`, rule `last_shop_price`: the price is in `SHOP_CURRENCY`, the variant is active and its product is `active`; unpublish the product or switch the variant off first) | - |
| `PUT /admin/products/{id}/prices` | admin | Set many prices of one product's variants in one transaction (all or nothing) | body (strict) `items`: 1 to 500 of `{variantId, currency, amount, compareAtAmount?}` | 200 `{items: [price]}` in request order | 400 (`errors[]` with indexed paths: `items.3.amount`, `items.3.currency` `unsupported_currency`, `items.3.compareAtAmount`, `items.3.variantId` `invalid_reference` for an unknown variant or one of another product, `items.4` `duplicate_item` for a repeated variant and currency, `items` `too_small` or `too_big`, `items.N.<field>` `unknown_field`), 404 (unknown product) | - |

Notes:

- The bulk limit is 500 items: a product has at most 250 variants, so one call prices every variant in two currencies. Larger sets go in several calls (each call is atomic on its own).
- In a bulk call every item is validated first and all problems are returned together; nothing is written when any item is invalid. The same variant and currency twice is rejected (`duplicate_item`) rather than resolved by order.

## Effect on the catalog API

The price facts feed core `publishPreconditions` (`price_missing`):

- `POST /admin/products/{id}/publish` fails with `400 validation_failed` when an **active** variant has no price in the shop currency; `errors[]` has one entry `{path: "variants.N", code: "price_missing"}` per such variant (`N` is the variant's index in the order of the product detail, `message` names the SKU). Inactive variants do not need a price. A price in another currency does not count.
- `PATCH /admin/products/{id}/variants/{variantId}` with `isActive: true` on an **active** product fails with `409 rule_violation`, rule `price_missing`, when that variant has no shop-currency price. On a draft or archived product it stays allowed (the publish check runs later). A variant that was already active and priceless does not block unrelated edits of other variants.
- Variants generated for a live product (`POST .../variants/generate`, adding an option value) are not changed by this: they follow ADR 0008 and start active unless the type requires a variant attribute. Price them with the endpoints above; a live product with an active priceless variant cannot be published again after an unpublish until it is priced. The store API does not list a priceless variant (done in the store step, see Store below).

## Store (public prices and availability)

Public, no auth, GET only, JSON. Source of truth for shapes: `docs/api/openapi.json`. Price selection is core `pickSellablePrice`, availability is core `availabilityOf`; the store API only feeds them and never reads a price or a quantity itself.

| Endpoint | Auth | Response | Notes |
|---|---|---|---|
| `GET /store/config` | public | `{currency, currencyExponent, pricesIncludeTax, defaultLocale, locales}` | `currency` is `SHOP_CURRENCY`; `currencyExponent` is the number of minor-unit digits (`UAH` 2, `JPY` 0, `KWD` 3; from the core currency table); `pricesIncludeTax` is `PRICES_INCLUDE_TAX` (a display flag, no tax is calculated); `locales` are `LOCALES`. Nothing else (no thresholds, no internals). No `Cache-Control` header, like the other store routes; Express adds a weak `ETag` to every store response, so a client may revalidate with `If-None-Match`. |
| `GET /store/products/{slug}` | public | each variant has `price: {amount, currency, compareAtAmount}` and `availability`; the product has `price: {from, to, currency}` and `availability` | 404 when the product has no sellable variant |
| `GET /store/products` | public | each item has `price: {from, to, currency}` and `availability` | products without a sellable variant are not listed and not counted in `total`; sorting, filters and pagination are unchanged |

## Admin config

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `GET /admin/config` | any signed-in admin (no permission; a role cannot be signed in without it) | The shop settings the admin UI needs on its own host | none | 200 `{defaultLocale, locales, shopCurrency, currencyExponent, supportedCurrencies, pricesIncludeTax, lowStockThreshold, media}`: `defaultLocale` and `locales` are `DEFAULT_LOCALE` and `LOCALES`; `shopCurrency` is `SHOP_CURRENCY` with its minor-unit digits in `currencyExponent`; `supportedCurrencies` is `[{code, exponent}]` for every currency a price may be stored in (the core currency table: the shop currency is one of them); `pricesIncludeTax` is `PRICES_INCLUDE_TAX`; `lowStockThreshold` is `LOW_STOCK_THRESHOLD`; `media` is `{uploadsEnabled, maxBytes, contentTypes}` (ADR 0028, `docs/api/media.md`: false with `MEDIA_STORAGE_DRIVER=none`, `MEDIA_MAX_BYTES`, the accepted image types). Read from the running configuration, nothing else (no secret, no personal data); `Cache-Control: no-store` like every `/admin` response | 401 | - |

- **Amounts** are JSON integers in minor units (0 to 1 000 000 000 000, exact in every JSON parser). `currency` is always the shop currency. `compareAtAmount` is `null` or an integer greater than `amount`. Prices in other currencies are never returned and never converted.
- **Sellable variant**: active and with a valid price in the shop currency. Any other variant (inactive, priceless, or priced only in another currency) is never returned, is not counted in `from`/`to` or in `availability`, and does not keep an option value, an option or an image alive (ADR 0007 uses the sellable set). The same variant set drives the list and the detail.
- **Product with no sellable variant**: not listed (`total` and pages count only listed products) and its detail answers `404 not_found`, exactly like an unpublished product. It appears again as soon as one variant is active and priced in the shop currency. Out of stock is not hidden: a product whose sellable variants are all out of stock is listed with `availability: "out_of_stock"`.
- **Product `price`**: `from` is the lowest and `to` the highest variant `amount` over the sellable variants (equal when there is one price or all are equal). Compare-at prices are not aggregated.
- **Variant `availability`** (core `availabilityOf`): the sum over ALL inventory levels of the variant of `max(0, on_hand - reserved)`, compared with `LOW_STOCK_THRESHOLD` (default 5): `in_stock` above the threshold, `low_stock` from 1 up to and including the threshold, `out_of_stock` at 0. A variant that is not tracked (`trackInventory` false) or allows backorder is always `in_stock`; a tracked variant with no level rows is `out_of_stock`. Reserved units reduce availability at once.
- **Product `availability`** (deterministic): the best availability among the sellable variants, in the order `in_stock` > `low_stock` > `out_of_stock`. So a product is `in_stock` if any sellable variant is in stock, else `low_stock` if any is low, else `out_of_stock`. A variant that is not sellable never improves it.
- **Never in a store response**: quantities (`on_hand`, `reserved`, available numbers), locations, movements, reservations, the flags `trackInventory` and `allowBackorder`, price ids and timestamps, prices in other currencies, the threshold. Leak tests deep-scan every store route for these keys and for seeded numeric values.
- **Query cost**: a constant number of statements for any page or product size (the tests require the same count for a page of one and a page of many products and for a small and a large product; the detail stays at 10 or fewer): prices and stock levels are loaded in batches by product id set, not per variant.
