# Catalog step 5: public store read API (design)

Status: spec for step 5 of the catalog plan (`docs/plans/2026-10-14-catalog.md`), decided by the orchestrator. Store contract: ADR 0006 section 10.

## Conventions

- Prefix `/store`, NO authentication (public, read-only, GET only).
- Locale via `?locale=` (must be in configured `LOCALES`, missing = `DEFAULT_LOCALE`, unknown = 400 `validation_failed`). Text fields are resolved to ONE string with core `resolveText` (per-field fallback to the default locale, never per entity).
- Errors are `application/problem+json`, like the admin API.
- Lists: `?limit` (default 24, max 100), `?offset` (max 10000), response `{items,total,limit,offset}`, stable order.
- Timestamps: only `publishedAt` is exposed (ISO string); never `createdAt`/`updatedAt`.
- IDs are UUIDs (opaque); codes and slugs are stable.
- NOT exposed: `option_signature`, `is_default`, `barcode`, `position` values, `isInternal`, `validation`, status fields.

## Endpoints

1. `GET /store/categories`: nested tree of categories with `is_active = true` whose ancestors are all active; each node `{id, slug, name, description|null, children:[...]}` ordered by position then slug.
2. `GET /store/products`: ACTIVE products only, with filters `?category=<slug>` (the category and ALL its active descendants; an inactive or unknown category slug gives an empty list, not an error) and `?brand=<slug>`; order `publishedAt desc, id`; item `{id, slug, title, brand:{slug,name}|null, image:{url,alt}|null (first media by position that has no option pair, else first media), publishedAt}`. No facets, no text search, no price (the price table does not exist yet).
3. `GET /store/products/:slug`: ACTIVE product by slug (draft/archived/unknown = 404 `not_found`):
   `{id, slug, title, description|null, brand|null, publishedAt, categories:[{id,slug,name}] (active with active ancestors only), attributes: <selectPublicAttributes of product-level attributes>, attributeDefinitions: <publicAttributeDefinitions of the product type's product-level attributes that are public>, options:[{id, code, name, values:[{id, code, name}]}] (only the values the product chose, ordered), variants:[{id, sku, optionValues:[{optionCode, valueCode}], attributes: <public variant-level attributes>}] (is_active only, ordered by position then sku), media:[{url, alt, optionValueId|null}] ordered}`.

## Hard rules (tested)

- Draft/archived products never appear in lists or detail.
- Inactive variants never appear.
- Inactive categories (or under an inactive ancestor) never appear anywhere, including in a product's `categories`.
- Attributes with `isInternal` or not `isVisibleOnStorefront` NEVER leave the API, in values or in definitions, even if the stored JSONB contains them. One central serializer in `apps/api/src/catalog/store/` uses core `selectPublicAttributes`/`publicAttributeDefinitions`; the filter is never re-implemented.
- No N+1 queries (options, variants, media and categories are batch loaded).
- Unknown locale gives 400; pagination bounds give 400.

## Implementation notes

- Code in `apps/api/src/catalog/store/` (module `StoreModule`, registered in `catalog/catalog.module.ts`); controllers without `AdminController`/AdminGuard; OpenAPI tag `store`; no auth.
- Read-only store repositories with the Drizzle query builder (admin repositories are write oriented).
- Rate limiting is out of scope (no dependency may be added); follow-up.
