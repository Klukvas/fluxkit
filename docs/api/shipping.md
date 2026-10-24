# API: shipping

Admin settings of shipping (delivery methods with their rates, the non-secret profile and connection check of each enabled shipping provider; plan step 5), and the store side (the options for the cart, carrier lookups, and the shipping member of the checkout; plan step 6) of `docs/plans/2026-10-24-shipping.md`. Decisions: `docs/adr/0029-shipping.md` (decisions 3 to 9, 13). Source of truth for shapes: `docs/api/openapi.json`. No feature flag (shipping is core); **a shop with no active method behaves exactly as before** (the options list is empty and the checkout is unchanged). Shipments and tracking are plan step 8 (not built).

**Release coupling.** Once a shop activates a method, every checkout of a cart that ships goods must name a method and send the option's `total` as `expectedTotal`. The storefront v1 does neither, so it would get `400 shipping_method_required` (or `409 shipping_changed`). Plan steps 6 (this API), 9b (the store client methods) and 10 (the storefront delivery step) are released together; until then do not activate a method in a shop that runs the storefront.

Every route needs the permission `shipping.manage` (owner and manager; the viewer gets `403`), reads included. State-changing requests need `X-Fluxkit-CSRF: 1` and, with a body, `Content-Type: application/json` (otherwise `403`, before authentication). Every response carries `Cache-Control: no-store`. Problem bodies are the common `application/problem+json` (`docs/api/catalog.md`, Errors); validation faults are `errors[]` entries `{path, code}`.

# Admin settings

## Shipping methods

A method is `{id, code, title, description, kind, providerCode, providerService, pricing, currency, countryCodes, isActive, position, createdAt, updatedAt}`. `title` and `description` are locale maps (default locale required for `title`); for `store_pickup` the `description` is the text shown to the shopper. `kind` is `address`, `pickup_point` or `store_pickup`. Every amount in `pricing` is an integer in minor units of `currency`, which the server sets to `SHOP_CURRENCY` (never sent by the client).

`pricing` is one of `{type: "flat", amount}`, `{type: "free_over", amount, freeFrom}` (price 0 when the subtotal is at least `freeFrom`), `{type: "tiers", tiers: [{fromSubtotal, amount}]}` (starts at `fromSubtotal` 0, strictly ascending, at most 20 tiers) or `{type: "carrier_on_delivery"}` (the shop charges 0, the recipient pays the carrier). Rules are core's `validateShippingPricing`; its reasons are the `errors[].code` at `pricing.<field>`: `unknown_type`, `unknown_field`, `required`, `not_an_integer`, `out_of_range`, `no_tiers`, `too_many_tiers`, `first_tier_not_zero`, `tiers_not_sorted`, `duplicate_tier`, `not_an_array`, `not_an_object`.

| Endpoint | Auth | Purpose | Request | Response | Errors |
|---|---|---|---|---|---|
| `POST /admin/shipping/methods` | `shipping.manage` | Create a method; it is INACTIVE unless `isActive: true` | strict `{code, title, description?, kind, providerCode?, providerService?, pricing, countryCodes, isActive?, position?}`; `code` matches `^[a-z][a-z0-9_]{0,63}$` and is never renamed; `countryCodes` 1 to 250 unique two-letter upper-case codes; `currency` and `id` are refused as `unknown_field` | `201` method, `Location: /admin/shipping/methods/{id}` | `400` structure, locale rules (`title.<locale>`, `description.<locale>`), pricing reasons, `providerCode:provider_required` (a `pickup_point`, or a `providerService`, without a provider), `providerCode:provider_not_enabled` (a provider the shop does not run), `kind:provider_lacks_pickup_points`; `409 conflict` (`field: code`) when the code is taken |
| `GET /admin/shipping/methods` | `shipping.manage` | List methods ordered by `position`, `code`, `id` | `?limit` (1 to 100, default 50), `?offset` | `200 {items, total, limit, offset}` | `400` |
| `GET /admin/shipping/methods/{id}` | `shipping.manage` | One method | none | `200` method | `400` malformed id; `404` |
| `PATCH /admin/shipping/methods/{id}` | `shipping.manage` | Change the named fields; the rest stays. The merged kind and provider are validated, not only the patch. A `pricing` replaces the whole pricing and stamps `currency` with the shop currency. `description: null` clears the text. An empty body changes nothing | strict, the create fields except `code`; `code` is `400 unknown_field` | `200` method | `400` as create (the provider is checked against the enabled ones when the patch changes `kind`, `providerCode` or `providerService`, or sets `isActive: true`; deactivating and repricing always work); `404` |
| `DELETE /admin/shipping/methods/{id}` | `shipping.manage` | Delete a method no order used | none | `204` | `404`; `409 rule_violation` with `rule: "method_in_use"` when an order's shipping snapshot links the method (deactivate it instead; the check runs under the method's row lock, so an order placed at the same moment cannot slip past it) |

