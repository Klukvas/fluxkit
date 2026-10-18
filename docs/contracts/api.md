# Contract: public HTTP API

Status: the catalog surface (`/admin/*`, `/store/*`) is public in the code but not released yet; no SemVer release has been made, so the contract can still change before the first one (recorded in `CHANGELOG.md`).
Source of truth: `docs/api/openapi.json` (generated, `pnpm openapi:export`). Readable map of every route and its errors: `docs/api/catalog.md`. Per-module notes: `docs/api/`.
Breaking changes follow AGENTS.md section 17: major version, migration guide in `docs/migrations/`, `CHANGELOG.md` entry; deprecate first when possible.

## What is contract

| Surface | Contract | Notes |
|---|---|---|
| `GET /health` | yes | liveness and database reachability (`docs/api/health.md`) |
| `GET /store/categories`, `GET /store/products`, `GET /store/products/{slug}` | yes | every response shape, every query parameter, the locale rules, the visibility rules (see `docs/api/catalog.md`, Store) |
| `GET /store/config` | yes (new in this release, additive) | `{currency, currencyExponent, pricesIncludeTax, defaultLocale, locales}` and nothing else (`docs/api/pricing.md`, Store) |
| Store prices and availability | yes (new in this release, additive fields; a visibility change, pre-1.0) | variant `price {amount, currency, compareAtAmount}` and `availability`, product and list-item `price {from, to, currency}` and `availability` (`in_stock`, `low_stock`, `out_of_stock`); amounts are JSON integers in minor units of the shop currency only. A variant without an active shop-currency price is never returned, and a product with no such variant is not listed and answers `404`. The product-level rule (best availability of the sellable variants) and the hiding rules are in `docs/api/pricing.md`, Store. Quantities, locations, stock flags and other currencies are never part of a `/store/*` response |
| `/admin/*` routes | yes, as of this release | every route, request and response shape, status code and problem code listed in `docs/api/catalog.md` (catalog) and `docs/api/auth.md` (sign-in and users) |
| Admin price endpoints | yes (new in this release, additive) | `GET`, `PUT`, `DELETE` on `/admin/products/{id}/variants/{variantId}/prices[/{currency}]` and the bulk `PUT /admin/products/{id}/prices`: the money shape (`amount` and `compareAtAmount` as JSON integers in minor units, upper-case ISO 4217 `currency`), the bulk limit of 500 items, the error codes and the `last_shop_price` rule (`docs/api/pricing.md`). The config variables `SHOP_CURRENCY`, `PRICES_INCLUDE_TAX` and `LOW_STOCK_THRESHOLD` are contract too (`docs/contracts/config.md`) |
| Publish and activation need a price | yes (behavior change, pre-1.0) | `POST /admin/products/{id}/publish` answers `400 validation_failed` with `price_missing` at `variants.N` for an active variant without a price in `SHOP_CURRENCY`; `PATCH .../variants/{variantId}` with `isActive: true` on an active product answers `409 rule_violation` `price_missing`. Before this release publishing did not look at prices. Clients that publish must price first; no migration guide because the contract is not released yet |
| Admin inventory endpoints and locations | yes (new in this release, additive) | `GET /admin/locations`; `GET /admin/products/{id}/variants/{variantId}/inventory`; `POST .../inventory/adjustments` (`kind` `receipt`, `adjustment`, `return`; exactly one of `delta` and `setOnHand`; 400 `validation_failed` with `invalid_quantity`, `on_hand_out_of_range`, `delta_or_set_on_hand`; 409 `rule_violation` with rule `negative_on_hand`, `below_reserved` (only for a change that lowers `onHand`), `no_change` or `kind_requires_increase`); `GET .../inventory/movements` (newest first, standard pagination). The response shapes and the journal fields (`kind`, `delta`, `onHandAfter`, `reason`, `reference`, `actorId`) are in `docs/api/inventory.md`. Quantities and locations are admin-only and never part of a `/store/*` response |
| Variant stock flags | yes (new in this release, additive) | `trackInventory` and `allowBackorder` (booleans) in the admin variant response, in `POST /admin/products/{id}/variants` and in `PATCH .../variants/{variantId}`. Variants of a product type with `requires_shipping = false` start untracked. Existing clients that ignore unknown response fields are not affected; the strict request schemas still reject unknown fields |
| Cart endpoints | yes (new in this release, additive) | `GET /store/cart`, `POST /store/cart/items`, `PATCH` and `DELETE /store/cart/items/{variantId}`, `DELETE /store/cart`, `POST /store/cart/acknowledge`: request and response shapes (lines, `unitPrice`, `lineTotal`, `compareAtAmount`, `availability`, `notices` `price_changed` / `unavailable` / `out_of_stock`, `subtotal`, `total`, `itemCount`, `purchasable`), the error codes (`validation_failed` with `invalid_quantity`, `not_found`, `rule_violation` with rules `variant_not_sellable`, `quantity_limit`, `too_many_lines`, `line_total_out_of_range`, `subtotal_out_of_range`) and the rules in "Cart (ADR 0015)" below. Shapes and errors: `docs/api/cart.md` |
| Scheduler and jobs | no HTTP surface | The scheduler has no route and `GET /health` does not report it (a heartbeat in health is a follow-up). The command `pnpm jobs:run-once` (exit codes `0`, `1`, `2`) and the environment variables `SCHEDULER_ENABLED` and `SCHEDULER_INTERVAL_SECONDS` are contract (`docs/api/jobs.md`, `docs/contracts/config.md`); the handler and port contract is `docs/contracts/events.md` |
| Admin authentication | yes | cookie session, CSRF header, roles and permissions, login and users endpoints: see "Admin authentication" below |
| Default deny for `/admin` | yes | A global guard (`AdminPathGuard`, `APP_GUARD`) protects EVERY route whose path starts with `/admin` (matched case-insensitively, trailing slash included), whether or not its controller uses `@AdminController`. This covers routes added by feature modules: a feature may declare a plain `@Controller("admin/<name>")`; it is `401` without a session and `403` for a signed-in admin (no permission is declared), never open. An oversized JSON body (over 100 KB) is rejected with `413` before any guard runs, also on `/admin/*`; malformed JSON answers `400`; both are `application/problem+json` and not logged as errors |
| Error model | yes | `application/problem+json` with the `code` values and status mapping in `docs/api/catalog.md` (Conventions). New codes are additive (minor); removing or renaming one is breaking |
| Pagination | yes | `?limit` and `?offset` bounds and the `{items, total, limit, offset}` shape |
| Locale handling | yes | `?locale=` against the configured `LOCALES`; missing means `DEFAULT_LOCALE`; per-field fallback |

