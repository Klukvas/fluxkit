# Split catalog listings by an option value

Status: Approved by the owner on 2026-11-14 (all three open questions: "Да на все"). Next: step 1.

Owner input: 2026-11-14, option 2 (one card per visual option value). Architecture proposal: [ADR 0052](../adr/0052-split-listing-by-option.md).
Approval covers the schema (migration 0014 incl. `search_index_state.build_rebuild_key`), the opt-in `groupBy=listing` contract, ADR 0052 (Accepted) and the AGENTS.md 2.3 wording (applied in PR 306).

## Goal and scope

- Show one card per product + value of a designated option (colour, flavour, print); keep the other options inside that card.
- Keep Product as the SEO/content/category entity and Variant as the purchasable unit. No card-level picker and no flat SKU listing.
- This is core catalog behaviour configured by data on a product type's option assignment, not a feature package or environment flag.
- Implement no payments, auth, cart, checkout, stock mutation, unrelated cleanup or new dependency. Do not edit old ADRs.

## What exists today (verified in this checkout)

| Area | Existing implementation and reuse |
|---|---|
| Schema | `apps/api/src/database/schema/catalog.ts`: `productTypeOption` has `productTypeId`, `optionId`, `position`, `createdAt`; no listing flag. Products choose a subset of the type's allowed options. |
| Search documents | `packages/core/src/search/document.ts`, `fields.ts`, `settings.ts`, `limits.ts`: one document per sellable variant, `id` = variant id, `productId` copied to each; current `SEARCH_DOCUMENT_VERSION` is **3**, not ADR 0040's historical 2. |
| Grouping | `apps/api/src/search/store/store-search.service.ts`, `StoreSearchService.run`: hits and counted facet queries use request `distinct: "productId"` (at federation level for multiple text queries). No index `distinctAttribute`; variant-facet queries omit distinct. `uniqueProductIds` then deduplicates hits again. |
| Hydration | `StoreService.listItemsByIds` / `toListItems` in `apps/api/src/catalog/store/store.service.ts` hydrate current Postgres facts, keyed by product id. `defaultVariantIdOf` returns an id only for exactly one sellable variant, regardless of stock. `store-pricing.ts` provides `priceVariants` and `summarizeProduct`. |
| Filtered offers | `apps/api/src/search/store/search-match.ts`, `matchOfProduct`: current variants matching facet/price selection; best availability, then cheapest, then variant order. `match` does not test text terms. `lib/search-facets.ts` in the storefront turns it into `cardOffer`. |
| Cards | `apps/storefront/src/lib/product-card-model.ts`, `cardDisplay`: price, availability and purchase action; one variant gives add, several give choose, unavailable gives neither. `components/product-grid.tsx` keys rows by `card.id` (currently product id). Both card kinds use this model. |
| Product link | `apps/storefront/src/app/[locale]/(catalog)/p/[slug]/page.tsx` calls `selectionFromParams`; `lib/variant-matcher.ts` reads **`?opt.color=red&opt.size=m`**, not a facet expression. Facets instead use repeated `f=opt.color:red`. `initialSelection` honours all valid preferred codes together; invalid, repeated or obsolete selections fall back. |
| Media | `media.option_id` / `option_value_id` are nullable together; composite FK references `product_option_value(product_id, option_id, option_value_id)`. No new media relationship is needed. |
| Media API/admin | `ProductsService.putMedia` in `catalog/admin/products/products.service.ts` validates chosen pairs; `PUT /admin/products/{id}/media` accepts both ids. Admin product detail exposes them; `apps/admin/src/areas/products/tabs/media-tab.tsx` and `media-list.ts` already edit the link. |
| Media storefront | Store detail exposes `media[].optionValueId`, excludes values without sellable variants; `lib/product-media.ts`, `galleryFor`, prioritizes selected values. Lists instead call `pickListImage`: first general image, else first of any kind. Lists lack split metadata and per-group image selection. |
| SQL lists | `StoreRepository.listProducts` in `catalog/store/store.repository.ts` pages/counts active **products** with an active shop-priced variant; category subtree and brand filters, order `published_at desc, id desc`. `StoreService.toListItems` aggregates the whole product, in batched reads. Search-off and outage fallback use this endpoint. |
| Home/shared lists | Home `loadProductRow` in `apps/storefront/src/lib/home-data.ts` calls SQL `StoreData.listProducts`, even with search on. Catalog/category plain search lists use `catalog-search-data.ts`, `search-data.ts`, `shared-search-cache.ts`: ADR 0040's per-process 500-entry cache, 60 s fresh, 5 more minutes stale on eligible errors, shared page-1 bounds check. These are distinct read paths. |
| Admin type editor | `apps/admin/src/areas/catalog-dictionaries/product-types-page.tsx` composes `OptionAssignmentsSection` / `OptionAssignmentDialog` from `product-type-assignments.tsx`; `dictionary-forms.ts` constructs the assignment body. Currently only position is editable. |
| Seeds | `seeds/src/types.ts`: `SeedMedia.optionValue` already supports per-value pictures. `apps/api/src/seed/catalog-seeder.ts` maps codes to ids and uses real admin services; `ensureProductType` sends only position to `putOption`. Coffee `product-builder.ts` does not carry option links on its `extraImages`. |
| Demo vs fixture | `pnpm seed` uses `seeds/src/coffee/`; `pnpm seed:test` uses `seeds/src/test-fixture/` (API/e2e/matrix). Coffee has no colour option: `ware_color` and `syrup_flavour` are product attributes; syrup flavours are separate products. The fixture already has clothing `color` + `size` and linked images. |
| Numbering | `docs/adr/README.md` ends at 0051; 0052 is free. Core migration journal ends at `0013_product_type_option_guide_page`; next is 0014 if still free at implementation time. Blog feature migrations have their own sequence. |

