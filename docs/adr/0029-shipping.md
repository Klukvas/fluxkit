# 0029. Shipping

Status: accepted 2026-10-24 (owner's quiz answers on `docs/plans/2026-10-24-shipping.md`, step 1). The red-zone items named in that plan's "Needs approval" section (the shipping adjustment in the order total and the checkout `shipping` member, migration 0006, the new store and admin routes and problem codes, the tightened checkout validation once a method exists, the `shipment.*` events, the configuration variables, the `shipping.manage` permission, the provider loader and its CI matrix, zod as a dependency of the new provider package) are approved by those answers, except what needs the owner's own action: the Nova Poshta verification spike (plan step 7a) waits for the owner's API key and sender data. Builds on ADR 0004 (separate fulfilment entity, pricing pipeline with shipping as a step, money in minor units), 0009 (permissions in code), 0011, 0015 (checkout transaction and lock order), 0017 (one explicit order status), 0018 (events and ports), 0019 (immutability triggers), 0021 and 0025 (bounded jobs, `DiscoveryService` discovery), 0023 and 0024 (unchanged), 0026 and 0027 (one origin, typed client), 0028 (port in core, driver in a package). Refines one sentence of ADR 0018 (see decision 1); supersedes nothing.

Nothing described under Decision is built yet. Each item is a requirement for the implementation steps 2 to 13 of the plan. Every Nova Poshta API detail in this ADR is from memory and NOT verified (decision 11).

## Context

- **Shipping does not exist.** There are no methods, rates, carrier code, shipment rows or provider packages; `packages/providers/` holds a README only (`pnpm-workspace.yaml` already includes `packages/providers/*`). The feature loader (`apps/api/src/features/feature-loader.ts`) discovers `packages/features` manifests only.
- **Totals are ready for an adjustment.** Core `computeOrderTotals` (`packages/core/src/orders/totals.ts`) adds adjustments not included in the price, requires kind `shipping` to be `>= 0`, sums `shippingTotal` and refuses currency mismatch, `adjustments_out_of_range`, `total_out_of_range` and `negative_total`. The checkout calls it with an empty adjustment list. `sales_order.shipping_total` and the append-only `order_adjustment` table (ADR 0019) exist; nothing writes an adjustment.
- **Checkout** (`apps/api/src/orders/checkout.service.ts`, ADR 0015, 0024): one transaction, lock order customer -> cart -> guest-email advisory lock -> products -> variants -> inventory levels -> inserts; `expectedTotal` mismatch answers `409 cart_changed` and reserves nothing; `400 shipping_address_required` when the cart `requiresShipping` (from `product_type.requires_shipping`). The idempotency fingerprint is version 1 (`checkout-fingerprint.ts`). The storefront sends `expectedTotal = cart.total`, which is wrong once shipping is charged.
- **Address** (core `validateAddress`): strict, free text; a carrier branch goes into `line1` today. The storefront allows `["UA"]` from a hardcoded config.
- **Orders** (ADR 0017): `paid -> fulfilled` by `admin` or `system` with stock effect `commit`; `fulfilled` is terminal; `OrdersService.markFulfilled` exists but no port exposes it. ADR 0018 promised such a port "added by the shipping plan". Cash on delivery needs `fulfilled` before `paid`, which one status cannot express.
- **Permissions** are fixed in code (ADR 0009); none covers shipping. Rate limits are named in-memory windows per process.
- **Catalog** has no weight or dimension column; the seed's `weight` attribute has a free-text unit.
- **Configuration**: `loadEnv` parses every API variable; `ORDER_TOKEN_SECRET` is the precedent for a secret.
- **Dependency rules**: `.dependency-cruiser.cjs` forbids core importing features and infrastructure; nothing forbids core importing `packages/providers`.
- **Nova Poshta** (the first carrier, Ukraine) has, as far as we remember, a JSON-RPC style API with the key in the request body, no sandbox, no webhooks and no idempotency key for waybill creation (decision 11).

## Decision

### 1. Scope and non-goals
- In scope (owner answer 1): core shipping methods with admin-managed rates (flat, free over a subtotal threshold, subtotal tiers), method kinds `address`, `pickup_point` and `store_pickup` (self-collection, no address), a country allow-list per method, the shipping adjustment in the order total, the order shipping snapshot, a store options endpoint, carrier lookups through our API, a `ShippingProviderPort` with a provider loader, a fake provider for tests, the Nova Poshta plugin (city and branch/parcel-locker lookup, an informational price estimate, waybill creation and cancellation, the printable label through our API, tracking by polling), shipment records with a status journal and events, admin settings screens and a shipment panel.
- Not in scope (each needs its own plan): cash on delivery and Nova Poshta "payment control" (the payment plan designs it with the payment/fulfilment status split); charging a live carrier quote; weight- or volume-based rates and catalog weight/dimensions; several shipments or parcels per order; returns and return waybills; insurance beyond the declared value; international shipping and customs data; EU and US carrier plugins; customer address books; courier pickup scheduling; maps or geolocation; carrier webhooks; multi-location stock allocation; discounts that change the free-shipping threshold; a zone table.
- Non-goals: any change to the order status machine; any provider key, provider URL or provider call in the browser; provider secrets in the database.
- **Refinement of ADR 0018:** the shipping adjustment is computed by core rules inside the checkout from admin data, not added by a carrier plugin. Plugins never influence an order total (owner answer 2).

### 2. Boundaries (core, not a feature)
- **Core, no flag** (orchestrator, recommended option of plan question 12): methods, rates, the snapshot and shipments are core, because shipping providers are core abstractions (AGENTS.md section 1) and totals cannot depend on an optional module before the pricing-pipeline adjuster contract exists. A shop with no active method behaves exactly as today; that is the "off" state of the core part. No `SHIPPING_ENABLED` variable.
- `packages/core/src/shipping/` holds pure rules only, written TDD: `decideShippingPrice`, the pricing JSON validation, method availability for a cart (active, country, currency), shipping selection validation, the shipping adjustment builder, the normalized shipment statuses and their allowed transitions (data, like `ORDER_TRANSITIONS`), code patterns and limit constants. No I/O.
- `packages/core/src/shipping/provider-port.ts` holds `ShippingProviderPort` (types and constants only), the metadata key `fluxkit:shipping-provider` and the typed provider result (decision 9).
- `packages/core/src/orders/` gets the `OrderFulfilmentPort` type (decision 10).
- `apps/api/src/shipping/` (a core module) holds the repositories, the options service, the checkout integration, the provider loader and registry, the lookup proxy with its cache, the shipment service and the tracking job.
- Carrier plugins live in `packages/providers/<code>` (first `nova-poshta`). A fake provider for tests lives in `packages/providers/_fake` or `apps/api/src/test/` (decided in plan step 4).
- A new dependency-cruiser rule forbids `packages/core` importing `packages/providers` (owner answer 13). Core and `apps/api` never import a provider statically.

### 3. Rate rules (money, TDD)
- `shipping_method.pricing` is JSONB validated by core, one of:
  - `{type: "flat", amount}`;
  - `{type: "free_over", amount, freeFrom}`: `0` when the subtotal is `>= freeFrom` (compared with `compareMoney`), else `amount`;
  - `{type: "tiers", tiers: [{fromSubtotal, amount}]}`: the tier with the highest `fromSubtotal <= subtotal`; unsorted or duplicate `fromSubtotal` values are refused at write;
  - `{type: "carrier_on_delivery"}`: the shop charges `0` and the recipient pays the carrier; the storefront shows the carrier's estimate (owner answer 2).
- Every amount is an integer in minor units, `0..MAX_AMOUNT`, in the method's `currency`. Amounts are entered in minor units (the admin converts decimals with the existing parser), so `decideShippingPrice` never rounds.
- A method whose currency is not `SHOP_CURRENCY` is not offered.
- **Threshold basis** (orchestrator, recommended option of plan question 16): the subtotal of all available cart lines, digital lines included, before any future discount. The pricing pipeline plan revisits it.
- **Tax** (recommended option of plan question 17): no tax is computed; a shipping amount means what a product price means under `PRICES_INCLUDE_TAX`. The shipping adjustment has `includedInPrice: false`. The tax plan later gives methods a tax class.
- **The order price never depends on the carrier** (owner answers 2 and 7): the carrier's price is an estimate only, never charged.

### 4. Checkout (red zone: order total, checkout contract)
- `POST /store/checkout` gains an optional strict member `shipping: {methodCode, pickupPointRef?}`.
- Cart `requiresShipping = false`: `shipping` present answers `400 shipping_not_applicable`. No adjustment, no snapshot (today's behaviour).
- Cart `requiresShipping = true` and at least one active method exists: `shipping` absent answers `400 shipping_method_required`. A shop with no active method keeps today's behaviour (address only, shipping 0). This tightens validation once a method exists (breaking by `docs/contracts/api.md`; pre-1.0, recorded in `CHANGELOG.md`).
- `methodCode` must name an active method whose country list contains `shippingAddress.countryCode` (kind `address`) or the carrier's country (kind `pickup_point`; `UA` for Nova Poshta), in `SHOP_CURRENCY`; otherwise `409 shipping_changed`.
- `pickup_point`: `pickupPointRef` is required and is resolved through the provider registry and the directory cache. The checkout transaction never calls the network: the point is read from the cache, or fetched BEFORE the transaction opens, outside every lock, with a 5 s timeout. Unknown point: `400 validation_failed` at `shipping.pickupPointRef` with reason `unknown_pickup_point`. Provider unreachable and the point not cached: `503 shipping_provider_unavailable` with `Retry-After`; only that method fails (owner answer 7).
- `store_pickup`: `shippingAddress` is optional; the contact is the recipient.
- **Price.** Inside the transaction, after the cart is priced: `decideShippingPrice(method.pricing, {subtotal, currency})`, then `computeOrderTotals(lines, [shippingAdjustment])`. Its refusals (`adjustments_out_of_range`, `total_out_of_range`) answer `409 rule_violation` with that rule.
- **Consent.** `expectedTotal` must equal subtotal + shipping. Order of answers: `409 cart_changed` (the cart's lines changed, as today) first, then the new `409 shipping_changed` with a member `shipping` (the method's fresh option as the options endpoint returns it, or `available: false`) when only the shipping price or the method's availability changed. Nothing is reserved in either case.
- **Write.** In the same transaction, after the existing inserts (no lock is added before the inventory locks): the order, the `order_shipping` row, one shipping `order_adjustment` row `{kind: "shipping", code: <method code>, label: <title map>, amount, includedInPrice: false, source: <provider code or null>}`, the lines, reservations, journal and `order.placed`. A free or `carrier_on_delivery` method writes the row with amount `0`. `sales_order.shipping_total` = core `shippingTotal`. For a `pickup_point` order the API also writes a readable `sales_order.shipping_address` (`countryCode`, `city` = city name, `line1` = the branch description), so existing views keep working.
- **Idempotency fingerprint v2.** The normalized `shipping` member joins the fingerprint and `FINGERPRINT_VERSION` becomes `2`. A replay sent across the deploy for an order placed under version 1 answers `idempotency_key_reused` (accepted). A replay never recomputes the price and never calls a provider: the replay check stays first in the transaction, and the pre-transaction pickup-point fetch is skipped when the key already exists (read without a lock first).
- Guest token, open-order limit, expiry and the lock order are unchanged (ADR 0015, 0023, 0024).
- **Payments:** the total `markPaid` compares now includes shipping; nothing else changes.

### 5. Store endpoints
- `GET /store/shipping/options?country=&locale=` for the caller's cart (cookie or session): `{options: [{methodCode, kind, title, description, providerCode, price, payer, estimate, total, available, reason?}]}`. `total` = cart subtotal + price, computed by the server; the storefront sends it back as `expectedTotal`, so the browser never adds money. `estimate` is the informational carrier price, filled only when the request names a city or point (`cityRef`, `pickupPointRef`), from the cache or a provider call with a 5 s timeout; any provider failure makes it `null`, never an error of the whole answer. `no-store`, rate limit `shippingOptions` per address, no cart is created, empty cart answers `options: []`. Estimates are cached 10 minutes per (method, city, point, subtotal band); a price used in a total is never cached.
- `GET /store/shipping/providers/{code}/cities?q=&locale=` (`q` 2 to 50 characters) and `GET /store/shipping/providers/{code}/pickup-points?cityRef=&q=&kinds=branch,locker`: public, rate limit `shippingLookup` per address (proposal 60 per minute), `Cache-Control: public, max-age=300` (carrier data, not personal), at most 50 cities and 200 points per page (`limit`/`offset`).
- The storefront's hardcoded `allowedShippingCountries` is replaced by the countries of the active methods.
- Store order views (guest and account) gain the additive `shipping` snapshot and, when a shipment exists, the tracking number and normalized status.

### 6. Directory cache and carrier outages (owner answer 7)
- In-process cache per API instance, no schema, no Redis (orchestrator, recommended option of plan question 8): city searches by normalized query (TTL 24 h); the full point list of a city fetched once and filtered locally (TTL 12 h); bounded by entry count (LRU; sizes fixed in plan step 6 after measuring list sizes).
- Stale-if-error: when the provider fails, an expired entry is served for up to **72 h** (how the window is counted is open question 3); the answer is marked `stale: true`.
- One in-flight fetch per cache key (request coalescing) and at most 4 provider calls in flight per process.
- When the carrier is down: lookups serve the cache (stale up to 72 h); a point that cannot be resolved blocks only that method (`503 shipping_provider_unavailable`); other methods keep working; the order price never depends on the carrier. Estimates become `null`. Admin shipment actions answer with the typed reason (decision 9) and change nothing.

### 7. Data (red zone: migration `0006_shipping`)
One migration `0006_shipping.sql` with a hand-written `0006_shipping.down.sql` that also deletes its `drizzle.__drizzle_migrations` row; tested up, down, up, down, plus `db:drift`. Exact column types and CHECK texts are fixed in plan step 3 within these rules.

**`shipping_method`** (admin-managed)

| Column | Rule |
|---|---|
| `id` | uuid PK |
| `code` | text UNIQUE, `CODE_PATTERN`; never renamed |
| `title`, `description` | i18n JSONB maps, default locale required on write |
| `kind` | `address`, `pickup_point`, `store_pickup` (CHECK) |
| `provider_code` | NULL for a method without a carrier plugin, else a provider code |
| `provider_service` | NULL or a provider service code (Nova Poshta, unverified: `warehouse`, `postomat`, `doors`), validated by the plugin |
| `pricing` | JSONB validated by core (decision 3) |
| `currency` | the currency of every amount in `pricing` |
| `country_codes` | text[] of ISO alpha-2, non-empty (CHECK per element); no zone table (recommended option of plan question 15) |
| `is_active`, `position`, `created_at`, `updated_at` | |

A method used by an order can be deactivated, not deleted (`409 rule_violation` `method_in_use`).

**`shipping_provider_setting`** (non-secret provider settings, one row per provider): `provider_code` PK, `settings` JSONB validated by the plugin (for Nova Poshta: sender counterparty, contact person, phone, city and branch refs, default parcel weight and size, default cargo description; field list unverified), `updated_at`, `updated_by` -> `admin_user` ON DELETE SET NULL. Secrets never go here.

**`order_shipping`** (immutable snapshot, 1:1 with the order; trigger in the ADR 0019 style: no UPDATE, DELETE only by the cascade from `sales_order`)

| Column | Rule |
|---|---|
| `order_id` | PK -> `sales_order` ON DELETE CASCADE |
| `method_id` | -> `shipping_method` ON DELETE SET NULL (the snapshot stays; same exception technique as `order_item.variant_id`) |
| `method_code`, `kind`, `provider_code`, `provider_service` | copied |
| `title` | i18n map copied whole (every locale, ADR 0025) |
| `amount`, `currency` | what the shop charged; equals the shipping adjustment |
| `payer` | `shop_charge` or `recipient_on_delivery` |
| `estimated_carrier_amount` | NULL or the informational estimate shown at checkout (minor units, same currency) |
| `destination` | JSONB for `pickup_point`: `{providerRef, number, kind, cityRef, cityName, description}` (public carrier data, no personal data); NULL for `address` and `store_pickup` |

**`shipment`**

| Column | Rule |
|---|---|
| `id` | uuid PK |
| `order_id` | -> `sales_order` ON DELETE RESTRICT |
| `provider_code`, `provider_service` | |
| `status` | `pending`, `unknown`, `created`, `in_transit`, `arrived`, `delivered`, `returning`, `returned`, `cancelled`, `failed` (CHECK); transitions are core data |
| `carrier_status_code`, `carrier_status_at` | the raw carrier code (short pattern) and its time; never the carrier's text |
| `tracking_number` | the waybill number; unique per provider |
| `provider_ref` | the carrier's internal id |
| `client_reference` | our order number sent to the carrier (reconciliation) |
| `declared_value_amount`, `currency`, `carrier_cost_amount` | minor units; the carrier cost is informational |
| `payer` | `sender` or `recipient` |
| `weight_grams`, `length_mm`, `width_mm`, `height_mm`, `seats` | entered at creation; `seats = 1` in v1 |
| `created_by`, `created_at`, `cancelled_at`, `delivered_at`, `next_track_at`, `tracking_attempts` | index on `next_track_at` where the status is not terminal |

- **Shipments per order** (owner answer 9): one active shipment with one parcel. Partial unique index on `order_id` where the status is not `cancelled` or `failed`. Cancel and create again is allowed.
- **`shipment_status_change`**: append-only journal (`from`, `to`, carrier code, actor `admin|system`, admin id ON DELETE SET NULL, `clock_timestamp()`), trigger as `order_status_change`.
- **Weight and dimensions** (owner answer 5): not in the catalog in v1; the admin enters them when creating a waybill, prefilled from the provider settings' defaults. When weight-based rates come, nullable variant columns (`shipping_weight_grams`, dimensions in mm) are the proposed home, with their own approval.
- **Not stored:** API keys, carrier response bodies, carrier error texts, recipient names or phones in shipment rows (they live on the order), directory lookup results (cache only).
- `order_adjustment` gets its first rows (decision 4); no schema change to it.

### 8. Provider loader and configuration (owner answers 6 and 13)
- A provider package declares `"fluxkit": {"provider": "<code>", "kind": "shipping"}` in `package.json` and exports `providerModule` (a Nest module). The API imports only the providers named in `SHIPPING_PROVIDERS_ENABLED` (comma-separated; unset = none). An enabled but missing or broken provider fails startup; a disabled or deleted one has no effect.
- Inside the module, a class carries the metadata `fluxkit:shipping-provider` and implements `ShippingProviderPort`; the API finds it with `DiscoveryService` (ADR 0021). A marked class without the methods, or a duplicate code, stops startup.
- CI gets a provider matrix like the feature matrix (fake provider on, off, deleted).
- **Secrets in the environment only** (owner answer 6): `NOVA_POSHTA_API_KEY` (and any later provider variable), parsed at start with length and character checks, never logged, never returned (the admin sees "configured"), never stored in the database, never sent to the browser. Error messages name the variable, never the value. Each plugin exports a small parser of its own variables; the names are listed in `docs/contracts/config.md` and `.env.example`. Rotating a key needs a restart.

### 9. `ShippingProviderPort`
Internal until the first external plugin; then listed in `docs/contracts/`. Proposed shape (exact types fixed in plan step 2):

```ts
interface ShippingProviderPort {
  readonly code: string;                       // matches CODE_PATTERN, e.g. "nova_poshta"
  readonly capabilities: ShippingCapabilities; // {pickupPoints, estimate, waybills, cancelWaybill, tracking, labels}
  searchCities(input: {query: string; locale: string; limit: number}, signal: AbortSignal): Promise<CityResult[]>;
  listPickupPoints(input: {cityRef: string; kinds: PickupPointKind[]}, signal: AbortSignal): Promise<PickupPoint[]>;
  estimate(input: EstimateRequest, signal: AbortSignal): Promise<ProviderResult<Money>>;
  createWaybill(input: WaybillRequest, signal: AbortSignal): Promise<ProviderResult<WaybillCreated>>;
  cancelWaybill(input: {providerRef: string}, signal: AbortSignal): Promise<ProviderResult<void>>;
  track(input: {trackingNumbers: string[]; phones: string[]}, signal: AbortSignal): Promise<ProviderResult<TrackingUpdate[]>>;
  fetchLabel(input: {providerRef: string; format: "pdf"}, signal: AbortSignal): Promise<ProviderResult<{bytes: Uint8Array; contentType: "application/pdf"}>>;
  checkConnection(signal: AbortSignal): Promise<ProviderResult<void>>;
}
// ProviderResult<T> = {ok: true, value: T}
//   | {ok: false, reason: "unavailable" | "rejected" | "invalid_credentials" | "not_supported", providerCodes: string[]}
```

- Money crosses the port in minor units with a currency; a plugin converts carrier decimals with core `parseDecimalString`, and a value with more decimals than the currency allows is `rejected`, never rounded.
- Errors carry provider codes, never the carrier's message text (it can echo names, phones or the key).
- The API, not the plugin, decides timeouts (it passes the `AbortSignal`: 5 s for lookups and estimates, 15 s for waybill calls), logging and caching.
- A reusable contract test suite runs against every provider package; the fake provider passes it.

### 10. Shipments, fulfilment and tracking
- **Who and when:** an admin with `orders.write` creates a shipment for a `paid` order with no line awaiting stock (the `mark-fulfilled` rule, read without committing anything; recommended option of plan question 19). Creating a waybill does not change the order status. Cancelling a shipment never touches the order or the stock.
- **Lost answers:** the shipment row is written as `pending` before the carrier call; a timeout makes it `unknown`; `reconcile` asks the carrier for the waybill by our `client_reference` instead of a blind retry (ADR 0027: the admin never retries a write).
- **Routes** (`orders.write`; the label `GET` `orders.read`): `POST /admin/orders/{id}/shipments`, `POST .../shipments/{shipmentId}/cancel`, `POST .../refresh`, `POST .../reconcile`, `GET .../label` (a PDF streamed by our API from the plugin; a carrier label URL never reaches a browser). Admin order views and `OrderReadPort` gain the additive `shipping` snapshot and `shipments[]`.
- **Tracking** (recommended option of plan question 10): scheduler job 8 `track-shipments`, bounded like ADR 0025: non-terminal shipments with `next_track_at <= now`, pages of 100, at most 5 pages per run, the provider call OUTSIDE any transaction, then one short transaction per shipment (status, journal row, `shipment.status_changed`, `next_track_at` by backoff: created 2 h, in transit 4 h, arrived 6 h; after 30 days without a terminal status it stops and logs). A failed call leaves the rows due for the next tick. The job runs after the time-critical jobs.
- **The order is still fulfilled by an admin by hand.** The tracking job never moves an order.
- **`OrderFulfilmentPort`** (token `fluxkit:order-fulfilment-port`, implemented by `OrdersService.markFulfilled(orderId, actor)`) is the port ADR 0018 promised. With the answer above no code in v1 calls it for automatic fulfilment; whether step 2 adds the type now is open question 1.
- **Returns** (recommended option of plan question 11): not in v1; a waybill can be cancelled while the carrier allows it.

### 11. Nova Poshta plugin (`packages/providers/nova-poshta`)
- **Every carrier detail is from memory and NOT verified** (no network access when the plan was written): the endpoint (`https://api.novaposhta.ua/v2.0/json/`, JSON-RPC style body `{apiKey, modelName, calledMethod, methodProperties}`, HTTP 200 with `success`, `errors` and codes), the method names (`Address.searchSettlements`, `Address.getWarehouses`, `InternetDocument.getDocumentPrice`, `InternetDocument.save`, `InternetDocument.delete`, `InternetDocument.getDocumentList`, `TrackingDocument.getStatusDocuments`), field names, service and cargo types, the status code table, page sizes, the 100-number tracking limit, rate limits, recipient name rules, postomat limits, the waybill number format, label URLs that embed the key, the absence of a sandbox, webhooks and an idempotency key for `save`, whether directory data may be stored, whether English descriptions exist, how keys expire. The list in plan section 8 is the working hypothesis.
- **Verification:** plan step 7a, a spike with the owner's real key and sender data (run or watched by the owner; real waybills are created and deleted at once), confirms or corrects every item and writes the findings into the plan before step 7b codes against them. Any finding may change the port (decision 9) and this ADR is then superseded in that part.
- **Implementation rules:** Node 22 `fetch` (no HTTP library, no new dependency); the base URL is a constant in the package, never configurable from the admin or a request (no SSRF); `redirect: "error"`; the API's `AbortSignal`; a response size cap before JSON parsing; every answer validated by a schema in the plugin (zod 4.6.7, the version the workspace already pins); money converted with core `parseDecimalString` in UAH only; no request or response body logged (the key travels in the body), only codes, durations and the method name. Client refs (pickup points, cities) are checked by pattern before they enter a carrier request. Fixtures are hand-written from the documented shapes with invented refs and placeholder names; a guard test fails on any real `fetch`.

### 12. Events
- New types `shipment.created`, `shipment.status_changed`, `shipment.cancelled` (recommended option of plan question 14); aggregate = the shipment id; payload `{shipmentId, orderId, orderNumber, status}` (ids and the normalized status only; never a tracking number, phone or name). Written in the same transaction as the change (ADR 0018), at-least-once. The type pattern CHECK of `domain_event.type` already admits them (no migration for the names).

### 13. Admin and permissions (owner answer 18)
- New permission `shipping.manage`, granted to owner and manager, for the settings routes: `GET/POST /admin/shipping/methods`, `GET/PATCH/DELETE /admin/shipping/methods/{id}`, `GET/PUT /admin/shipping/providers/{code}/settings`, `POST /admin/shipping/providers/{code}/check` (calls `checkConnection`; the answer says ok or a typed reason, never the key).
- Shipments reuse `orders.read` and `orders.write` (decision 10).
- Settings changes record `updated_by` only (no audit log exists); the shipment journal records the acting admin.

### 14. Security and privacy
- The client never sends a shipping price; prices come only from core rules and admin data; the total check stays in core.
- Recipient name and phone go to the carrier (required to deliver; the privacy plan lists the carrier as a data processor). Shipment rows, events and logs carry no names or phones; carrier error texts are never logged or stored.
- Rate limits `shippingOptions` and `shippingLookup` per address (in-memory, single process). The lookup proxy turns anonymous requests into calls under the shop's carrier key; the minimum query length, the limits, coalescing, the concurrency cap and the cache bound it.
- The storefront CSP (`connect-src 'self'`) already keeps carrier calls out of the browser.

## Consequences

- **Cost.** Five new tables and two triggers; the first writer of `order_adjustment` in the most sensitive code path (mitigated by TDD, the consent check, concurrency specs and the independent review); a new loader and a CI matrix job; outbound network calls from the API and the scheduler, bounded by timeouts and the job budget.
- **Release coupling.** A storefront still sending `expectedTotal = cart.total` gets `shipping_changed` on every shipped checkout once a method exists: plan steps 6, 9 and 10 ship together.
- **Risks.** The Nova Poshta details may differ from memory (the spike comes first). No carrier idempotency: a lost `save` answer can create an unknown waybill (`unknown` plus `reconcile` reduce it). The in-process cache and limits are per instance, so several instances multiply carrier calls. Replays across the fingerprint v2 deploy answer `idempotency_key_reused`. The free-shipping threshold ignores future discounts until the pricing pipeline decides. Without cash on delivery v1 may not satisfy the first Ukrainian clients. Unpaid orders still expire after `ORDER_PAYMENT_TTL_MINUTES` while a waybill needs a paid order.
- **Contracts.** New public items once built: the store options and lookup routes, the checkout `shipping` member and its tightened validation, problem codes `shipping_method_required`, `shipping_not_applicable`, `shipping_changed`, `shipping_provider_unavailable` and the reason `unknown_pickup_point`, the admin shipping and shipment routes, the additive order view fields (`OrderReadPort` included), the `shipment.*` events, the permission `shipping.manage`, `SHIPPING_PROVIDERS_ENABLED` and `NOVA_POSHTA_API_KEY`; later `ShippingProviderPort` and `OrderFulfilmentPort`. Pre-1.0, recorded in `CHANGELOG.md`.
- **What would supersede this ADR (in part):** cash on delivery and the payment/fulfilment status split (the payment plan); live carrier quotes charged in the total; weight-based rates with catalog weight columns; partial shipments or several parcels; a shared directory cache or a synced directory table; automatic fulfilment from tracking; spike findings that change the port or the Nova Poshta rules.

## Open questions (not decided by the plan or the owner's answers)

1. **`OrderFulfilmentPort` in v1.** The plan's step 2 lists the type, but plan section 1 says it is needed only if the system fulfils, and owner answer 10 keeps fulfilment manual. Add the type now (unused) or leave it to the plan that automates fulfilment? The orchestrator decides at step 2.
2. **Fake provider location** (`packages/providers/_fake` or `apps/api/src/test/`): decided in plan step 4.
3. **Stale window.** "Stale up to 72 h" is read here as: an entry may be served up to 72 h past its TTL expiry. It could also mean 72 h since it was fetched. Confirm at step 6.
4. **Cache sizes, the `shippingLookup` and `shippingOptions` limits and the estimate subtotal band** are proposals; fixed in plan step 6 after measuring.
5. **`store_pickup` details.** The answer says "a configurable text and no address"; the plan names no column for that text (the method's `description` map is the obvious candidate) and no country rule for a method without an address. Fixed in plan steps 3 and 6.
6. **Nova Poshta legal and terms** (storing directory data, the carrier as a data processor, using the API in a distributed template): not known; owner and legal.
