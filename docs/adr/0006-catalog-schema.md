# 0006. Catalog schema

Status: accepted 2026-10-15 (owner answered the open questions; reviewed and partly verified by the orchestrator; plan `docs/plans/2026-10-14-catalog.md`, step 1). Refines the catalog part of ADR 0004; does not change ADR 0004's decisions.

## Context

- Scope: the first core domain (ProductType, attributes, options, products, variants, categories, brands, media) for Postgres 17 + Drizzle ORM 0.45.
- Already decided and not reopened here: JSONB attribute values validated by the backend against ProductType definitions, storing option **codes** (ADR 0004);
  one search document per variant (ADR 0005, indexing out of scope); texts as JSONB maps `{"<locale>": "..."}` (today `uk` and `en`) where the configured default locale (`DEFAULT_LOCALE`, default `uk`) is required and is the fallback;
  one latin slug per product, category and brand; media = `url`, `alt`, position; admin endpoints default-deny; options and attributes are separate concepts (AGENTS.md 2.3);
  a simple product has exactly one default variant; attribute flags `is_filterable`, `is_searchable`, `is_visible_on_storefront`, `is_comparable`, `is_sortable`, `is_internal`.
- Out of scope: prices, inventory, cart/orders, search indexing, media upload, auth, category filter overrides (`category_filter` from ADR 0004 is deferred).
- The schema is pre-release (no client data), so a wrong choice costs a new migration, not a data migration. Still: keep tables minimal, constraints explicit.

## Decision

### 1. Conventions

| Topic | Decision | Why / rejected |
|---|---|---|
| Primary keys | `uuid` with DB default `gen_random_uuid()` (v4), Drizzle `uuid("id").primaryKey().defaultRandom()` | Stable ids across environments (seeds, client fork staging/prod copies, future CSV import/export, order snapshots), not enumerable. Rejected: identity `bigint` (sequence collisions when merging data between environments; the only existing table `health_check` is a throwaway). Rejected for now: uuid v7 (`uuidv7()` exists only in Postgres 18; on 17 it needs a new dependency = red zone). Catalog tables are small, so v4 index locality is acceptable; switching the default to `uuidv7()` later does not change the column type. |
| Timestamps | `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` set by Drizzle `$onUpdate(() => new Date())` on every table except pure join tables | No triggers: Drizzle cannot declare them and they hide logic. Unsure: `$onUpdate` behaviour on raw SQL updates; the service layer must use the query builder for updates. |
| Soft vs hard delete | No `deleted_at` anywhere. `product.status` (`draft`/`active`/`archived`) is the only soft state; `archived` is the soft delete. Dictionaries (attribute, option, product_type, category, brand) are hard-deleted and protected by `ON DELETE RESTRICT`. Variants are hard-deleted only while the product is `draft`. | Soft-delete columns leak into every query and every unique constraint. Future `order_item.variant_id` (ADR 0004) will be `RESTRICT`, so a sold variant can never be deleted. |
| Hidden but not deleted | `variant.is_active`, `category.is_active` booleans | Admin needs "temporarily hide one size / prepare a category" without deleting. |
| Enumerations | `text` + `CHECK (col IN (...))`, not Postgres `enum` types | Altering a `CHECK` is trivial in up and down scripts; altering a Postgres enum is not reversible without a type rebuild. |
| Naming | Tables singular snake_case (`product`, `product_option_value`); join tables `<a>_<b>`; PK `id`; FK `<entity>_id`; booleans `is_*`; ordering `position integer not null default 0`; constraint names `<table>_<cols>_key` (unique), `<table>_<cols>_idx`, `<table>_<col>_check`, `<table>_<col>_fkey`. **Composite foreign keys must be named explicitly (`foreignKey({ name: ... })`) and every constraint name must be at most 63 characters** | Matches `health_check` and Drizzle defaults. Verified: drizzle-kit's auto-generated names for composite FKs reach 118 characters, above Postgres' 63-character limit (it would silently truncate them). A test asserts that no catalog constraint name is longer than 63 characters. |
| Codes | `code text` matching `^[a-z][a-z0-9_]{0,63}$` (enforced by `CHECK`), unique in their scope, immutable after creation | Codes are keys in JSONB and in API payloads (section 10), so they are never renamed. |
| i18n text columns | `jsonb` map `{"<locale>": "<string>"}`. DB `CHECK (jsonb_typeof(col) = 'object' AND col <> '{}'::jsonb)` on required texts (shape and non-empty only); optional texts are nullable with `jsonb_typeof(col) = 'object'` when present. The service enforces that the **configured default locale** (`DEFAULT_LOCALE`, default `uk`) is present and non-empty, validates allowed locale keys and max lengths (locales come from config). | Owner decision 1: the DB stays market-agnostic, so a fork for EU or US changes configuration, not a migration. |
| Ordering ties | Every list query orders by `position`, then a stable key (`code`, `slug` or `id`) | Deterministic pagination. |

### 2. Tables

All tables have `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at` unless marked "join" (join tables have a composite PK and `created_at` only).
`i18n` = JSONB text map as defined above. `RESTRICT`/`CASCADE` = `ON DELETE` behaviour.

