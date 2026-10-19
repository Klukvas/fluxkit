# API: catalog

Admin write API (`/admin/*`, default deny) and public store read API (`/store/*`, GET only) of the catalog core.
Source of truth for routes and schemas: `docs/api/openapi.json` (generated; `pnpm openapi:export`). This file is the readable map; when they disagree, the OpenAPI document and the code win.
No feature flag: the catalog is core.

## Conventions

- **Admin auth**: every `/admin/*` route runs `AdminGuard` (applied by `@AdminController`, and by a global guard for any path under `/admin` even when a controller forgot the decorator, see `docs/contracts/api.md`). Order of checks: CSRF header (state-changing methods), then authentication (`401 unauthorized`), then permission (`403 forbidden`).
  - **Session cookie**: the caller is identified by the cookie `fluxkit_admin_session` (`HttpOnly`, `SameSite=Strict`, `Path=/admin`, `Secure` unless `ADMIN_COOKIE_SECURE=false`, `Max-Age` = `ADMIN_SESSION_MAX_HOURS`). Only the cookie is read: an `Authorization` header, an API key or a query parameter is ignored. A missing, malformed, unknown or expired cookie, or a deactivated user, answers `401`. Role and activity are read from the database on every request, so a role change or deactivation applies at once. `POST /admin/auth/login` issues the cookie and `POST /admin/auth/logout` clears it (`docs/api/auth.md`); the first owner is created with `pnpm admin:create` (README, Admin sign-in).
  - **CSRF**: every `POST`, `PUT`, `PATCH` and `DELETE` under `/admin` must send `X-Fluxkit-CSRF: 1` and, when it has a body, `Content-Type: application/json`; otherwise `403 forbidden`, also for callers that are not signed in. `GET`, `HEAD` and `OPTIONS` are exempt. The API sends no CORS headers. `openapi.json` documents the required header (value `1`) on every state-changing `/admin` operation, the sign-in included.
  - **Permissions**: roles `owner` (all), `manager` (`catalog.read`, `catalog.write`, `catalog.publish`, plus `orders.read`, `orders.write`, `customers.read` and `customers.write`), `viewer` (`catalog.read`). Every route resolves to one permission: `GET` and `HEAD` need `catalog.read`; every other method needs `catalog.write` (create, update, delete, replace sets, variants, media, dictionaries, categories); the product lifecycle routes `POST /admin/products/{id}/publish`, `/unpublish`, `/archive` and `/restore` need `catalog.publish`. A signed-in caller without the permission gets `403 forbidden`. A route under `/admin` with no permission declaration at all is denied with `403` (`401` when not signed in). `users.manage` is needed by the `/admin/users` routes (`docs/api/auth.md`) and by no catalog route. The `/admin/customers` routes (`docs/api/customers.md`) use their own default pair: `GET` needs `customers.read`, every other method `customers.write`; the `/admin/orders` routes (`docs/api/orders.md`) use `orders.read` for `GET` and `orders.write` for every `POST`; the viewer holds none of them.
  - **`x-fluxkit-permission`**: every `/admin` operation in `openapi.json` carries this vendor extension, generated from the declarations the guard enforces (never a table written by hand): a permission name (`catalog.read`, `catalog.write`, `catalog.publish`, `users.manage`, `orders.read`, `orders.write`, `customers.read`, `customers.write`), `authenticated` (any signed-in admin: `GET /admin/config`, `me`, `change-password`, `logout`), `public` (only `POST /admin/auth/login`) or `denied` (a route that declares nothing is refused to everybody; none exists in the core). A spec checks every value against the live guard.
- **Store auth**: none. `/store/*` is public and read-only (GET only).
- **Format**: JSON; field names camelCase; ids are UUIDs (opaque); timestamps are ISO 8601 UTC. Admin responses carry `createdAt` and `updatedAt`; store responses carry only `publishedAt`.
- **Texts**: i18n texts are maps `{"uk": "...", "en": "..."}`. Locales come from `LOCALES` (default `uk,en`); `DEFAULT_LOCALE` (default `uk`) is required for required texts. A text map in a PATCH replaces the whole map.
- **Errors**: `application/problem+json` with `type` (`about:blank`), `title`, `status`, `code`, `detail`, and where relevant `errors[]` (each `{path, code, message?}`), `field`, `constraint`, `rule`. Internals (SQL, stack traces) never appear; they are logged.