## Shipping providers

A provider is one the shop runs (`SHIPPING_PROVIDERS_ENABLED`, `docs/contracts/config.md`). An unknown or disabled code is `404`; a code that is not shaped like a provider code is `400` at `code`. Credentials (API keys) are read from the environment and never stored, returned or logged here.

| Endpoint | Auth | Purpose | Request | Response | Errors |
|---|---|---|---|---|---|
| `GET /admin/shipping/providers/{code}/settings` | `shipping.manage` | The saved non-secret profile (sender data, default parcel) | none | `200 {providerCode, settings, updatedAt, updatedBy}`; before the first save `settings` is `{}` and the two others `null` | `400`; `404` |
| `PUT /admin/shipping/providers/{code}/settings` | `shipping.manage` | Replace the profile; records the saving admin in `updatedBy` | strict `{settings: object}` | `200` as GET | `400` at `settings.<path>`: `not_an_object`, `invalid_key` (keys are letters, digits and `_`, starting with a letter), `secret_not_allowed` (a key that names a credential: `apiKey`, `token`, `password`, `secret`, `credential`, `authorization`, `private_key`), `too_deep` (over 4 levels), `too_many_keys` (over 50 per object), `too_many_items` (over 100), `too_long` (a string over 500), `unsafe_text`, `not_finite`, `too_large` (over 16 KiB as JSON); `404` |
| `POST /admin/shipping/providers/{code}/check` | `shipping.manage`; rate limit `shippingCheck` per signed-in admin (30 per 10 minutes) | Ask the provider whether the shop's credentials work (`checkConnection`, time limit 5 s) | none | `200 {ok: true}` or `200 {ok: false, reason, providerCodes}` with `reason` one of `unavailable`, `rejected`, `invalid_credentials`, `not_supported` and `providerCodes` raw carrier codes (short, no spaces); never a carrier message or a key. A call that runs out of time is `unavailable` | `400`; `404`; `429 too_many_requests` with `Retry-After` |

The settings are validated only for what is true of any provider (a bounded plain JSON object without credential-like keys): `ShippingProviderPort` has no settings validator yet, so a provider that needs required fields or formats checks them when it uses the settings (ADR 0029 open question; Nova Poshta fields are unverified until plan step 7a).

# Store

Public `GET` routes (no CSRF header needed). Money is `{amount, currency}` in minor units of the shop currency. Problem bodies as everywhere (`application/problem+json`).

| Endpoint | Auth | Purpose | Request | Response | Errors |
|---|---|---|---|---|---|
| `GET /store/shipping/options` | public (the cart of the customer session, else of the `fluxkit_cart` cookie; never a request field); rate limit `shippingOptions` per address (30 a minute) | The shipping methods for the current cart, priced by the server | `?country` (two upper-case letters: the address the shopper entered), `?locale`, `?cityRef`, `?pickupPointRef` (carrier refs, letters, digits, `-`, `_`, 1 to 64); unknown parameters are `400` | `200 {subtotal, options: [option]}`; `Cache-Control: no-store`; never creates a cart or a cookie | `400`, `409` (a cart that cannot be priced, as `GET /store/cart`), `429` |
| `GET /store/shipping/providers/{code}/cities` | public; rate limit `shippingLookup` per address (60 a minute) | City search of an enabled provider | `?q` (2 to 50 characters after trimming), `?locale`, `?limit` (1 to 50, default 20), `?offset` | `200 {items: [{ref, name, region}], total, limit, offset, stale}`; on success `Cache-Control: public, max-age=300` | `400` (`q` `too_short` / `too_long`, limits), `404` (not an enabled provider), `429`, `503 shipping_provider_unavailable` with `Retry-After: 30` |
| `GET /store/shipping/providers/{code}/pickup-points` | public; rate limit `shippingLookup` | The branches and parcel lockers of a city | `?cityRef` (required), `?q` (up to 50 characters: number or description contains it, case-insensitive), `?kinds` (`branch`, `locker`, comma-separated; both by default), `?limit` (1 to 200, default 50), `?offset` | `200 {items: [{ref, number, kind, cityRef, cityName, countryCode, description, maxWeightGrams}], total, limit, offset, stale}`; on success `public, max-age=300` | `400`, `404` (not an enabled provider, or one without pickup points), `429`, `503` as above |

Errors of every `/store/shipping` route are `no-store`. A lookup carries no personal data (carrier directory data only), so a successful answer may be cached by the browser for 5 minutes.

## The option

