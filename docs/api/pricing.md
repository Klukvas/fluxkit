# API: pricing

Admin price endpoints (`/admin/products/...`). Model and decisions: `docs/adr/0011-money-and-prices.md`, `docs/adr/0012-pricing-inventory-schema.md`, plan `docs/plans/2026-10-16-pricing-and-inventory.md`.
Conventions shared with the catalog (session cookie, CSRF header, problem+json, ids, timestamps): `docs/api/catalog.md`. Source of truth for routes and schemas: `docs/api/openapi.json`. No feature flag: prices are core.
Inventory and stock endpoints, and the price and availability fields of the store API, are later steps of the plan and are not documented here (they do not exist yet).

## Money in the API

- An amount is a JSON **integer in minor units** (kopiykas, cents) from 0 to 1 000 000 000 000; never a decimal, never a string. A value that is not an integer, is negative, is above the maximum, or is not a number is rejected, never rounded.
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
- Variants generated for a live product (`POST .../variants/generate`, adding an option value) are not changed by this: they follow ADR 0008 and start active unless the type requires a variant attribute. Price them with the endpoints above; a live product with an active priceless variant cannot be published again after an unpublish until it is priced. (Open point for the store step: the store API will not list a priceless variant.)