| code | status | when |
|---|---|---|
| `validation_failed` | 400 | malformed body or query, unknown field (`unknown_field`), value rejected by a core rule (`errors[]` carries the core reason as `code`), missing reference (`invalid_reference`), publish preconditions not met |
| `unauthorized` | 401 | no valid session: missing, malformed, unknown or expired cookie, or a deactivated user |
| `forbidden` | 403 | signed in but the role lacks the route's permission (the detail names it), or a state-changing admin request lacks `X-Fluxkit-CSRF: 1` or, with a body, `Content-Type: application/json` |
| `not_found` | 404 | unknown id or slug, or an unknown route |
| `conflict` | 409 | unique value taken (`field` when the constraint is one column; `constraint` name); also after SKU or slug allocation retries are exhausted |
| `in_use` | 409 | a referenced row still exists (database RESTRICT), or a category with children or products is deleted |
| `invalid_transition` | 409 | product lifecycle action not allowed from the current status; `rule` is `<from>_to_<target>` |
| `rule_violation` | 409 | a core rule refuses the change; `rule` is the core reason code (for example `options_frozen`, `product_type_in_use`, `last_variant`) |
| `too_many_requests` | 429 | too many login attempts from one client address (`POST /admin/auth/login`); `Retry-After` carries the seconds to wait |
| `internal_error` | 500 | unexpected failure; the detail is generic |

- Field error `code` values come from the request schema (`required`, `invalid_type`, `unknown_field`, `too_small`, `too_big`, `invalid_format`, `invalid_value`) or from core (for example `title_invalid`, `default_locale_missing`, `slug_missing`, `default_variant_inactive`).
- Free-text fields that are not i18n maps (`barcode`, `logoUrl`, media `url`, attribute `unit`, a client-sent `sku`) answer `400 validation_failed` for a NUL character or an unpaired UTF-16 surrogate, like i18n texts and text attribute values do. An attribute value of the wrong type, however deeply nested, answers `400 invalid_type` for that attribute.
- Generated slugs (products, categories, brands) get `-2`, `-3`, ... on collision and stay within 160 characters, also for titles whose slug is 160 characters long. A slug or SKU the client sent that is taken answers `409` at once; a generated one that loses a race is retried, and `409` follows when a retry would propose the same value again.
- A PATCH with `code`, `status`, `parentId` (on categories) or `position` (on categories) is `400 unknown_field`: those fields change only through their own routes or are immutable.

### Writes

- `POST` creates answer `201` with the full resource and a `Location` header. The option-value route on a product answers with the product detail.
- `PATCH` changes only the listed fields. Absent means unchanged; `null` clears a nullable field. Codes never change after creation.
- `PUT` replaces a whole set: product categories, product media, product options, and assignments of attributes and options to a product type (the assignment `PUT` answers `201` when new and `200` when it replaced an existing one).
- `DELETE` answers `204` with no body.
- Lifecycle actions (`publish`, `unpublish`, `archive`, `restore`) answer `200` with the product detail.

### Lists and pagination

- Admin lists: `?limit` (1 to 100, default 50) and `?offset` (0 to 10 000, default 0). Response `{items, total, limit, offset}`. Order is stable (listed per route).
- Store lists: `?limit` (1 to 100, default 24) and `?offset` (0 to 10 000, default 0). Same response shape.
- Out-of-range or non-integer values answer `400 validation_failed`.
- Admin list routes ignore unknown query keys; store routes reject them (`400 unknown_field`).

### Store (`/store/*`)