| Table | Columns (type, nullability, default) | Constraints and indexes |
|---|---|---|
| `attribute` | `code text NN`; `name i18n NN`; `description i18n NULL`; `input_type text NN` in (`text`,`number`,`boolean`,`select`,`multiselect`,`date`); `is_localized boolean NN` (service sets `true` by default for `text`); `unit text NULL` (max 16 chars, e.g. `mm`, `kg`); `validation jsonb NN default '{}'` (section 4); flags `is_filterable`, `is_searchable`, `is_comparable`, `is_sortable`, `is_internal` boolean NN default `false`; `is_visible_on_storefront` boolean NN default `true` | `UNIQUE(code)`; `CHECK code ~ '^[a-z][a-z0-9_]{0,63}$'`; `CHECK (unit IS NULL OR input_type = 'number')`; `CHECK (NOT is_localized OR input_type = 'text')`; `CHECK (NOT is_internal OR NOT (is_visible_on_storefront OR is_filterable OR is_searchable OR is_comparable OR is_sortable))` (internal data can never be public-facing); `CHECK (NOT is_sortable OR input_type IN ('number','date'))`; `CHECK (NOT is_filterable OR input_type IN ('select','multiselect','boolean','number'))`; `CHECK (jsonb_typeof(validation) = 'object')` |
| `attribute_option` | `attribute_id uuid NN -> attribute CASCADE`; `code text NN`; `label i18n NN`; `position int NN default 0` | `UNIQUE(attribute_id, code)`; code `CHECK`; index `(attribute_id, position)`. Only for `select`/`multiselect` attributes (service rule; a cross-table rule is not a `CHECK`). Cascade is safe: an attribute can only be deleted when no product type assigns it (below), so no JSONB value can reference these codes. |
| `option` | `code text NN`; `name i18n NN` | `UNIQUE(code)`; code `CHECK` |
| `option_value` | `option_id uuid NN -> option CASCADE`; `code text NN`; `label i18n NN`; `position int NN default 0` | `UNIQUE(option_id, code)`; `UNIQUE(id, option_id)` (target of the composite FKs below); code `CHECK`; index `(option_id, position)` |
| `product_type` | `code text NN`; `name i18n NN`; `requires_shipping boolean NN default true` | `UNIQUE(code)`; code `CHECK` |
| `product_type_attribute` (join) | `product_type_id uuid NN -> product_type CASCADE`; `attribute_id uuid NN -> attribute RESTRICT`; `level text NN` in (`product`,`variant`); `is_required boolean NN default false`; `position int NN default 0` | `PK(product_type_id, attribute_id)` (an attribute is assigned once per type, so it has one level); index `(attribute_id)` |
| `product_type_option` (join) | `product_type_id uuid NN -> product_type CASCADE`; `option_id uuid NN -> option RESTRICT`; `position int NN default 0` | `PK(product_type_id, option_id)`; index `(option_id)` |
| `category` | `parent_id uuid NULL -> category RESTRICT`; `slug text NN`; `name i18n NN`; `description i18n NULL`; `position int NN default 0`; `is_active boolean NN default true` | `UNIQUE(slug)`; slug `CHECK` (section 7); `CHECK (parent_id IS DISTINCT FROM id)`; index `(parent_id, position)` |
| `brand` | `slug text NN`; `name i18n NN`; `description i18n NULL`; `logo_url text NULL` (max 2048) | `UNIQUE(slug)`; slug `CHECK` |
| `product` | `product_type_id uuid NN -> product_type RESTRICT`; `brand_id uuid NULL -> brand RESTRICT`; `slug text NN`; `title i18n NN`; `description i18n NULL`; `status text NN default 'draft'` in (`draft`,`active`,`archived`); `attributes jsonb NN default '{}'`; `published_at timestamptz NULL` | `UNIQUE(slug)`; slug `CHECK`; `CHECK (jsonb_typeof(attributes) = 'object')`; `CHECK (status <> 'active' OR published_at IS NOT NULL)` (no check tying `draft` to a null `published_at`: a product can return to draft after publishing); indexes `(status, published_at DESC, id DESC)` (public list), `(brand_id)`, `(product_type_id)` |
| `product_category` (join) | `product_id uuid NN -> product CASCADE`; `category_id uuid NN -> category RESTRICT`; `is_primary boolean NN default false`; `position int NN default 0` | `PK(product_id, category_id)`; partial `UNIQUE(product_id) WHERE is_primary` (at most one primary); index `(category_id, position, product_id)` |
| `product_option` (join) | `product_id uuid NN -> product CASCADE`; `option_id uuid NN -> option RESTRICT`; `position int NN default 0` | `PK(product_id, option_id)`; index `(option_id)` |
| `product_option_value` (join) | `product_id uuid NN`; `option_id uuid NN`; `option_value_id uuid NN`; `position int NN default 0` | `PK(product_id, option_id, option_value_id)`; FK `(product_id, option_id) -> product_option CASCADE`; FK `(option_value_id, option_id) -> option_value(id, option_id) RESTRICT` (guarantees the value belongs to that option); index `(option_value_id)` |
| `variant` | `product_id uuid NN -> product CASCADE`; `sku text NN`; `barcode text NULL` (max 64); `title i18n NULL` (override; default derived from option value labels); `option_signature text NN` (section 3); `is_default boolean NN default false`; `is_active boolean NN default true`; `attributes jsonb NN default '{}'`; `position int NN default 0` | `UNIQUE(sku)`; `CHECK sku ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'`; `UNIQUE(product_id, option_signature)`; partial `UNIQUE(product_id) WHERE is_default`; `UNIQUE(id, product_id)` (target of composite FKs); `CHECK (jsonb_typeof(attributes) = 'object')`; index `(product_id, position)` |
| `variant_option_value` (join) | `variant_id uuid NN`; `product_id uuid NN`; `option_id uuid NN`; `option_value_id uuid NN` | `PK(variant_id, option_id)` (at most one value per option per variant); FK `(variant_id, product_id) -> variant(id, product_id) CASCADE` (the variant belongs to that product); FK `(product_id, option_id, option_value_id) -> product_option_value RESTRICT` (a variant can only use values the product chose, and a chosen value cannot be removed while used); index `(product_id, option_id, option_value_id)` |
| `media` | `product_id uuid NN -> product CASCADE`; `option_id uuid NULL`; `option_value_id uuid NULL`; `url text NN` (max 2048); `alt i18n NULL`; `position int NN default 0` | `CHECK ((option_id IS NULL) = (option_value_id IS NULL))`; FK `(product_id, option_id, option_value_id) -> product_option_value RESTRICT`; index `(product_id, position)` |