Adding an optional request field, a response field, a route, or a new problem `code` is a minor change. Removing or renaming any of them, changing a type, or tightening a validation rule is breaking.

## Admin authentication (ADR 0009, `docs/api/auth.md`)

Contract:

| Item | Rule |
|---|---|
| Session | `POST /admin/auth/login` answers `200` and sets a session cookie; every other `/admin` request is authenticated by that cookie alone (an `Authorization` header, API key or query parameter is ignored). `POST /admin/auth/logout` ends the session. Idle and absolute lifetimes come from `ADMIN_SESSION_IDLE_MINUTES` and `ADMIN_SESSION_MAX_HOURS` (`docs/contracts/config.md`). The cookie is `HttpOnly`, `SameSite=Strict`, `Path=/admin`, and `Secure` unless `ADMIN_COOKIE_SECURE=false` |
| CSRF header | Every `POST`, `PUT`, `PATCH` and `DELETE` under `/admin`, login included and also for anonymous callers, must send `X-Fluxkit-CSRF: 1` and, when it has a body, `Content-Type: application/json`; otherwise `403 forbidden`. `GET`, `HEAD` and `OPTIONS` are exempt. The API sends no CORS headers |
| Roles | `owner`, `manager`, `viewer`; fixed in code (a new role is a code change, not data). The names are contract |
| Permissions | `catalog.read`, `catalog.write`, `catalog.publish`, `users.manage`, `orders.read`, `orders.write`, `customers.read`, `customers.write`. The names are contract. `customers.read` and `customers.write` are required by the `/admin/customers` routes, `orders.read` and `orders.write` by the `/admin/orders` routes (ADR 0017, plan `docs/plans/2026-10-17-cart-and-orders.md`) |
| Login response | `200 {"user": {id, email, role, isActive, lastLoginAt}}` plus the cookie. Every failure (unknown email, wrong password, locked account, inactive user) answers the same `401 unauthorized` with no cookie; status, headers and body do not say which. Response times are similar (one scrypt each) but not guaranteed equal: a wrong password also writes the failure count, so a small difference can exist. `GET /admin/auth/me` answers `{user, permissions}` |
| Caching | Every response under `/admin` (matched like the guard: case-insensitive, trailing slash included), errors included, carries `Cache-Control: no-store`. `/store/*` catalog routes and `/health` are not affected; the account, cart, checkout and order routes are `no-store` too (`docs/api/customers.md`, `cart.md`, `orders.md`) |
| Customer endpoints | `GET /admin/customers`, `GET` and `PATCH /admin/customers/{id}`, `POST /admin/customers/{id}/unlock`; `GET` needs `customers.read`, the others `customers.write`; no create, delete or password route. Shapes and errors: `docs/api/customers.md` |
| Order endpoints | `GET /admin/orders`, `GET /admin/orders/{id}`, `POST /admin/orders/{id}/cancel`, `/mark-paid` and `/mark-fulfilled`; `GET` needs `orders.read`, every `POST` `orders.write`; the viewer has neither. Cancel needs a reason; a paid order can be cancelled by an admin only and is not restocked or refunded by the system. Shapes and errors: `docs/api/orders.md` |
| Users endpoints | `GET` and `POST /admin/users`, `GET` and `PATCH /admin/users/{id}`, `POST /admin/users/{id}/reset-password`, owner only; no delete; the last active owner cannot be demoted or deactivated. Shapes and errors: `docs/api/auth.md` |