## Decided in plan: data and validation (subject to overall approval)

- Add `product_type_option.splits_listing boolean NOT NULL DEFAULT false` (Drizzle `splitsListing`). The same option may split one type and remain ordinary on another.
- Recommend **at most one** true assignment per type. Several axes produce a Cartesian explosion and another SKU-like listing policy, beyond the owner's option 2. A later ADR can extend it.
- Backstop with partial unique index `product_type_one_split_option_idx` on `product_type_id` where `splits_listing = true`.
  All pre-existing rows receive false, so the new index has no pre-existing true duplicates; do not deduplicate or delete catalog rows.
- Extend `ProductTypesService.putOption`, repository assignment reads/writes, mapper and Zod schemas under `apps/api/src/catalog/admin/product-types/`.
  Retain the existing type-row `FOR UPDATE` lock, check for a different true assignment, and return `409 rule_violation` with reason
  `split_option_already_set` on `splitsListing`. Translate the named unique-index violation to the same error under concurrency.
- Optional `splitsListing` in `PUT /admin/product-types/{id}/options/{optionId}`: omitted on create means false; omitted on update preserves
  the stored value, so an older position editor cannot silently turn splitting off. Assignment responses include the boolean.
- Do not automatically clear another option. The admin unchecks/saves the old one before checking/saving the new one; the intermediate
  state is a valid unsplit catalog. Permission remains `catalog.write`; reads remain `catalog.read`.
- A product that does not choose its type's split option remains one ordinary card. A chosen split option with one sellable value yields
  one split card. Only values used by sellable variants create groups; out-of-stock priced active variants remain sellable (existing rule).
- Reuse existing option-coverage validation. A chosen axis with a variant missing its value is corrupt data: fail validation/build visibly,
  do not create a misleading unsplit group. Stock zero does not remove a group; no active priced variant does.
- Implementation migration: generate `apps/api/drizzle/0014_split_listing.sql` and metadata from the schema; hand-write
  `0014_split_listing.down.sql`. Down drops the partial index then column, and deletes ONLY its row from
  `drizzle.__drizzle_migrations`, keyed by `created_at` = its exact `meta/_journal.json` entry's `when` (do not reuse 0013's timestamp).
  Down loses saved listing choices, not products, media or variants. Test up → down → up → down on a dedicated `_test` database.
- Classify `splits_listing` as **D24 / no personal data** in `apps/api/src/privacy/inventory/tables-no-personal-data.ts` and
  `docs/privacy/data-inventory.md`; run inventory/schema coverage guards. No new personal data, event payload or external processor.

## Decided in plan: grouping and public API