Changes versus the draft list in ADR 0004 and the plan:
- No table added, merged or dropped. `category_filter` (ADR 0004) is deferred to the filter plan.
- `media` links to a **product option value** (for example "all red variants"), not to a `variant_id`. Scenario (a) showed that per-variant images duplicate the same photo over every size; per-value images cover gallery images (`NULL`), per-color images, and per-variant images (the distinguishing value) without duplication.
- `variant.option_signature` is added so the DB can enforce "unique option combination per product" and "exactly one variant for a product without options" (section 3).
- `product_category.is_primary` is added for the canonical breadcrumb and canonical category URL.
- `product_type.requires_shipping` carries the "digital product" preset of plan step 6. Rejected for v1: per-variant flag (a mixed physical/digital product is modelled as two products of two types). The shipping plan may move it.
- SEO fields (`seo_title`, `seo_description`), weight and dimensions are not in v1; they are additive columns for later plans.
- `health_check` stays untouched in this migration (plan: "no change to existing tables"); removing it is a separate tiny migration.

#### DDL-level snippets (Drizzle style, abbreviated; the real schema is written in step 3)

Composite foreign keys, partial unique indexes and `CHECK` constraints are all expressible in the installed drizzle-orm 0.45.4 and emitted correctly by drizzle-kit 0.31.11 (verified, see "Verification performed" below). In the real schema the composite `foreignKey(...)` calls carry explicit `name` values (the snippet below omits them for brevity).

```ts
export const variant = pgTable(
  "variant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull().references(() => product.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    title: jsonb("title").$type<I18nText>(),
    optionSignature: text("option_signature").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    attributes: jsonb("attributes").$type<AttributeValues>().notNull().default({}),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    unique("variant_sku_key").on(t.sku),
    unique("variant_product_id_option_signature_key").on(t.productId, t.optionSignature),
    unique("variant_id_product_id_key").on(t.id, t.productId),
    uniqueIndex("variant_product_id_default_key").on(t.productId).where(sql`${t.isDefault}`),
    index("variant_product_id_position_idx").on(t.productId, t.position),
    check("variant_sku_check", sql`${t.sku} ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'`),
    check("variant_attributes_check", sql`jsonb_typeof(${t.attributes}) = 'object'`),
  ],
);