| Role | `catalog.read` | `catalog.write` | `catalog.publish` | `users.manage` | `orders.read` | `orders.write` | `customers.read` | `customers.write` |
|---|---|---|---|---|---|---|---|---|
| `owner` | yes | yes | yes | yes | yes | yes | yes | yes |
| `manager` | yes | yes | yes | no | yes | yes | yes | yes |
| `viewer` | yes | no | no | no | no | no | no | no |

Route to permission: `GET` and `HEAD` need `catalog.read`; every other method needs `catalog.write`; `publish`, `unpublish`, `archive` and `restore` of a product need `catalog.publish`; the users routes need `users.manage`; the customers routes need `customers.read` (`GET`) or `customers.write` (every other method); the orders routes need `orders.read` (`GET`) or `orders.write` (every `POST`). A route without its own declaration gets the default pair of its controller: `@AdminController(resource)` means the catalog pair, `@AdminController(resource, {read, write})` names another (the pair is internal, the resulting permission per route is contract). `logout`, `me` and `change-password` need only a session. A route that declares no permission is denied.

Problem codes added by auth:

| Code | Status | Meaning |
|---|---|---|
| `unauthorized` | 401 | no valid session (missing, malformed, unknown or expired cookie, deactivated user) or a failed login |
| `forbidden` | 403 | signed in but the role lacks the route's permission, or the CSRF rule above was broken |
| `too_many_requests` | 429 | too many login attempts from one client address; `Retry-After` carries the seconds to wait |