```
{ methodCode, kind, title, description | null, providerCode | null, countryCodes, available, reason?,
  price | null, payer | null, total | null, estimate | null }
```

- Only active methods in `SHOP_CURRENCY` are listed (a method in another currency is never offered), ordered by `position`, `code`. The list is empty for an empty cart, for a cart that ships nothing (`requiresShipping` false) and for a shop without an active method.
- Each method is quoted by core `quoteShippingMethod`, the same function the checkout uses: `price` is what the shop charges (`decideShippingPrice`: `flat`; `free_over` is 0 when the subtotal is at least `freeFrom`; `tiers`; `carrier_on_delivery` is 0 with `payer: recipient_on_delivery`), and **`total` = cart `subtotal` + `price`: the storefront sends it back as the checkout's `expectedTotal`**, so the browser never adds money. The subtotal is the cart's (every available line, digital ones included: the threshold basis of ADR 0029 decision 3).
- `available: false` with `reason`, and `price`, `payer`, `total`, `estimate` all `null`. Reasons, first that applies: `inactive`, `currency_not_offered` (both only in the checkout's `shipping_changed`), `provider_not_enabled` (a `pickup_point` method whose provider the shop does not run), `country_required` (`address` or `pickup_point` without a country), `country_not_served`, `pricing_invalid` (a stored pricing the write rules refuse: never charged), `total_out_of_range` (subtotal plus shipping does not fit `MAX_AMOUNT`).
- The destination country: `?country` for `address` (and for `store_pickup` when given; `store_pickup` is available without one); for `pickup_point` the country of `?pickupPointRef` when the provider knows that point, else `?country`.
- `description` is the method's text; for `store_pickup` it is the pickup instructions (ADR 0029 open question 5, decided in plan step 3).
- `estimate`: the carrier's own price (`ShippingProviderPort.estimate`), **informational only, never charged and never part of `total`**. Asked only for an available method with a provider that offers estimates, when the request names a destination: `?pickupPointRef` (kind `pickup_point`) or `?cityRef`. Time limit 5 s; any failure (refusal, timeout, outage, an amount in another currency) is `estimate: null`, never an error of the answer. Cached 10 minutes per (method, city, point, subtotal band of 50 000 minor units).

## The checkout's `shipping` member

`POST /store/checkout` (`docs/api/orders.md`) takes an optional strict member `shipping: {methodCode, pickupPointRef?}` (`null` or missing means not sent). Rules (ADR 0029 decision 4), in this order:

1. Shape (core `parseShippingSelection`): `400 validation_failed` at `shipping.methodCode` / `shipping.pickupPointRef` (`required`, `not_a_string`, `invalid_format`, `unknown_field`).
2. After the cart is locked and priced (and `cart_changed` for a missing or unavailable line, as before):
   - a cart that ships nothing with `shipping` sent: `400 shipping_not_applicable`;
   - a cart that ships goods without `shipping`, in a shop with at least one active method: `400 shipping_method_required`;
   - a cart that ships goods without `shipping` in a shop with **no active method: today's checkout, unchanged** (address only, shipping 0, no snapshot, no adjustment, `cart_changed` for a different total, then `shipping_address_required`).
3. The method is read inside the transaction **without a lock**. Missing or inactive: `409 shipping_changed` with `shipping: {methodCode, available: false, reason: "inactive"}`; another currency: the same with `currency_not_offered`.
4. Kind rules, `400 validation_failed`: `pickup_point` needs `shipping.pickupPointRef` (`required`) and takes no `shippingAddress` (`not_applicable`: the order's address is the point's); `address` and `store_pickup` refuse a `pickupPointRef` (`not_applicable`); `address` needs `shippingAddress` (`shipping_address_required`); `store_pickup` takes an optional address (its country is checked when given; the contact is the recipient).
5. Pickup point: resolved BEFORE the transaction opens (below). Unknown to the carrier: `400 validation_failed` at `shipping.pickupPointRef` with `unknown_pickup_point`. Carrier unreachable and the point not cached: `503 shipping_provider_unavailable` with `Retry-After: 30`; only that method fails.
6. Availability and price (core `quoteShippingMethod`): not available for the destination: `409 shipping_changed` with the option (`reason`); subtotal plus shipping beyond `MAX_AMOUNT`: `409 rule_violation` with `rule: total_out_of_range` (never clamped). Then `computeOrderTotals(lines, [shipping adjustment])`; its range refusals are `409 rule_violation` with that rule.
7. **Consent**: `expectedTotal` must equal subtotal + shipping. Otherwise `409 cart_changed` (with `cart`) when a line's price changed since the shopper last saw it (a `price_changed` notice), else `409 shipping_changed` with `shipping`, the method's fresh option exactly as the options endpoint returns it for that destination. Nothing is reserved either way. A client that sends the subtotal (the storefront v1) gets `shipping_changed`. Known limit: a cart whose quantities changed in another tab (no notice) is answered `shipping_changed` too; its option carries the fresh `total`, so the consent is still asked for the right amount.
8. Write, in the same transaction, after the order, its lines, reservations and links: the `order_shipping` snapshot (method id, code, kind, provider code and service, the whole title map, amount, currency, payer, `estimated_carrier_amount` = the cached estimate of the options for that point and subtotal band or `NULL`, `destination` for a pickup point) and ONE `order_adjustment` `{kind: "shipping", code: <method code>, label: <title map>, amount, includedInPrice: false, source: <provider code or null>}` (amount 0 for a free or carrier-on-delivery method); `sales_order.shipping_total` = the adjustment. A pickup point order also stores a readable `shipping_address` `{countryCode, city: <city name>, line1: <point description>}`. A method deleted between the read and this insert (its foreign key) answers `409 shipping_changed` (`inactive`) and rolls everything back.

**No network inside the transaction.** The checkout calls a provider only in one step BEFORE its transaction, outside every lock: a `pickup_point` selection is resolved from the directory cache or with ONE `findPickupPoint` call (5 s limit). The step is skipped when the `Idempotency-Key` already names an order (read without a lock), so a replay never calls a provider; inside the transaction the replay check stays first and a replay never recomputes a price. If the method changed between the step and the transaction, the point is taken from the cache only (else `503`). The lock order of ADR 0015 is unchanged: no lock is added; the snapshot insert takes its foreign key share lock on the method row after the inventory locks.

**Idempotency fingerprint version 2**: the normalized `shipping` member (`null` when not sent) is part of the fingerprint. A replay of an order placed under version 1 (before this release) answers `409 idempotency_key_reused` (accepted, ADR 0029).

**Concurrency.** A deactivation, a repricing or a delete of a method that commits while a checkout is between its method read and its commit does not stop that order: it is placed with the terms it read (the shopper agreed to exactly those). Every checkout that starts after the change commits sees it. A method delete and a new order cannot both pass: the delete runs under the method's row lock and refuses a method an order links (`method_in_use`), and the checkout's insert waits for and then fails on a deleted row.

## Directory cache and carrier outages (ADR 0029 decision 6)

In-process, per API instance (several instances multiply carrier calls by their count; no Redis). The numbers are internal (`apps/api/src/shipping/store/shipping-store-limits.ts`):

| Cache | Key | Fresh | Bound |
|---|---|---|---|
| City searches | provider, locale, normalized query (trimmed, single spaces, lower case) | 24 h | 1 000 searches, 100 cities each |
| Point list of a city | provider, city ref (both kinds fetched once, filtered here) | 12 h | 200 cities, 5 000 points each (a longer list is cut and logged as a warning with the count) |
| Points by ref (checkout, options) | provider, point ref (`findPickupPoint`; unknown refs are not kept) | 12 h | 2 000 |
| Estimates | provider, method, city, point, subtotal band | 10 min | 2 000; never stale |

- **Stale-if-error**: when the carrier fails, an expired entry is served for up to **72 h past its expiry** (ADR 0029 open question 3, decided here as the ADR reads it), marked `stale: true` in a lookup answer; after that it is dropped and the answer is `503 shipping_provider_unavailable` with `Retry-After: 30`. A successful refresh replaces a stale entry.
- **Coalescing**: one in-flight provider call per cache key; concurrent misses share it and its outcome.
- **Concurrency cap**: at most 4 provider calls in flight per provider and process, 32 more may wait in order; beyond that, or when a waiting call runs out of its time limit, the call fails as the provider being unavailable.
- **Time limits** (core `SHIPPING_PROVIDER_TIMEOUTS_MS`): 5 s for lookups and estimates, counted from the request (waiting at the gate included). A provider that ignores the abort signal is not waited for.
- **What a provider answers** is checked against the port: refs by `CARRIER_REFERENCE_PATTERN`, the point's country by `COUNTRY_CODE_PATTERN`, kinds, and texts (1 to 200 characters, so a point always makes a valid address); an entry that breaks the port is dropped and the count logged.
- **Logs** carry the provider code, the operation, the kind of failure (`timeout`, `busy`, `error`, a refusal reason and carrier codes) and the duration; never a provider's message, a request value, a name, a phone or a key.

The port gained two members in plan step 6 (internal, not a public contract yet): `findPickupPoint({ref})` (the checkout names a point, not a city, so a point that is not cached must be found by its ref) and `PickupPoint.countryCode` (the carrier's country of ADR 0029 decision 4).