export const variantOptionValue = pgTable(
  "variant_option_value",
  {
    variantId: uuid("variant_id").notNull(),
    productId: uuid("product_id").notNull(),
    optionId: uuid("option_id").notNull(),
    optionValueId: uuid("option_value_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.optionId] }),
    foreignKey({ columns: [t.variantId, t.productId], foreignColumns: [variant.id, variant.productId] }).onDelete("cascade"),
    foreignKey({
      columns: [t.productId, t.optionId, t.optionValueId],
      foreignColumns: [productOptionValue.productId, productOptionValue.optionId, productOptionValue.optionValueId],
    }).onDelete("restrict"),
    index("variant_option_value_product_option_value_idx").on(t.productId, t.optionId, t.optionValueId),
  ],
);
```

Required-text check as emitted SQL (one per required `i18n` column; shape and non-empty only, the default locale is a service rule):

```sql
ALTER TABLE "product" ADD CONSTRAINT "product_title_check"
  CHECK (jsonb_typeof("title") = 'object' AND "title" <> '{}'::jsonb);
```

Public list query (shape only; parameters bound by Drizzle): active products in a category subtree, optional brand, newest first.

```sql
WITH RECURSIVE subtree AS (
  SELECT id FROM category WHERE slug = $1 AND is_active
  UNION ALL
  SELECT c.id FROM category c JOIN subtree s ON c.parent_id = s.id WHERE c.is_active
)
SELECT p.* FROM product p
WHERE p.status = 'active'
  AND ($2::uuid IS NULL OR p.brand_id = $2)
  AND EXISTS (SELECT 1 FROM product_category pc JOIN subtree s ON s.id = pc.category_id WHERE pc.product_id = p.id)
ORDER BY p.published_at DESC, p.id DESC
LIMIT $3 OFFSET $4;
```

Consistency test for `option_signature` (must return zero rows):

```sql
SELECT v.id FROM variant v
LEFT JOIN (
  SELECT vov.variant_id, string_agg(o.code || '=' || ov.code, ';' ORDER BY o.code) AS signature
  FROM variant_option_value vov
  JOIN option o ON o.id = vov.option_id
  JOIN option_value ov ON ov.id = vov.option_value_id
  GROUP BY vov.variant_id
) s ON s.variant_id = v.id
WHERE v.option_signature <> coalesce(s.signature, '');
```

### 3. Options vs attributes

The plan's proposal is confirmed with two additions (`option_signature`, composite FKs). The reasoning:
- Options are **combinatorial** (they generate variants, are referenced by FK, and their values are listed on the product page as selectors). Attributes are **descriptive** (typed, flagged for filters and search, stored as JSONB). Merging them into one table with a flag was rejected: the lifecycle rules differ (FK-protected vs JSONB-referenced), and the separation is an architecture rule.
- Global `option` definitions with values (`color: red, black`) keep labels translated once and make codes stable across products; a product chooses a subset in `product_option_value`.
- `product_type_option` lists which options a type *allows*; a product uses any subset of the allowed options (zero for a simple product). Rejected: making options required per type; a product that does not use an option is a simple product of that type.

`option_signature`: the service computes, for every variant, the string of `<option_code>=<value_code>` pairs **sorted by option code** and joined with `;` (for example `color=red;size=m`); a variant of a product without options has the empty string. Sorting by code (not by `position`) keeps the signature stable when the admin reorders options. A test recomputes signatures from `variant_option_value` rows and asserts they match.

| Invariant | Enforced by |
|---|---|
| At most one value per option per variant | DB: `PK(variant_id, option_id)` |
| The value belongs to the option, and the product chose it | DB: composite FKs in `product_option_value` and `variant_option_value` |
| The variant and its option values belong to the same product | DB: composite FK `(variant_id, product_id)` |
| Unique option combination per product; exactly one variant when the product has no options | DB: `UNIQUE(product_id, option_signature)` (given a correctly computed signature) + service computes the signature inside the same transaction |
| At most one default variant per product | DB: partial unique index |
| At least one variant, and exactly one default, per product | Service: creates the default variant in the same transaction as the product; blocks deleting the last variant or the default variant; publish precondition |
| Option coverage: every variant has a value for every `product_option` | Service: `generateVariants` creates full combinations only; adding or removing a product option is allowed only while `status = 'draft'` and rebuilds the variants (section 5); a consistency test counts rows (`variant_option_value` per variant = `product_option` per product) |
| A product uses only options allowed by its type | Service (cross-table rule) |
| Max 3 options per product and variant limits (section 9) | Service |

### 4. Attribute definitions and value shapes

`attribute.input_type` and `attribute.validation` (JSONB, validated by a Zod schema per type in `packages/core`):

| `input_type` | Value shape in JSONB | `validation` keys | Notes |
|---|---|---|---|
| `text` | `is_localized = true`: i18n map `{"uk": "...", "en": "..."}` (the default locale is required, max length applies per locale). `is_localized = false`: plain string | `min_length`, `max_length` (default 1..1000) | No regex patterns in v1 (ReDoS risk, hard to explain in the admin). Non-localized text is for model numbers, supplier codes, URLs. |
| `number` | JSON number (jsonb stores it as exact `numeric`); `unit` comes from the definition, never from the value | `min`, `max`, `integer` (boolean, default false), `max_decimals` (default 3) | Not `NaN`/`Infinity` (JSON has none). |
| `boolean` | `true` / `false` | none | |
| `select` | one `attribute_option.code` string | none (allowed codes = the attribute's options) | |
| `multiselect` | array of unique `attribute_option.code` strings | `min_items` (default 1), `max_items` (default 50) | Service keeps array order as given; the public API orders by `attribute_option.position`. |
| `date` | ISO calendar date string `YYYY-MM-DD` (no time, no zone) | `min`, `max` (ISO dates) | |

Rules for the `attributes` JSONB on `product` (level `product`) and `variant` (level `variant`):
- Keys are attribute codes assigned to the product's type **at that level**; any other key is rejected (`400` with per-field errors). Values are never `null`: "not set" means the key is absent.
- `is_required` is checked at publish time (and on every write to an `active` product), not on draft writes, so admins can save incomplete drafts.
- Validation happens in `packages/core` `validateAttributeValues(productType, level, values)` and is called by every write path (admin API, seeds, future import). The DB only checks `jsonb_typeof = 'object'`.

Example, product-level (clothing):

```json
{ "material": "cotton", "care": { "uk": "Прати при 30°", "en": "Wash at 30°" }, "season": ["spring", "summer"], "organic": true }
```

Example, variant-level (clothing): `{ "weight_g": 180, "supplier_code": "SUP-7781" }` (`supplier_code` is a non-localized `text` attribute with `is_internal = true`).

### 5. Changing a ProductType and its attributes/options after products exist

"In use" is computed by the service: for attributes, `EXISTS (product/variant of a type that assigns the attribute WHERE attributes ? '<code>')` (and `attributes->'<code>' ? '<value>'` or `= '"<value>"'` for option codes); for options, rows in `product_option` / `product_option_value`.

| Change | Rule |
|---|---|
| Rename any `code` (attribute, attribute option, option, option value, product type) | Forbidden, always (`409`). Create a new one. Codes are public contract (section 10). |
| Change `attribute.input_type` or `is_localized` | Forbidden, always. |
| Change `attribute.unit` | Allowed only when no value exists (values are bare numbers; a unit change silently changes their meaning). |
| Change `attribute.validation` | Allowed. Existing values are not rewritten; they are re-validated on the next write or publish of that product. Tightening may therefore block re-publishing until fixed (admin sees per-field errors). |
| Change flags, labels, names, descriptions, positions | Always allowed. |
| Add `attribute_option` / `option_value` | Always allowed. |
| Delete `attribute_option` | Allowed when no value uses the code; otherwise `409`. Explicit migration step "replace option A by B" (rewrites JSONB in one transaction) is a later admin operation, not v1. |
| Delete `option_value` | DB `RESTRICT` from `product_option_value`. |
| Assign attribute to type | Allowed. With `is_required = true`, existing active products are not revalidated immediately (same as validation change). |
| Change `level` of an assigned attribute | Allowed only when no value exists (else remove and add, which is blocked the same way). |
| Remove attribute from type | Allowed only when no product or variant of that type has a value for it (else `409`; admin clears values first). |
| Delete attribute / option / product type | DB `RESTRICT` while assigned or used. |
| Remove option from type | Allowed only when no product of that type uses it in `product_option`. |
| Change `product.product_type_id` | Forbidden after creation (attributes and options depend on it). Create a new product. |
| Add or remove a `product_option` on a product | Only while `status = 'draft'`; the service deletes all variants and regenerates them (nothing references draft variants). On `active`/`archived` products options are frozen. |
| Add a `product_option_value` to an active product | Allowed; new variants are generated for the new combinations (within limits). |
| Remove a `product_option_value` | DB `RESTRICT` while any variant or media uses it; the admin deletes those variants (draft only) or deactivates them. |

### 6. Product lifecycle

Transitions (anything else is `409`): `draft -> active` (publish), `active -> draft` (unpublish), `draft -> archived`, `active -> archived`, `archived -> draft` (restore; re-publishing then runs the preconditions again). Hard delete is allowed only for products with `published_at IS NULL` (never published); it cascades to variants, option rows, categories and media.

Publish preconditions (all checked in one transaction, all violations returned at once):
1. `title` has a non-empty value for the configured default locale (service rule), and `slug` is present (DB-enforced).
2. Exactly one `is_default` variant and it is `is_active`; at least one active variant.
3. Every variant has a value for every product option (coverage) and a valid `sku`.
4. All `is_required` product-level attributes are present and valid; every variant has its required variant-level attributes.
5. `product_type` exists (FK) and the product's options are allowed by it.
Not required: a category, a brand, media. The pricing plan adds "has a price" later. `published_at` is set on the first publish and never cleared.

### 7. SKU, slug, barcode

| | Rule |
|---|---|
| SKU | Global uniqueness (one `UNIQUE(sku)` over all variants of the store), because inventory, order items and imports are keyed by SKU. Normalization by the service before validation: trim, uppercase. Allowed `^[A-Z0-9][A-Z0-9._-]{0,63}$` (DB `CHECK`). When omitted on create or generate, the service proposes `<SLUG>-<VALUE_CODE>[-<VALUE_CODE>]` uppercased, truncated to 64, with `-2`, `-3` on collision. Editable; no history. |
| Slug | `^[a-z0-9]+(-[a-z0-9]+)*$`, 1..160 chars (DB `CHECK`), unique per entity type (`product`, `category`, `brand` each have their own `UNIQUE(slug)`). Generated from `title->>'uk'` by the Ukrainian official romanization table (KMU resolution 55/2010) implemented in `packages/core`; non-letters collapse to `-`. Collision on create: append `-2`, `-3`, ... (query by prefix inside the transaction). Edit: allowed; the old slug is freed immediately and there is no redirect in v1 (open question 2). Archive: the slug stays reserved by the archived product (the store API answers `404`); restoring brings the same URL back. Slugs are flat, not path-based, so moving a category never changes URLs. |
| Barcode | `variant.barcode text NULL`, max 64, trimmed. No uniqueness and no GTIN check in v1 (suppliers reuse codes, some shops use Code128 text). Open question 5. |

### 8. Category tree

- Representation: **adjacency list** (`parent_id`) with recursive CTEs. Rejected: materialized path (redundant data to keep consistent on every move) and `ltree` (extension plus a custom Drizzle type). With max depth 5 and hundreds of categories, a recursive CTE over the whole table is cheap; the public tree endpoint loads all active categories in one query and builds the tree in memory.
- Depth: max 5 levels (root = level 1). Service-enforced on create and move by computing the deepest descendant of the moved subtree plus the depth of the new parent. The DB cannot enforce it.
- Cycles: the service rejects a move whose new parent is the node itself or one of its descendants (CTE from the node downwards). Concurrent moves are serialized with `pg_advisory_xact_lock(<constant for category tree>)` inside the transaction; `CHECK (parent_id IS DISTINCT FROM id)` catches the trivial case in the DB.
- Ordering: `position` among siblings, then `slug`.
- Moving a subtree = `UPDATE category SET parent_id = ?` on one row; descendants, slugs and `product_category` rows are untouched (verified in scenario (e)).
- Delete: `RESTRICT` by children and by `product_category`; the admin moves or detaches first. No cascade.
- Products to categories: many-to-many via `product_category`, at most one `is_primary` (DB partial unique). Service: when a product has categories, exactly one is primary (the first assigned becomes primary; removing the primary promotes the lowest `position`). Listing by category includes descendants (CTE) unless `?includeDescendants=false`.

### 9. Limits (service-enforced, constants in `packages/core`, all return `422`-style validation errors)

| Limit | Value | Why |
|---|---|---|
| Options per product | 3 | Plan decision; more than 3 selectors are unusable on a product page and explode combinations. |
| Chosen values per product option | 30 | 30 sizes is the realistic maximum (shoes, children's clothing). |
| Variants per product | 250 | 3 options cover e.g. 10 x 5 x 5; one search document per variant (ADR 0005) keeps indexing per product bounded. |
| New variants per `generate` call | 250 (and never beyond the per-product total) | A full cartesian product within the per-product limit fits in one call; one transaction stays small. |
| Category depth | 5 | Breadcrumbs and menus beyond 5 levels are unusable; keeps the CTE bounded. |
| Attributes per product type | 100 (product + variant) | Admin forms and the JSONB stay readable; 100 is far above real catalogs (~30). |
| Options per attribute, values per option | 500 | Dictionaries like "brand colour" or "manufacturer" can be long; keeps the admin selector finite. |
| Page size | default 24, max 100 | Plan decision (max 100); 24 fits 2/3/4-column grids. Max offset 10 000 (deep offsets are a cost attack; search handles the long tail). |
| Text lengths | code 64 (DB), slug 160 (DB), SKU 64 (DB), barcode 64, url 2048, title/name/label 255 per locale, description 20 000 per locale, alt 255, `attributes` JSONB 64 KB | Caps on untrusted input (AGENTS.md section 11). |

### 10. Public store API vs admin API

| | Store API (`/store/*`) | Admin API (`/admin/*`, default deny) |
|---|---|---|
| Products | `status = 'active'` only; draft/archived slugs return `404` | All statuses, filter by status |
| Variants | `is_active = true` only; `is_default` and `option_signature` not exposed (signature is internal) | All, incl. `option_signature` read-only |
| Categories | `is_active = true` and whose ancestors are active | All |
| Attribute definitions | Only `is_visible_on_storefront = true AND is_internal = false`; flags exposed: `is_filterable`, `is_comparable`, `is_sortable` | All, incl. `is_internal`, `validation` |
| Attribute values | **Allowlist**: one central serializer in `apps/api/src/catalog/store` emits only attributes whose definition passes the filter above; everything else (unknown keys, internal, hidden) is dropped. Tested: removing the filter fails the leak test. | Raw JSONB maps |
| Texts | Resolved to one string: `value[locale] ?? value[defaultLocale]` | Full maps |
| Timestamps | `published_at` only | All |

Locale resolution: `?locale=` must be in the configured locale list (currently `uk`, `en`); missing = the configured default locale; unknown = `400`. Fallback is per field, never per entity. Attribute values are resolved too: `select`/`multiselect` return `{code, label}`, `number` returns `{value, unit}`, localized text returns the resolved string.

Public contract under SemVer (`docs/contracts/api.md`, written in step 7): the endpoint shapes above and the **stability rules** for identifiers: `id`s are opaque and stable; `code`s (attribute, attribute option, option, option value, product type) and `slug`s are never renamed by the system (slugs only by the admin). Clients' storefront templates may branch on codes (`if attribute.code === 'size_chart'`), which is why section 5 forbids renames. `option_signature`, `position` values and internal attributes are not contract.

### 11. Migration plan

- One migration `apps/api/drizzle/0001_catalog.sql`, generated by `drizzle-kit generate` from `apps/api/src/database/schema/catalog.ts` (the schema file is split by domain; `drizzle.config.ts` must point at `./src/database/schema/*.ts` or an index, step 3 decides). Hand-written `0001_catalog.down.sql` next to it.
- Creation order (dependencies first): `attribute`, `attribute_option`, `option`, `option_value`, `product_type`, `product_type_attribute`, `product_type_option`, `category`, `brand`, `product`, `product_category`, `product_option`, `product_option_value`, `variant`, `variant_option_value`, `media`. drizzle-kit emits tables first and FKs as `ALTER TABLE` statements, so the order only matters for readability of the down script.
- Down script: `DROP TABLE IF EXISTS` in exact reverse order (no `CASCADE`, so an unexpected dependent object fails loudly), then `DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = <when of the 0001 entry in meta/_journal.json>`, following `0000_health_check.down.sql`.
- Tests on real Postgres (`*_test` database only, extending `apps/api/src/database/migrations.spec.ts`):
  - up, down, up, down; after each down no catalog table exists and `health_check` still exists.
  - Constraint tests, one `it` each, every expected error asserted by SQLSTATE: duplicate `sku`; duplicate product/category/brand `slug`; invalid slug, code and SKU formats; `title` that is not an object or is empty (the default-locale rule is tested in the service); invalid `status`, `level`, `input_type`; `is_internal` combined with `is_visible_on_storefront`; variant without product; two default variants; duplicate `option_signature`; two primary categories; `variant_option_value` with a value the product did not choose; `variant_option_value` whose variant belongs to another product; `media` with only one of `option_id`/`option_value_id`; `RESTRICT` on deleting a used `option_value`, `attribute`, `brand`, `category` with children; `CASCADE` from product to variants and media.
  - Drizzle schema vs migration drift: `drizzle-kit generate` produces no new file after step 3 (checked in CI like `openapi.json`).

### 12. Verified against scenarios

Rows are abbreviated; `i18n` values shown as `uk|en`. These are walk-throughs of the design, not executed queries (nothing exists yet to run).

**(a) T-shirt, options color and size, 6 variants**
- `option`: `color`, `size`. `option_value`: `color/red`, `color/black`, `size/s`, `size/m`, `size/l` (+ others unused).
- `attribute`: `material` (select; options `cotton`, `linen`), `care` (text, localized), `weight_g` (number, unit `g`), `supplier_code` (text, not localized, `is_internal`).
- `product_type` `clothing` (`requires_shipping = true`); `product_type_option`: color, size; `product_type_attribute`: material (product, required), care (product), weight_g (variant), supplier_code (variant).
- `product`: slug `futbolka-basic`, title `Футболка Basic|Basic T-shirt`, status `active`, `attributes = {"material":"cotton","care":{"uk":"...","en":"..."}}`.
- `product_option`: (product, color, 0), (product, size, 1). `product_option_value`: red, black, s, m, l (5 rows).
- `variant`: 6 rows, SKUs `FUTBOLKA-BASIC-RED-S` ... `-BLACK-L`, signatures `color=red;size=s` ... `color=black;size=l`, first one `is_default`, each `attributes = {"weight_g":180,"supplier_code":"SUP-1"}`.
- `variant_option_value`: 12 rows (2 per variant). `media`: 2 gallery rows (`option_value_id NULL`) + 1 row per color (`color/red`, `color/black`).
- Store API returns 6 variants without `supplier_code`; admin sees it. Deleting `option_value color/red` fails (`RESTRICT`). Adding `color/white` to the product generates 3 new variants.
- Finding: the first draft attached media to `variant_id`, which would need 3 copies of the red photo. Fixed by linking media to the product option value (section 2).

**(b) Screwdriver, attributes only**
- `product_type` `hand_tool`; no `product_type_option` rows; attributes: `tip_type` (select, product, required), `length_mm` (number, unit `mm`, product, filterable, sortable), `magnetic` (boolean, product), `supplier_code` (variant, internal).
- `product`: slug `vykrutka-ph2-100`, `attributes = {"tip_type":"ph2","length_mm":100,"magnetic":true}`.
- `variant`: exactly 1 row, `option_signature = ''`, `is_default = true`, SKU `VYKRUTKA-PH2-100`, `attributes = {"supplier_code":"S-42"}`. No `product_option`, `product_option_value` or `variant_option_value` rows. A second variant is impossible without options: `UNIQUE(product_id, option_signature)` rejects a second `''`.
- Cart and order code later reference this variant like any other; no "simple product" branch.

**(c) Digital product**
- `product_type` `digital` (`requires_shipping = false`); attributes `file_format` (select: `pdf`, `epub`), `size_mb` (number), `fulfillment_note` (text, not localized, internal).
- Rows as in (b): one default variant with signature `''`. Store API never shows `fulfillment_note`.
- Finding: the first draft made every `text` value an i18n map, which makes URLs, notes and codes awkward. Fixed by `attribute.is_localized` (section 4).

**(d) Sneakers with 3 options (color 3 x size 5 x width 2 = 30 variants)**
- `product_option`: color, size, width (positions 0, 1, 2). `product_option_value`: 10 rows. One `generate` call creates 30 variants and 90 `variant_option_value` rows (within limits 3 / 30 / 250).
- Signatures are sorted by code: `color=black;size=42;width=wide`. Reordering the options to width, color, size changes nothing in the DB.
- Adding a 4th option (`material`) is rejected: the product is `active` (options frozen) and the limit is 3.
- Generating with a 4th chosen width value would add 15 variants (45 total, allowed). Choosing 30 values for each of 3 options is rejected before any insert (27 000 > 250).

**(e) Category move**
- Tree: `odyag` (Clothing) > `cholovichyi` (Men) > `futbolky` (T-shirts); `zhinochyi` (Women). Move `futbolky` under `zhinochyi`: one `UPDATE category SET parent_id = <zhinochyi>, position = 0 WHERE id = <futbolky>` under the advisory lock; cycle check (is `zhinochyi` a descendant of `futbolky`? no) and depth check (subtree height 1 + new parent depth 1 = 2 <= 5) pass.
- `product_category` rows and the slug `futbolky` are unchanged; the store URL `/store/products?category=futbolky` keeps working, breadcrumbs change on the next read. Moving `odyag` under `futbolky` is rejected as a cycle.

### Verification performed (orchestrator review, 2026-10-15)

The architect marked the generated-SQL behavior as unverified, so the key tables were checked in a throwaway spike (not committed; schema built from this ADR's snippets, SQL generated with drizzle-kit, applied to Postgres 16 in a scratch database, then dropped):
- drizzle-kit 0.31.11 emits the composite FKs, the composite PKs, the CHECK constraints and the partial unique index (`variant_product_id_default_key ... WHERE "variant"."is_default"`) as designed.
- Finding (fixed in section 1): auto-generated names of 5 composite FKs were 67 to 118 characters long. After adding explicit `name` values every constraint name is at most 63 characters.
- 18 constraint scenarios behaved as the ADR says (each failing case failed with the expected constraint): a value the product did not choose; a variant pointed at another product; a value claimed for the wrong option; two values for one option on one variant; duplicate option signature; a second variant on an option-less product; a second default variant; duplicate and malformed SKU; title that fails the `uk` CHECK used in the spike (the accepted rule is shape-only, see section 1); bad slug; `active` without `published_at`; deleting a used option value (RESTRICT); media with only one of the pair; media for a value the product did not choose; cascade from product to variants, value rows and media.
- Confirmed limits of the DB (as documented in section 3): the DB does not check option coverage (a product with option `color` accepts a variant without any value row) and trusts `option_signature` (a variant can claim `color=red` with no value row). Both are service-layer rules guarded by the consistency test, not DB guarantees.
- Not verified: behavior on Postgres 17 (CI image) and concurrency under load; the migration and tests in step 3 cover Postgres 17 in CI.

### 13. Consequences and risks

- Positive: the DB enforces most structural invariants (one value per option per variant, values belong to the option and to the product, unique combination, one default, one primary category, no public flags on internal attributes). The service layer carries the counting rules (coverage, limits, depth, "in use" checks), all of which live in pure functions in `packages/core` and are covered by TDD in step 2.
- "In use" checks (section 5) query JSONB (`attributes ? 'code'`) and scan `product` and `variant`. v1 adds no GIN index (admin-only, rare operations); add `GIN (attributes jsonb_path_ops)` if catalogs grow beyond roughly 100k products.
- `option_signature` is derived data. If a code path writes variants without recomputing it, uniqueness is silently wrong. Mitigation: a single `writeVariants` service function, plus the consistency test in section 3.
- `attribute.code` renames are forbidden, so a typo in a code is permanent until a "replace attribute" migration operation exists (later). Acceptable: codes are created by our team, not by shoppers.
- Freezing product options after publish is strict; admins must unpublish to restructure. Revisit with an "add option with a default value for existing variants" operation when needed.
- No slug redirects in v1: editing a slug of a live product breaks inbound links until a redirect table exists.
- JSONB attribute values cannot be constrained by the DB; any bypass of `validateAttributeValues` (raw SQL, future import) corrupts data. Mitigation: all writes go through the core function; the store serializer tolerates and drops unknown keys.
- Recursive CTEs on every category listing are fine at hundreds of categories; at tens of thousands a materialized path would be an additive optimization (new column, no contract change).
- `requires_shipping` on `product_type` may need to move when the shipping plan arrives; it is a single additive change.

### Owner decisions (2026-10-15)

1. **Default locale in the DB**: the DB checks only shape and non-empty; the default locale comes from configuration (`DEFAULT_LOCALE`, default `uk`, and `LOCALES`, default `uk,en`, added to `packages/config`) and is enforced by the service. Reflected in sections 1, 4, 6, 10.
2. **Slug edits on live products**: no redirects in v1; a `slug_redirect` table belongs to the storefront SEO plan and must land before the first client launch.
3. **Options after publish**: frozen; unpublish, restructure, publish again. Adding option values stays allowed.
4. **`requires_shipping`**: on `product_type` for v1; the shipping plan may move it.
5. **Barcode**: free text for v1 (the recommendation was taken as the default; not separately confirmed by the owner). GTIN validation becomes a configurable rule when inventory or marketplace feeds need it.