Not contract (internal, may change in a minor release): the scrypt parameters and the hash format, the session token format and how sessions are stored, the cookie name `fluxkit_admin_session`, the lockout numbers (5 failures, 15 minutes) and the IP limit numbers (20 attempts per 10 minutes; IPv6 counted per /64), the exact `detail` texts. Clients keep the cookie jar of their HTTP client and do not read the cookie value.

## Customer authentication and the store (ADR 0016, `docs/api/customers.md`)

Plan steps 3a and 3b. Endpoints: `POST /store/account/register`, `POST /store/account/login`, `POST /store/account/logout`, `GET` and `PATCH /store/account/me`, `POST /store/account/change-password` (shapes, errors and rules in `docs/api/customers.md`). Register and login are the only public routes under `/store/account`. The rows below are the rules every customer route follows.

| Item | Rule |
|---|---|
| Store CSRF header | Every `POST`, `PUT`, `PATCH` and `DELETE` under `/store` (matched like Express: case-insensitive, trailing slash included), signed in or not, must send `X-Fluxkit-CSRF: 1` and, when it has a body, `Content-Type: application/json`; otherwise `403 forbidden`, before authentication. `GET`, `HEAD` and `OPTIONS` are exempt. The API sends no CORS headers. New in this release (the store was GET-only, so no existing request changes) |
| Customer cookie | `fluxkit_customer_session`: `HttpOnly`, `SameSite=Lax`, `Path=/store`, `Secure` unless `STORE_COOKIE_SECURE=false`; idle and absolute lifetimes from `CUSTOMER_SESSION_IDLE_MINUTES` and `CUSTOMER_SESSION_MAX_HOURS` (`docs/contracts/config.md`). A separate principal from the admin: an admin cookie never authenticates a customer route and a customer cookie never authenticates an `/admin` route (`401`); only the cookie is read |
| Public by default | A `/store` route is public unless it is marked customer-authenticated; a customer-authenticated route answers `401 unauthorized` (identical for every cause) and carries `Cache-Control: no-store` |
| Rate limit | A limited store route answers `429 too_many_requests` with `Retry-After`; register and login are limited |
| Account responses | `{customer: {id, email, firstName, lastName, phone, createdAt}}` (register and login add `cartNotices`, see Cart) and nothing else: never the hash, lockout state or flags. Every response under `/store/account` is `Cache-Control: no-store` |
| Sign-in failures | Unknown email, wrong password, locked and inactive account answer the identical `401` (status, headers, body) with no cookie. Registration with a taken email is `409 conflict` on `email` (accepted trade-off, ADR 0016) |

Not contract (internal): the cookie name, the token format and how sessions are stored, the rate-limit numbers.

## Cart (ADR 0015, `docs/api/cart.md`)

Plan step 4. The rules every cart route follows:

| Item | Rule |
|---|---|
| Who owns a cart | Only the customer session cookie (a signed-in customer has one cart) or the guest cookie `fluxkit_cart`. No cart id, token or customer id in a path, query, body or header selects a cart; the API has no route that takes one |
| Guest cookie | `fluxkit_cart`: `HttpOnly`, `SameSite=Lax`, `Path=/store`, `Secure` unless `STORE_COOKIE_SECURE=false`, `Max-Age` = `CART_TTL_DAYS` (`docs/contracts/config.md`), set again by every write. The name and the attributes are contract (a storefront proxy forwards it); the token format is not |
| Creation | Lazy: a read never creates a cart or a cookie; the first successful `POST /store/cart/items` does. A cookie that matches no cart is no cart; a write replaces it with a new token |
| Prices | Never client input. Every response shows the CURRENT catalog price, availability and notices; a cart holds no stock |
| Money | `{amount, currency}` in minor units of the shop currency; overflow of a line total or subtotal is `409 rule_violation` (`line_total_out_of_range`, `subtotal_out_of_range`), never a clamp |
| Limits | 1 to 999 per line (never capped silently on a request), 100 lines per cart, one line per variant. The numbers are internal and may change in a minor release; the codes are contract |
| Sign-in | `POST /store/account/register` and `login` merge the guest cart and answer `{customer, cartNotices}`; `cartNotices` is an array of `{code}` with `quantity_capped` or `lines_dropped`, `[]` when there is nothing to report (additive change of those two responses) |
| Caching | Every `/store/cart` response, errors included, is `Cache-Control: no-store`; writes need the store CSRF header and are rate limited (`429`) |