- **Locale**: `?locale=` must be one of the configured `LOCALES` (default `uk` or `en`). Missing means `DEFAULT_LOCALE`. Anything else answers `400 validation_failed` at `locale` (`invalid_value`).
- **Per-field fallback**: each text is resolved to one string: the requested locale, else the default locale, else the first available non-empty locale in code order (a text written when another locale was configured still shows; the cart and the orders use the same rule, ADR 0025). Fallback is per field, never per entity. If no locale has a required text (product title, category or option name, brand name), the value is an empty string and a warning is logged.
- **Hard rules** (tested):
  - Only products with status `active` appear, in lists and in detail. Draft, archived, and unknown slugs answer `404 not_found` in detail.
  - Only sellable variants appear: `isActive = true` and a price in the shop currency (`SHOP_CURRENCY`). A product with no sellable variant is not listed and its detail answers `404 not_found`, like an unpublished product. Prices, availability and the rules are in `docs/api/pricing.md`, Store.
  - Quantities, locations, movements, reservations, the stock flags and prices in other currencies never appear in any store response.
  - Only categories with `isActive = true` whose ancestors are all active appear, in the tree and in a product's `categories`.
  - Attributes flagged `isInternal` or not `isVisibleOnStorefront` never leave the API, neither as values nor as definitions. One serializer decides this (core `selectPublicAttributes`, `publicAttributeDefinitions`); unknown attribute keys are dropped.
  - Hidden internals: `optionSignature`, variant `isDefault`, `barcode`, `position` values, status fields, `createdAt`, `updatedAt`.
  - `publishedAt` is the only timestamp.
- **Filters**: `?category=<slug>` matches the category and all its active descendants; an unknown, inactive or hidden category gives an empty list, not an error. `?brand=<slug>` matches one brand; unknown gives an empty list. No text search or facets; no sorting or filtering by price or availability yet (search plan).
- **Order**: products by `publishedAt` descending, then `id`; categories by position, then slug; variants by position, then sku, then id.

## Attributes

Attribute definitions (`code`, `inputType`, flags, `validation`). Input types: `text`, `number`, `boolean`, `select`, `multiselect`, `date`.

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `POST /admin/attributes` | admin | Create an attribute | body: `code` (`^[a-z][a-z0-9_]{0,63}$`, immutable), `name` (i18n), `inputType`; optional `description`, `isLocalized`, `unit`, `validation`, flags `isFilterable`, `isSearchable`, `isVisibleOnStorefront`, `isComparable`, `isSortable`, `isInternal` | 201 attribute, `Location` | 400, 409 (`conflict` on `code`) | - |
| `GET /admin/attributes` | admin | List attributes, ordered by code | `limit`, `offset` | 200 page of attributes | 400 | - |
| `GET /admin/attributes/{id}` | admin | Get an attribute with its options | path `id` | 200 attribute with `options` (ordered by position, then code) | 400, 404 | - |
| `PATCH /admin/attributes/{id}` | admin | Change an attribute (name, description, unit, validation, flags) | body: any of the fields listed for create except `code`; `inputType` and `isLocalized` only to confirm the stored value | 200 attribute | 400, 404, 409 (`input_type_immutable`, `is_localized_immutable`, `unit_in_use`) | - |
| `DELETE /admin/attributes/{id}` | admin | Delete an attribute that no product type assigns | path `id` | 204 (its options go with it) | 400, 404, 409 (`attribute_assigned`, `in_use`) | - |
| `POST /admin/attributes/{id}/options` | admin | Add an option to a select or multiselect attribute | body: `code` (`^[a-z0-9][a-z0-9_]{0,63}$`), `label` (i18n), optional `position` | 201 attribute option, `Location` | 400, 404, 409 (`conflict` on code) | - |
| `PATCH /admin/attributes/{id}/options/{optionId}` | admin | Change an attribute option (label, position) | body: `label`, `position` | 200 attribute option | 400, 404 | - |
| `DELETE /admin/attributes/{id}/options/{optionId}` | admin | Delete an attribute option that no value uses | path `id`, `optionId` | 204 | 400, 404, 409 (`attribute_option_in_use`) | - |

## Options (variant axes)

