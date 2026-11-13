# Plan: option guide page per product type (2026-11-13)

Owner report 2026-11-13: the product page links the size guide next to the option pickers of EVERY product with options (a gift card
with denominations too), because `productOptionGuide` in `apps/storefront/src/config/shop-pages.ts` is global and the storefront must not
read option codes (AGENTS 2.3). Design approved by the owner on 2026-11-13 (red zones approved: migration and public API change, additive).

## Goal

The product type says which shop page (if any) helps to choose between its options. The storefront links it only when the product's
type names a page that is enabled.

## Schema and API (additive, SemVer minor)

- Migration `0013_product_type_option_guide_page`: nullable `product_type.option_guide_page text`, CHECK slug pattern
  `^[a-z0-9]+(-[a-z0-9]+)*$` and at most 160 characters (same rule as other slugs), NULL allowed. Down script drops the column and its
  bookkeeping row. Not personal data (inventory `tables-no-personal-data.ts`).
- Admin: `optionGuidePage` (slug or `null`) optional in `POST /admin/product-types` and `PATCH /admin/product-types/{id}` (`null` clears),
  always in the product type response. Validated at the boundary with the core slug rule. The API does not know the storefront's pages,
  so it stores a slug only.
- Store: `GET /store/products/{slug}` gets `optionGuidePage: string | null` (the product type's value).
- `@fluxkit/api-client` types, `docs/api/openapi.json`, `docs/api/catalog.md`, `docs/contracts/api.md`.

## Storefront

- `optionGuideLink(locale, product.optionGuidePage)`: a link only when the value names a known AND enabled shop page; an unknown or
  disabled slug is ignored (no link, no error).
- `productOptionGuide` stays, as the FALLBACK for products whose type names no page; upstream default changes from `"size-guide"` to
  `null`. A fork that relied on "every product with options" either sets the guide page on its types (admin) or sets the fallback back
  to `"size-guide"` (fork note `docs/migrations/2026-11-13-product-type-guide-page.md`).

## Admin UI

Product type create and edit forms: optional "Guide page" text field (uk/en messages), empty = none; client check of the slug shape.

## Seeds

Test fixture `clothing` sets `size-guide` (keeps the e2e link on `demo-t-shirt`); coffee presets set none. The runner never overwrites an
existing type, so a database seeded before keeps no guide page (set it in the admin).

## Risks

- Parallel PR adds `defaultVariantId` to `ProductSummary`: conflicts in `openapi.json` and api-client types; keep this change minimal.
- Forks see the guide link disappear until they set a page on their types (fork note, CHANGELOG).

## Verification

Unit tests (schema validation, storefront link rule, admin form mapping), API integration tests against real Postgres/Redis/Meilisearch
(admin create/patch/clear, store detail field), migration up/down/up/down, `db:drift`, `openapi:export` freshness, build, lint,
format, typecheck, boundaries, check:env.