Not contract (internal): the cart-level `notices` array of the cart shape is always empty today (reserved), the order of lines within the cart is insertion order, the rate-limit numbers, the sliding expiry mechanism beyond `CART_TTL_DAYS`.

Known limits:

- The IP login limit is in memory, per API process: it resets on restart and is not shared between instances. The account lockout is in the database and does span instances.
- `request.ip` is the socket address unless Express `trust proxy` is configured, which the API does not do yet. Behind a reverse proxy all clients then share one IP window.
- No password reset by email, no two-factor authentication, no audit log of sign-ins (follow-ups in `docs/plans/2026-10-16-auth-and-roles.md`). Customer accounts are built in the cart and orders plan (`docs/api/customers.md`); the guest-cart merge at sign-in is described in the Cart section.

## Checkout and orders (ADR 0015, 0017, `docs/api/orders.md`)

Plan step 5b. The rules every order route follows:

| Item | Rule |
|---|---|
| Checkout | `POST /store/checkout` with the header `Idempotency-Key` (a UUID) and the body of `docs/api/orders.md`. The body has no field for a cart, a customer, a price or a total: `expectedTotal` is a consent check and never a price. `201 {order, accessToken?}`, `200` for a replay of the same checkout |
| Idempotency | The same key with the same normalized request, from whoever can still reach the same cart, returns the same order (`200`); a guest gets the SAME `accessToken` again (derived from the order and the key, ADR 0023; nothing rotates). Any other use of a key is `409 idempotency_key_reused`, always the same answer |
| Guest access | `accessToken` (43 characters, base64url) is returned by the checkout answer (`201`, and the same value in a replay's `200`). It opens one order through `POST /store/orders/lookup` and `POST /store/orders/cancel` (a POST, so it is never in a URL); the storefront keeps it in the URL fragment. Every failed lookup or cancel is the same `404` |
| Customer orders | `GET /store/account/orders`, `GET /store/account/orders/{number}`, `POST /store/account/orders/{number}/cancel`: customer session only; another customer's number is the same `404` as an unknown one |
| Order shape | `{number, status, placedAt, expiresAt, currency, items, subtotal, shippingTotal, discountTotal, taxTotal, total, adjustments, contact, shippingAddress, billingAddress, history}` (`docs/api/orders.md`); the summary of the list is `{number, status, placedAt, expiresAt, total, itemCount}`. Money is `{amount, currency}` in minor units. Statuses: `awaiting_payment`, `paid`, `fulfilled`, `cancelled`, `expired` |
| Order number | `XXXX-XXXX` (Crockford base32, 40 random bits); input is normalized. Not a secret, not sequential |
| Problem codes | `409` `cart_empty`, `cart_changed` (member `cart`: the fresh cart), `checkout_refused` (`errors[]` with `path: "lines.N"` and a code: `insufficient_stock`, `variant_not_sellable`, `reserved_out_of_range`, `line_total_out_of_range`), `idempotency_key_reused`; `503` `service_unavailable` with `Retry-After`; `rule_violation` rules `invalid_transition`, `subtotal_out_of_range`, and for variants `has_order_lines` (ADR 0020). Validation codes: `idempotency_key_required`, `invalid_idempotency_key`, `shipping_address_required` |
| Caching and limits | Every response is `Cache-Control: no-store`; writes need the store CSRF header; `checkout`, the lookup and the guest cancel are rate limited per address (`429` with `Retry-After`; the numbers are internal) |
| Config | `ORDER_PAYMENT_TTL_MINUTES`, `ORDER_GUEST_ACCESS_DAYS`, `ORDER_TOKEN_SECRET` (`docs/contracts/config.md`) |

Not contract (internal): the number of days and minutes behind the defaults beyond what `docs/contracts/config.md` lists, the rate-limit numbers, how many statements a request issues, the order of `errors[]` entries. The domain events (`order.placed`, ...), the handler registration and the ports are described in ADR 0018 and the core exports (`packages/core/src/orders/events.ts`); their contract file is `docs/contracts/events.md` (it also lists the `OrderReadPort`).

### Admin orders (plan step 6, `docs/api/orders.md`)

| Item | Rule |
|---|---|
| Routes and permissions | `GET /admin/orders` (list, `status`, `placedFrom`, `placedTo`, `q`, `limit`, `offset`), `GET /admin/orders/{id}`, `POST /admin/orders/{id}/cancel` `{reason}`, `POST /admin/orders/{id}/mark-paid` `{reference, amount}`, `POST /admin/orders/{id}/mark-fulfilled`; `orders.read` for `GET`, `orders.write` for every `POST` |
| `q` | An exact order number (case, dash and look-alike letters forgiven) or an exact email; never a prefix or substring; an empty `q` is no filter |
| Order of the list | Newest `placedAt` first, then `id` descending (a total order; not a field of the contract beyond "newest first") |
| Admin order | The shape in `docs/api/orders.md`: full locale maps, contact, addresses, the journal with the acting admin id, each line's reservations as `{status, quantity}`. Never a token, hash, idempotency key, fingerprint, reservation id, location or stock figure. The `OrderReadPort` returns the same view |
| Problem codes | `409 rule_violation` rules `invalid_transition`, `order_not_payable`, `amount_mismatch`, `payment_reference_conflict`, `awaiting_stock`; `400` for a reason or reference that is empty or too long, an amount that is not an exact non-negative integer, a bad filter |

## Stability of identifiers (ADR 0006 section 10)

| Identifier | Rule |
|---|---|
| `id` (UUID) | Opaque and stable for the life of the row. Clients must not parse it. |
| `code` (attribute, attribute option, option, option value, product type) | Never renamed by the system; set once on create. Storefront clients may branch on codes, so the admin API refuses code changes (`code` in a PATCH is `400 unknown_field`). |
| `slug` (product, category, brand) | Editable by the admin only. The old slug is freed at once; there are no redirects in v1 (a redirect table is planned with the storefront SEO work). The store API answers `404` for an archived product's slug. |
| `sku` | Globally unique; normalized (trimmed, uppercased) by the service. Editable, with no history. |

## What is not contract

- `optionSignature` on variants (admin): derived internal data, read-only, may change format.
- `position` values: the order is contract (lists are ordered as documented); the numbers are not. Clients must not depend on gaps or on the exact value.
- Internal attributes (`isInternal`) and attributes not visible on the storefront: never returned by `/store/*`, never documented as a store shape. Admin responses show them to admins; their existence and codes are not a storefront contract.
- Store fields not listed in `docs/api/catalog.md` (for example `barcode`, `isDefault`, variant `position`, timestamps other than `publishedAt`).
- The order of JSON object keys, and the exact wording of `detail` and `message` texts in problem bodies. Clients use `code`, `status` and `errors[].path` / `errors[].code`.
- Routes and fields that are documented as not yet implemented (for example price or availability sorting and filtering, search, payment and shipping provider routes) are not in this contract; they arrive with their own plans.
- The `pnpm admin:create` command is a tool, not an API; its options are described in `README.md` (Admin sign-in).

## Versioning

- SemVer for the template (`AGENTS.md` section 17). Routes live under `/admin` and `/store` without a version segment; a breaking change to a route means a new major version of the template and a migration guide, not a silent edit.
- Before the first release the contract may still change; the change is still recorded in `CHANGELOG.md`.