Options such as color or size. Products choose values of options; variants are generated from the chosen values.

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `POST /admin/options` | admin | Create an option (a variant axis) | body: `code` (`^[a-z][a-z0-9_]{0,63}$`, immutable), `name` (i18n) | 201 option, `Location` | 400, 409 (`conflict` on code) | - |
| `GET /admin/options` | admin | List options, ordered by code | `limit`, `offset` | 200 page of options | 400 | - |
| `GET /admin/options/{id}` | admin | Get an option with its values | path `id` | 200 option with `values` (ordered by position, then code) | 400, 404 | - |
| `PATCH /admin/options/{id}` | admin | Change an option's name | body: `name` | 200 option | 400, 404 | - |
| `DELETE /admin/options/{id}` | admin | Delete an option that no product type allows and no product uses | path `id` | 204 (its values go with it) | 400, 404, 409 (`option_assigned_to_product_type`, `option_in_use_by_products`) | - |
| `POST /admin/options/{id}/values` | admin | Add a value to an option | body: `code` (`^[a-z0-9][a-z0-9_]{0,63}$`), `label` (i18n), optional `position` | 201 option value, `Location` | 400, 404, 409 (`conflict` on code) | - |
| `PATCH /admin/options/{id}/values/{valueId}` | admin | Change an option value (label, position) | body: `label`, `position` | 200 option value | 400, 404 | - |
| `DELETE /admin/options/{id}/values/{valueId}` | admin | Delete an option value that no product uses | path `id`, `valueId` | 204 | 400, 404, 409 (`option_value_in_use`) | - |

## Product types

A product type defines which attributes and options a product of that type may have.

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `POST /admin/product-types` | admin | Create a product type | body: `code` (`^[a-z][a-z0-9_]{0,63}$`, immutable), `name` (i18n), optional `requiresShipping` (default `true`) | 201 product type, `Location` | 400, 409 (`conflict` on code) | - |
| `GET /admin/product-types` | admin | List product types, ordered by code | `limit`, `offset` | 200 page of product types | 400 | - |
| `GET /admin/product-types/{id}` | admin | Get a product type with its assignments | path `id` | 200 product type with `attributes` (product or variant level, `isRequired`, `position`; each also carries `attribute`, the definition with its options exactly as `GET /admin/attributes/{id}` shows it, internal attributes included) and `options` (`position`). Five statements however many attributes are assigned (the definitions and their options are read once each, not per attribute) | 400, 404 | - |
| `PATCH /admin/product-types/{id}` | admin | Change name or `requiresShipping` | body: `name`, `requiresShipping` | 200 product type | 400, 404 | - |
| `DELETE /admin/product-types/{id}` | admin | Delete a product type that no product uses | path `id` | 204 (its assignments go with it) | 400, 404, 409 (`product_type_in_use`) | - |
| `PUT /admin/product-types/{id}/attributes/{attributeId}` | admin | Assign an attribute to the type, or replace the assignment | body: `level` (`product` or `variant`, required), optional `isRequired`, `position` | 201 new assignment or 200 replaced one | 400, 404, 409 (`level_in_use`, other core reasons) | - |
| `DELETE /admin/product-types/{id}/attributes/{attributeId}` | admin | Remove an attribute from the type | path `id`, `attributeId` | 204 | 400, 404, 409 (`attribute_assignment_in_use`) | - |
| `PUT /admin/product-types/{id}/options/{optionId}` | admin | Allow an option on the type, or change its position | body: optional `position` | 201 new assignment or 200 replaced one | 400, 404 | - |
| `DELETE /admin/product-types/{id}/options/{optionId}` | admin | Remove an option from the type | path `id`, `optionId` | 204 | 400, 404, 409 (`option_in_use_by_products`) | - |

## Brands

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `POST /admin/brands` | admin | Create a brand | body: `name` (i18n), optional `description` (i18n), `logoUrl` (http or https, max 2048), `slug` (generated from the default-locale name when omitted) | 201 brand, `Location` | 400, 409 (`conflict` on `slug`) | - |
| `GET /admin/brands` | admin | List brands, ordered by slug | `limit`, `offset` | 200 page of brands | 400 | - |
| `GET /admin/brands/{id}` | admin | Get a brand | path `id` | 200 brand | 400, 404 | - |
| `PATCH /admin/brands/{id}` | admin | Change a brand | body: `name`, `description` (nullable), `logoUrl` (nullable), `slug` | 200 brand | 400, 404, 409 (`conflict` on `slug`) | - |
| `DELETE /admin/brands/{id}` | admin | Delete a brand that no product uses | path `id` | 204 | 400, 404, 409 (`in_use`) | - |

## Categories

