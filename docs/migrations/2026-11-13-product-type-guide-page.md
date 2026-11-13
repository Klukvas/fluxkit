# Fork note: the option guide page is chosen per product type (2026-11-13)

Plan `docs/plans/2026-11-13-product-type-guide-page.md`. Owner-approved schema change (migration `0013_product_type_option_guide_page`,
reversible) and additive API change (SemVer minor). No configuration variable or dependency change.

## What changed

| Before | After |
|---|---|
| Every product with options linked `productOptionGuide` (`size-guide`) next to its option pickers, a gift card with denominations too | A product with options links the page its PRODUCT TYPE names (`product_type.option_guide_page`, admin Product types, "Guide page"; store API `optionGuidePage`) while that page is enabled in `apps/storefront/src/config/shop-pages.ts` |
| `productOptionGuide` in `config/shop-pages.ts` was THE page (`"size-guide"`) | `productOptionGuide` is the FALLBACK for types that name no page; `null` upstream (no link) |

A type whose page is not enabled in the storefront gets no link (the fallback is not used for it). The API stores the slug only.

## What a fork does

- Run `pnpm db:migrate` (adds the nullable column; existing types get no guide page).
- **Already-deployed databases:** a database migrated or seeded before this change keeps ALL its product types without a guide
  page, and neither the migration nor `pnpm seed` / `pnpm seed:test` fills it (the seed runner never overwrites an existing type).
  So an apparel or shoe type LOSES its size guide link on the product page as soon as this change is deployed, until someone
  sets "Guide page" on that type in the admin (Product types, the type, "Guide page", e.g. `size-guide`, Save). The template's
  test server runs the coffee demo, whose types name no page: nothing to do there.
- Either set "Guide page" (for example `size-guide`) on the product types that need it in the admin (recommended: a gift card
  type then gets no size guide), or keep the old behaviour for every type without a page of its own by setting
  `export const productOptionGuide: ShopPageSlug | null = "size-guide";` in `apps/storefront/src/config/shop-pages.ts`.
- A fork that had already set `productOptionGuide` to its own value keeps that value; it now applies only to types without a page.
- Seed data: a fork's own presets can set `optionGuidePage` (`seeds/src/types.ts`); the seed runner never overwrites an existing type.

## Roll back

`apps/api/drizzle/0013_product_type_option_guide_page.down.sql` drops the column (the slugs set on types are lost); the storefront
then links the fallback only.