- Add optional `groupBy=product|listing` to `GET /store/products` and `GET /store/search`; absent means `product` (today's behaviour).
  The supplied storefront always requests `listing` for visible product lists. This preserves older consumers, product-level totals and
  product-wide `defaultVariantId`; merely adding fields while changing duplicate-id semantics would not be backward compatible.
- Proposed additive `ProductSummary` fields in `packages/api-client/src/types.ts` and store/search response schemas:

| Field | Meaning |
|---|---|
| `id`, `slug`, `title` | Remain product identity, product slug and unsuffixed product title. Repeated `id` is allowed only in listing mode. |
| `listingKey` | Opaque card identity: product id for an unsplit/product-mode card; `productId:optionCode:valueCode` for a split group. Codes are immutable and cannot contain `:`; no translated labels in the key. |
| `listingOption` | Null for unsplit/product mode; otherwise `{optionCode, valueCode, optionName, valueName}` with locale-resolved names. IDs for media matching stay internal to the hydrator. |
| `price`, `availability` | In listing mode: range and best availability across all current sellable variants **in the group**; product mode keeps current aggregation. |
| `defaultVariantId` | In listing mode: the group's only sellable variant, or null for several; never `variant.is_default`, never an arbitrary representative id. Out-of-stock keeps its id; UI still blocks add. |
| `match` (search only) | Existing optional field; matching variants are now restricted to this group AND the variant selection. Its representative rule stays availability → price → position/id; null means catching up. |

- Return `listingKey` and nullable `listingOption` on updated API summaries; updated storefront accepts their absence from an older
  summary as product mode (`listingKey ?? id`). Add optional request types in `packages/api-client/src/operations.ts` and serialization
  in `client.ts` as needed. Old servers reject the new query parameter: deploy the API before switching storefront requests.
- No generic new `variantId` on a summary: `defaultVariantId` authorizes the one-variant add; `match.variantId` is the filtered
  representative and must not authorize direct add for a multi-variant group. Detail and suggest response shapes stay unchanged.
- Keep range computation and availability on the server using existing pricing rules; no new price adjustment or browser arithmetic.
  A filter can narrow `match` to one size while `defaultVariantId` remains null because the group still has several sellable sizes.
- `total` / `pageCount` in listing mode count groups, not products or variants; SQL `limit` / `offset` also count groups.
  Unknown `groupBy` is `400 invalid_value`; preserve existing paging caps, response envelopes and locale fallback.
- Update `docs/api/catalog.md`, `docs/api/search.md`, `docs/contracts/api.md`, `docs/contracts/search.md`,
  `docs/contracts/card-registry.md`; regenerate `docs/api/openapi.json` with `pnpm openapi:export` and extend api-client contract tests.
  This opt-in proposal is additive/minor under section 17. Changing the default to listing is a separate contract decision (question 2).

## Decided in plan: search documents, feed and counts

- Add pure grouping rules in `packages/core/src/catalog/listing.ts` (planned): derive key and partition eligible variants without niche
  names. Use them in document building and store hydration; SQL equivalent is checked against the same fixtures.
- Add `listingKey` to each variant document in `packages/core/src/search/document.ts` / filter document types; keep `id = variantId`.
  Extend `SearchDefinitions` / `readSearchDefinitions` / `buildContextFor` in `apps/api/src/search/indexer/search-catalog.reader.ts`
  with split-option assignments **by product type**, not just the global `typeOptionCodes` set.
- Add `listingKey` to fixed filterable, displayed and sortable fields in `fields.ts` / `settings.ts`; do not make it a facet or searchable
  text. Bump `SEARCH_DOCUMENT_VERSION` **3 → 4**, triggering job 14's rebuild and atomic locale swap. No `distinctAttribute` setting.
- In `StoreSearchService.run`, all queries whose plan has `distinct: true` use `listingKey` in listing mode, `productId` in product mode,
  including federation distinct. Undistinct variant/price queries remain undistinct. Retrieve `productId` AND `listingKey` on hits.
- Replace `uniqueProductIds` only for listing hits with ordered unique **listing references**; deduplicate product ids for batched reads,
  then hydrate each reference in hit order. Add a group-aware StoreService entry point instead of changing product-mode
  `listItemsByIds` into an expansion that invents hits. Never collapse two colours back into one product.
- Hydration rechecks current split assignment, value membership, visibility and sellability from batched Postgres reads (not solely the
  30 s search-definition cache). Restrict `matchOfProduct` to the reference's group. Drop an obsolete/missing group and enqueue its
  product with `stale_hit`; keep the existing neutral `match: null` state when its group survives but no variant fits the filter anymore.
  Never substitute a different colour, return engine prices or fill the page with extra engine requests.
- On changed `splitsListing` (including disabling), `ProductTypesService.putOption` calls `SEARCH_PORT.productsChangedWhere` LAST
  in its transaction with all product ids of that type, reason `option_changed` (existing sync reason). Do the same on removal of a
  true assignment if removal is allowed. No domain event, BullMQ worker or search import in catalog code is needed.
- Existing `SearchQueue` batches/coalesces up to 5 000 products; above that it requests all-locale rebuild through `search_index_state`.
  Job **13** `sync-search-index` rewrites affected variant docs; job **14** `rebuild-search-index` rebuilds/swaps above the threshold.
  These are current job numbers (ADR 0034's original numbers predate privacy). Rollback never publishes a queue mark; search-off's port
  remains a no-op. Enabling search later builds current flags. A flag change is asynchronous, not a settings-only update.
- Read split assignments after queue claims with the current product facts, not from an earlier cached definition snapshot. A sync
  must not consume a newly queued flag change using the previous flag. Test that race and a flag change during a running rebuild;
  queue sequence guards and post-swap draining must retain/reapply the later change.
- Upgrade safety: listing-mode search returns `503 search_unavailable` until the locale's live `document_version >= 4` and live fields
  support `listingKey`. Check the existing state/settings metadata; do not infer readiness from settings alone or silently use product
  distinct. Product-mode reads keep working during rebuild; catalog/category listing-mode reads use the existing SQL fallback.
- Inherited builds (QA finding M1, verified): `decideIndexAction` (`packages/core/src/search/indexing.ts:142`) returns
  `continue_build` for any unexpired build BEFORE comparing document versions, and the swap stamps the current
  `SEARCH_DOCUMENT_VERSION` (`search-indexer.ts`); `search_index_state` stores no build version. A v3 build paused before deployment
  would resume and go live as mixed v3/v4 documents labelled v4, passing the readiness gate. Decided: migration 0014 also adds
  `search_index_state.build_rebuild_key text NULL` (written when a build starts); `decideIndexAction` continues a build only when it
  equals the derived rebuild key, otherwise returns `rebuild` with new cause `stale_build` (null = a pre-0014 build, restarted). The
  abandoned build index is deleted like an expired one. Regression: pause a v3 build after one page, upgrade, run the indexer, assert
  every live document carries `listingKey`. This is a latent pre-existing gap for any version or currency change; fixed in step 2
  because this plan is the first to rely on it. Classify the column as no personal data.
- Changing flags on an already-v4 index follows existing queue consistency: temporarily short/stale pages and engine totals are possible
  until sync/rebuild and cache expiry. Do not promise snapshot consistency between engine counts and Postgres hydration.
- Stable newest order becomes `publishedAt desc, productId desc, listingKey asc`, matched in SQL with byte-order code sorting
  (`COLLATE "C"`). Add `productId desc, listingKey asc` tie-breakers to equal engine prices in listing mode; relevance ranking stays.

### Facet semantics and request cost

- Meilisearch returns one ranked document per distinct key; the key must be filterable. Exhaustive totals use `page` / `hitsPerPage`.
  Sources checked 2026-11-14: [distinct documentation](https://www.meilisearch.com/docs/capabilities/full_text_search/how_to/configure_distinct_attribute),
  [search reference](https://www.meilisearch.com/docs/reference/api/search/search-with-post).
- Counts must retain the pinned v1.55.0 behaviour in `apps/api/src/spikes/search-s1.spec.ts` (E3/E4), not assume current docs establish
  every facet detail: distinct + exhaustive pagination counts representatives; undistinct counts documents. Product-level fields are
  constant within a listing group, so counted brand/category/product-attribute facets count **listing groups** in listing mode.
- Keep up to 3 disjunctive product-facet queries; further selected groups retain main-query counts (not a new promise of full
  disjunctive counts). Variant facets, **including the split option**, remain undistinct values with `count: null`: a global colour
  option may split some types and remain inside others. Representative-only size counts would lose sizes; raw counts would inflate them.
- Price min/max still come from undistinct matching variant documents, not just representatives. Filters still intersect on the same SKU.
  Add engine tests with two colours × two sizes, plus an unsplit type sharing the same option, before relying on the new key.
- ADR 0036 request count is unchanged: browse 1, browse with 8 groups 1, English/one-text-query 1 per pass (2 with retry), Ukrainian
  typical 2, worst tested relaxed request with 8 groups 20. Keep ADR 0037 retry, ADR 0038 forwarding and lane admission unchanged.
  Add the grouping readiness check to existing bounded metadata reads, never one engine call per card or group.

## Decided in plan: SQL fallback, storefront and admin

- Add listing-mode SQL page/count in `StoreRepository.listProducts`: enumerate eligible product/value groups BEFORE applying offset and
  limit, using active shop-priced variants and the optional split assignment. Products lacking the chosen axis use one base group.
  Count that same relation, with existing category-subtree/brand predicates. Do not page products and then expand them in TypeScript.
- Batch-load group variant membership, split labels, media and stock in StoreService; reuse `priceVariants` / `summarizeProduct` on each
  group's members. Fixed statement count per page; no SQL text search or general facet engine. Legacy product mode stays unchanged.
- Group picture: first media for the exact split option/value in `(position, id)` order, else first **general** image, else null/placeholder.
  Never fall through to another value's photo on a split card. Unsplit cards keep `pickListImage`'s existing rule. Media schema/admin
  linking/detail gallery need no new feature; only the list hydrator is missing this selection policy.
- In `lib/product-card-model.ts`, add `listingKey` to `ProductCardModel`, retain `id` as product id. Change `components/product-grid.tsx`
  row keys to `card.listingKey`; audit slots/fork examples for assumptions of one model per product. Do not edit fork-owned `cards/custom.ts`.
- Compose card title via a new uk/en message (e.g. `catalog.card.splitTitle`, `{title} — {value}`); base API title and product SEO title
  stay unchanged. Value names use API locale fallback; accessible link/action names include the displayed suffix.
- Compose `href` with `URLSearchParams`, using split `opt.<optionCode>=<valueCode>` even on unfiltered lists. Merge a valid `match`'s
  option values for size/etc.; the split value is authoritative. A catching-up card retains its split link and has no purchase action.
  Pass that same href through the no-JS/unhydrated add-link path (`components/cards/card-purchase.tsx`, `card-add-button.tsx`).
- Existing product-page `selectionFromParams` / `initialSelection`, language-switch selection and `galleryFor` handle the link.
  Test a split axis that is NOT the first picker and a combination with gaps; keep canonical/hreflang at `/p/{slug}`. Sitemap stays
  product mode: one URL per product, never one per card. No new indexable product route or cart line identity.
- `apps/storefront/src/lib/search-data.ts` opts visible search/catalog reads into listing mode; `catalog-data.ts` and `home-data.ts`
  opt SQL reads in. Thread types through `store-data.ts` and the api-client. Do not change every `listProducts` call globally:
  sitemap reads remain product mode, home limits count cards, and fallback requests preserve their existing filter-loss notice.
- Include grouping mode in search, SQL, last-good and shared-cache keys. Preserve ADR 0040's page-1 guard, bounded LRU, forwarding
  on misses, 60 s fresh / 5 min stale-on-error, and no caching of failures. Home SQL lists keep their existing cache path.
- Admin: add a labelled `splitsListing` checkbox in `OptionAssignmentDialog`, a visible assignment-table indicator and uk/en help:
  separate cards per value, only one option per type, affects every product of the type, search updates asynchronously. Initialize it
  from the row, preserve it in `optionAssignmentBody`, show server conflicts at the control; read-only roles see no write control.
  Existing product Media tab remains where pictures are assigned; add a help cross-reference, not a second image editor.

## Decided in plan: seeds

- Preserve existing coffee products/slugs and their attribute meaning; do not turn `syrup_flavour` or `ware_color` into a variant axis.
  Add one neutral demo type/product in `seeds/src/coffee/{dictionaries,presets,products-food}.ts`: `demo_flavoured_syrup`, option
  `demo_flavour` = vanilla/caramel, ordinary `volume` = two existing values. Four variants, unequal prices and own linked value images;
  no real brand, domain or client data. Reuse neutral existing assets where suitable; picture production is a later implementation task.
- Extend `SeedProductType` with optional `splitListingOptionCode` (must be in `optionCodes`); `CatalogSeeder.ensureProductType` passes
  `splitsListing: true` only for that assignment on creation. Omitted is all false. Keep the seed's no-overwrite/idempotence rule.
- Extend `CoffeeProductSpec.extraImages` with optional `optionValue` and carry it through `coffeeProduct`, or supply explicit linked
  `SeedMedia` for this one product; choose the former to reuse the existing builder. Runner already resolves these links to ids.
- In the test fixture, set clothing's split code to `color`; reuse existing colour/size products and linked images. Update only
  assertions that intentionally exercise listing mode; product-mode API expectations remain unchanged. Tests create isolated cases
  for a one-variant split group, missing image and a type sharing the option without splitting.
- Update `seeds/README.md`, `datasets.spec.ts`, dataset specs and `apps/api/src/seed/{seed,seed-coffee}.spec.ts`.
  Existing databases keep old flags; document manual admin activation, never overwrite a shop's types on a second seed.

## Verification to implement (not run by this planning task)

| Layer | Required evidence |
|---|---|
| Core unit | One/no split option; type-local assignment; deterministic collision-free keys; variants partition exactly once; one value, missing chosen axis, corrupt coverage, inactive/unpriced and out-of-stock variants; document allowlist/settings/version. Group price-range rules use money TDD with failing-then-passing evidence (unequal/zero prices, currency and invalid-price exclusion). |
| DB/API integration | Real Postgres/Redis/Meilisearch; migration cycle and journal removal; default false on existing assignments, partial-index concurrency, omitted-field preservation, existing permissions; product/listing contract modes; group count/page boundaries, no duplicates/omissions, image fallback, variant count/defaultVariantId, fresh price/availability, fixed batched query count. |
| Engine integration | Extend S1 and store-search specs: group totals, facet representative vs document semantics, disjunction, price stats, same-SKU intersections, strict/relaxed federation, equal timestamps and prices; current request-cost assertions unchanged. Toggle flag with transaction rollback, queue fan-out/rebuild, sync in flight, stale group and version-3 upgrade. |
| Storefront unit | `product-card-model`, `search-facets`, `variant-matcher`, product-grid, home-data, catalog-search-data and cache tests: suffix, image, merged preselection, repeated product ids with distinct keys, add vs choose, unavailable/catching-up, old summary without fields, no-JS href, page-1 guard and fallback. |
| E2E | Admin toggles one assignment and links value images; storefront sees two cards, each opens its value/gallery, size stays inside; one-variant group adds correct variant, multi-size group chooses. Check grid/list, home/category/search, uk/en, keyboard and no-JS; sitemap contains each product once. |
| Matrix | Extend `scripts/feature-matrix.sh` `search-on` to reindex and assert split cards/filters; `search-off` asserts identical SQL group identities/counts and zero search-table writes. Keep feature on/off/deleted boundary checks green: catalog never imports an optional feature. |

- Implementation commands (confirmed in root `package.json`): `pnpm lint`, `pnpm format:check`, `pnpm typecheck`,
  `pnpm check:boundaries`, `pnpm check:env`, `pnpm test`, `pnpm test:e2e`, `pnpm feature-matrix search-on`,
  `pnpm feature-matrix search-off`, `pnpm check:docs`. Use Node 22/pnpm 10.28.0 and real `_test` service URLs; report missing services
  as not verified. Run targeted package checks per PR; no fake passing scripts or snapshot weakening.
- UI PR: run visual comparison via `bash scripts/visual-compare.sh <base-ref>`; unchanged all-false catalog is the regression baseline.
  Split-demo differences require scoped review. Do not automatically regenerate frozen screenshots/markup to hide differences.
- Each implementation PR updates relevant `docs/files/{api,core,storefront,admin,seeds}.md` entries if responsibilities/files change,
  `CHANGELOG.md` for schema/user-visible behaviour, and `docs/HANDOFF.md` with accurate approval/completion state.
  Add a fork/upgrade note under `docs/migrations/`; no new `.env.example` field is needed. ADR 0052 accepted on 2026-11-14.

## PR-sized implementation steps (every PR independently green)

| Step | Owned scope | Green/rollout boundary |
|---|---|---|
| 0. Approval (done 2026-11-14) | This plan, ADR 0052 and its index row, AGENTS.md 2.3 wording (PR 306) | Owner answered yes to all questions below. |
| 1. Data/admin contract | Schema + 0014 up/down/metadata, inventory, product-type assignment API/client, pure grouping rules, transactional search marks and tests/docs | Defaults all false; no admin control or demo activation yet; existing store behaviour unchanged. |
| 2. Store/search capability | Group-aware SQL/hydration, optional `groupBy`, summary fields, document v4/settings/indexer, search matching/readiness, contracts/OpenAPI and real-service tests | Product mode remains default; old storefront remains valid. New listing search uses 503/fallback until rebuild; verify real v3 → v4 transition. |
| 3. Storefront consumer | Card model/keys/links, all visible list reads and caches, home/fallback, messages, unit/e2e/visual and fork docs | Deploy after step 2; all-false data renders the old catalog. Exercise splitting with isolated test-created assignments. |
| 4. Admin and demo activation | Type-assignment checkbox/help, coffee demo and test fixture, seed runner/types, matrix assertions, final e2e/docs | All consumers support splitting before it becomes an editor control/demo default. Existing seeds still do not overwrite saved flags. |

## Risks and limits

- Search remains eventually consistent. Flag/variant edits can temporarily change counts, shorten pages or leave cached old cards;
  definition caches add 30 s, shared good lists may survive eligible errors for 6 minutes. Current cart/checkout still revalidate facts.
- More groups mean more pages within the unchanged 10 000-hit cap; no extra variant documents, but grouping cardinality and memory/latency
  change. Measure page/count queries and engine p95 on a mixed catalog; existing deep-page and rebuild-speed gaps are not solved here.
- Code-based keys remain stable across label edits; deletion/replacement changes them. Keep keys opaque to clients and use safe maps for
  arbitrary valid option codes (including `constructor`); no object-prototype lookup or raw query-string concatenation.
- API-first deployment is required for `groupBy`; downgrade API/storefront code before applying down, then rebuild search with the old
  document rules. Do not run old/new indexer versions concurrently against one live index. A DB rollback alone does not restore indexes.
- Missing value images use the general image/placeholder; splitting does not imply every variant needs a duplicate media upload.

## Owner questions (all answered yes, 2026-11-14)

1. Approve **one split option per product type**, the default-false column, partial unique index and reversible 0014 migration
   (which also adds `search_index_state.build_rebuild_key`, see "Inherited builds")?
   Recommendation: yes; several split axes need a separate design. Approving this plan is the schema red-zone approval.
2. Approve **opt-in `groupBy=listing`** on the two store list/search endpoints, with product mode as the API default and the supplied
   storefront opting in? Recommendation: yes, additive/minor. Making listing the API default changes identity/count semantics and needs
   an explicit pre-release contract reset or, after release, a major version and migration guide; do not call that additive.
3. Approve ADR 0052 and the proposed AGENTS.md 2.3 wording (quoted in the ADR), including counted facets measuring cards in listing mode?
   The owner/orchestrator applies that policy edit separately; this task does not edit AGENTS.md.

## Planning review

- Sources checked: canonical `Desktop/Projects/AGENTS.md`, project `AGENTS.md`, `CLAUDE.md`, `docs/AGENT_WORKFLOW.md`, HANDOFF sections
  1–3, storefront `AGENTS.md`, `~/.claude/rules/common/*` and TypeScript rules for inspected code. Canonical direct-documentation
  path permits these prose edits/self-review; no executor dispatch or independent implementation QA is claimed.
- Conflict recorded: ADR 0004 has **no numbered grouping decision** (its decisions 1–4 concern attributes, prices, inventory, cart/orders).
  ADR 0052 refines its catalog model in part; exact grouping supersession references are ADR 0034 decisions 3/4/10, ADR 0039 decision 4
  and ADR 0040 decisions 1/5. No historical ADR or owner-managed policy is rewritten.
- Roles: Architect = `codex exec` run (wrote this plan and ADR 0052); QA = a separate read-only `codex exec` run. QA verdict:
  "approve with fixes", one major finding (M1, inherited v3 build passing the v4 gate), fixed above under "Inherited builds".
- Only this plan, the proposed ADR and its index row belong to this task. No code, migration, generated artifact, commit, push, external
  write or next task is authorized or started. Implementation checks above are future acceptance requirements, not reported results.