A category tree: adjacency list, at most 5 levels, `isActive` flag. Moving a category changes only its parent and position.

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `POST /admin/categories` | admin | Create a category, optionally under a parent | body: `name` (i18n), optional `description`, `slug` (generated when omitted), `parentId` (uuid or null), `position` (index among siblings; omitted means last), `isActive` | 201 category, `Location` | 400 (`invalid_reference` on `parentId`), 409 (`conflict` on `slug`, `rule_violation` `max_depth_exceeded`) | - |
| `GET /admin/categories` | admin | List categories (flat), ordered by position, slug, id | `limit`, `offset`, `parentId` (uuid: direct children only; without it every category of every level is listed, and no value selects the root level alone) | 200 page of categories | 400 | - |
| `GET /admin/categories/{id}` | admin | Get a category | path `id` | 200 category | 400, 404 | - |
| `PATCH /admin/categories/{id}` | admin | Change name, description, slug or `isActive` | body: `name`, `description` (nullable), `slug`, `isActive`; `parentId` and `position` are rejected (use move) | 200 category | 400, 404, 409 (`conflict` on `slug`) | - |
| `DELETE /admin/categories/{id}` | admin | Delete a category with no children and no products | path `id` | 204 | 400, 404, 409 (`in_use`) | - |
| `POST /admin/categories/{id}/move` | admin | Move a category under another parent (`null` means root) at a position among its siblings | body: `parentId` (uuid or null, required), optional `position` | 200 category | 400 (`invalid_reference`), 404, 409 (`rule_violation`: `moved_under_itself`, `would_create_cycle`, `max_depth_exceeded`) | - |

## Products

A product (catalog entity) has one or more variants; a simple product has one default variant. Products start as `draft`. Lifecycle: `draft` to `active` (publish), `active` to `draft` (unpublish), `draft` or `active` to `archived` (archive), `archived` to `draft` (restore). `publishedAt` is set on the first publish and never cleared.

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `POST /admin/products` | admin | Create a draft product of a product type, with its single default variant | body: `productTypeId` (required), `title` (i18n, default locale required), optional `description`, `brandId` (nullable), `slug` (generated from the `uk` title when omitted), `attributes` (product-level values) | 201 product detail, `Location` | 400 (`invalid_reference` on `productTypeId` or `brandId`; attribute value errors carry core codes in `errors[]`), 409 (`conflict` on `slug`) | - |
| `GET /admin/products` | admin | List products, ordered by slug | query `status` (`draft`, `active`, `archived`), `categoryId` (products assigned to that category directly, not its descendants), `brandId`, `q` (below), `limit`, `offset`; every filter combines (AND) | 200 page of product summaries (no nested collections) | 400 (`q`: `too_small` when empty after trimming, `too_big` above 160 characters, `invalid_format` for a character outside letters, digits, `.`, `_`, `-`) | - |
| `GET /admin/products/{id}` | admin | Get a product with its categories, media, variants and options | path `id` | 200 product detail (`categories`, `media`, `variants`, `options`) | 400, 404 | - |
| `PATCH /admin/products/{id}` | admin | Change a product; status changes only through the lifecycle routes | body: `title`, `description` (nullable), `brandId` (nullable), `slug`, `attributes` (replaces all product-level values); `productTypeId` is accepted only if unchanged | 200 product detail | 400, 404, 409 (`conflict` on `slug`, `rule_violation` `product_type_immutable`) | - |
| `DELETE /admin/products/{id}` | admin | Delete a product that was never published (archive the others) | path `id` | 204 (variants, options, categories and media go with it) | 400, 404, 409 (`rule_violation` `product_was_published`) | - |
| `POST /admin/products/{id}/publish` | admin | Publish a draft product; every precondition is checked and all violations are returned together | path `id` | 200 product detail | 400 (`validation_failed`, `errors[]` per violation, e.g. `title_invalid`, `slug_missing`, `attribute_invalid`, `price_missing` at `variants.N` for an active variant without a price in `SHOP_CURRENCY`; see `docs/api/pricing.md`), 404, 409 (`invalid_transition`) | - |
| `POST /admin/products/{id}/unpublish` | admin | Take an active product back to draft | path `id` | 200 product detail | 400, 404, 409 (`invalid_transition`) | - |
| `POST /admin/products/{id}/archive` | admin | Archive a draft or active product (soft delete) | path `id` | 200 product detail | 400, 404, 409 (`invalid_transition`) | - |
| `POST /admin/products/{id}/restore` | admin | Restore an archived product as a draft; publishing again runs the preconditions again | path `id` | 200 product detail | 400, 404, 409 (`invalid_transition`) | - |
| `PUT /admin/products/{id}/categories` | admin | Replace the categories of a product; exactly one assignment is primary | body: `categories` (list of `{categoryId, position?}`, max 100), optional `primaryCategoryId` (must be in the list) | 200 product detail | 400 (`invalid_reference` on a category), 404 | - |
| `PUT /admin/products/{id}/media` | admin | Replace the media list of a product | body: `media` (list of `{url, alt?, position?, optionId?, optionValueId?}`, max 100; `optionId` and `optionValueId` come together) | 200 product detail | 400 (`option_pair_incomplete` and other field errors), 404 | - |

`q` on `GET /admin/products`: the start of a slug or an exact SKU of any variant of the product (`slug LIKE 'text%'` or `variant.sku = 'TEXT'`), never a title or a substring (text search belongs to the search index, AGENTS.md section 2.3). The text is trimmed; case does not matter (slugs are lower case, SKUs are normalized to upper case like on write). `%`, `_` and `\` are plain characters. A product that matches both ways is listed once; the list keeps its two statements (page and count). The SKU arm uses the unique index of `variant.sku`; the slug arm is a scan of the `product` table until an optional `text_pattern_ops` index on `product.slug` is approved (a migration), so keep it in mind for catalogs of many thousands of products.

## Product options and variants

Options are chosen per product. Changing them on a draft regenerates variants; a published product keeps its option structure (frozen) and only gains new values.

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `PUT /admin/products/{id}/options` | admin | Replace the options and chosen values of a draft product; variants are regenerated | body: `options` (list of `{optionId, valueIds}`, the list order is the display order; empty list means no options; at most 3 options and 30 values each) | 200 product detail | 400 (core reasons such as `too_many_options`, `duplicate_value`, `option_not_allowed`), 404, 409 (`rule_violation` `options_frozen` on a published product; `rule_violation` `has_stock_history` when the change adds or removes an option or removes a value and any variant of the product has a stock movement or reservation, ADR 0014, or `has_order_lines` when any of them is referenced by an order line, ADR 0020; `in_use` when media still refers to a removed value) | - |
| `POST /admin/products/{id}/options/{optionId}/values` | admin | Add a chosen value to an option of the product (any status) and generate the variants of the new combinations | body: `valueId` (uuid) | 201 product detail, `Location` to the product. Variants generated for an `active` or `archived` product whose type has a required variant-level attribute are created with `isActive: false` (ADR 0008) | 400 (`invalid_reference`: value missing or of another option; core limits), 404 (product, option), 409 (`conflict` on `sku`, after retries) | - |
| `GET /admin/products/{id}/variants` | admin | List the variants of a product, ordered by position | path `id`, `limit`, `offset` | 200 page of variants | 400, 404 | - |
| `POST /admin/products/{id}/variants` | admin | Create one variant of a draft product from one value of every product option; usually `generate` is easier | body: `optionValueIds` (one per product option), optional `sku` (proposed when omitted), `barcode` (nullable, max 64), `attributes`, `isActive`, `trackInventory`, `allowBackorder` (booleans; see below); a new variant is never the default | 201 variant, `Location` | 400, 404, 409 (`rule_violation` `product_not_draft`, `conflict` on `sku`) | - |
| `POST /admin/products/{id}/variants/generate` | admin | Create the variants missing for the product's current options (idempotent); the first variant of a product without variants becomes the default | none | 200 `{created, skipped, variants}` (`skipped` counts combinations that already had a variant); new variants start inactive on a live product whose type requires a variant attribute (ADR 0008) | 400, 404, 409 (`conflict` on `sku`, after retries) | - |
| `GET /admin/products/{id}/variants/{variantId}` | admin | Get one variant with its option values | path `id`, `variantId` | 200 variant (`optionValues`, `optionSignature`, `isDefault`, `isActive`, `trackInventory`, `allowBackorder`, `attributes`) | 400, 404 | - |
| `PATCH /admin/products/{id}/variants/{variantId}` | admin | Change a variant; option values are immutable | body: `sku`, `barcode` (nullable; empty string clears), `attributes`, `isActive`, `trackInventory`, `allowBackorder` (booleans, `null` is rejected), `position` (0 to 1 000 000), `isDefault` (`true` moves the default flag) | 200 variant. Switching an inactive variant of an `active` product on (`isActive: true`) requires its required variant attributes (`400 required` per missing attribute, ADR 0008) and a price in `SHOP_CURRENCY` (`409 rule_violation` `price_missing`; `docs/api/pricing.md`) | 400, 404, 409 (`conflict` on `sku`, `rule_violation` `no_default_variant`, `default_variant_inactive` or `price_missing`) | - |
| `DELETE /admin/products/{id}/variants/{variantId}` | admin | Delete a variant of a draft product; never the last or the default one, and never one with stock history (any stock movement or reservation row: switch it off with `isActive: false` instead, ADR 0013) and never one that an order line refers to (also when it was never reserved, such as digital goods: ADR 0020) | path `id`, `variantId` | 204 | 400, 404, 409 (`rule_violation` `product_not_draft`, `last_variant`, `default_variant`, `has_stock_history`, `has_order_lines`) | - |

Stock flags: `trackInventory` (default `true`) and `allowBackorder` (default `false`) are part of every admin variant response (also inside the product detail). Variants created for a product type with `requires_shipping = false` (digital goods) start with `trackInventory: false`, whether created with the product, by `generate`, by an option change or by hand without the flag; an explicit flag in `POST` wins. Changing the product type's `requiresShipping` later does not change existing variants. The flags can be changed at any product status. They are not in the store API. Stock levels, adjustments, the journal and locations are in `docs/api/inventory.md`.

Prices of a variant (`GET|PUT|DELETE /admin/products/{id}/variants/{variantId}/prices[/{currency}]`, bulk `PUT /admin/products/{id}/prices`) are documented in `docs/api/pricing.md`.

## Store

Public read-only routes. Rules and locale handling: see Conventions.

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `GET /store/config` | public | The settings a storefront needs to format money and pick a language | none | 200 `{currency, currencyExponent, pricesIncludeTax, defaultLocale, locales}` (`currencyExponent`: minor-unit digits of `currency`, from core; nothing else is exposed) | - | - |
| `GET /store/categories` | public | Public category tree: active categories whose ancestors are all active, ordered by position, slug | `locale` | 200 `{items: [node]}`; a node is `{id, slug, name, description, children}`, at most 5 levels | 400 (`locale`) | - |
| `GET /store/products` | public | List active products, newest first (`publishedAt` descending, then `id`); filter by category (with descendants) and brand | `locale`, `category` (slug), `brand` (slug), `limit`, `offset` | 200 page of items `{id, slug, title, brand: {slug, name} or null, image: {url, alt} or null, publishedAt, price: {from, to, currency}, availability}`; only products with a sellable variant are listed and counted in `total`; a well-formed unknown `category` or `brand` gives an empty list | 400 (`locale`, pagination, unknown query key, `category` or `brand` that is not a slug: `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 160) | - |
| `GET /store/products/{slug}` | public | Get an active product by slug with its options, variants, media and public attributes | path `slug`, `locale` | 200 `{id, slug, title, description, brand, publishedAt, categories, attributes, attributeDefinitions, options, variants, media, price: {from, to, currency}, availability}`; a variant is `{id, sku, optionValues, attributes, price: {amount, currency, compareAtAmount}, availability}`; `options` list only the values the product chose that a sellable variant uses (an option with none left is omitted); `variants` only sellable ones; `media` with an `optionValueId` only for the listed values (ADR 0007) | 400 (`locale`, slug longer than 160), 404 (draft, archived, unknown or malformed slug, or no sellable variant) | - |

Field shapes, the hiding rules and the availability rules of the store are in `docs/api/pricing.md`, Store.

Store product `image` is the first media item of the product without an option value, else the first media item. Store `media` items carry `optionValueId` (or null).
