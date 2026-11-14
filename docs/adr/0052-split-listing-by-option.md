# 0052. Split catalog listings by an option value

Status: Accepted (2026-11-14, owner approved all three open questions of the plan in chat: "Да на все").

Owner direction: 2026-11-14, option 2 (one card per visual option value). Detailed proposal and approval questions:
[split-listing plan](../plans/2026-11-14-split-listing-by-option.md). No implementation is included.

## Context

- Product owns content, slug, SEO, categories and reviews; Variant/SKU owns price, inventory and cart/order identity.
- `apps/api/src/database/schema/catalog.ts` assigns options to product types through `product_type_option`; products choose allowed
  options. No type-option assignment currently changes listing granularity.
- `packages/core/src/search/` builds one document per sellable variant (currently document version 3). Store search applies
  `distinct: productId` per request/federation, never index `distinctAttribute`; hydration collapses results by product id.
- `StoreService` builds a product-wide price range, image, availability and `defaultVariantId`. `cardDisplay` in
  `apps/storefront/src/lib/product-card-model.ts` offers add only for a single sellable variant, otherwise choose options.
- The owner wants colour/flavour/print to make separate cards, with size/grind/pack size remaining inside a card. The role of an option
  varies by product type; a hardcoded colour branch, a card picker and listing every SKU are rejected.
- Per-value pictures already exist: `media` references the product's chosen option value; admin media editing and product detail expose
  them. The product gallery prioritizes selected values. Only list image selection and group metadata are missing.
- Product-page preselection already uses `?opt.<optionCode>=<valueCode>` (`lib/variant-matcher.ts`), not search's `f=opt.<code>:<value>`.
- SQL fallback and home lists currently page products. ADR 0040's shared search cache uses product totals to bound page reads.

## Decision

### 1. One data-driven split axis

- Add `product_type_option.splits_listing`, boolean, not null, default false. At most one true option per type, enforced by a partial
  unique index on `product_type_id`, with service validation under the existing type-row lock. Different types can treat one option
  differently. The admin edits the flag in the product type's option-assignment dialog with existing catalog permissions.
- No flag or a product not choosing the designated axis means one product card. Otherwise one card represents each value used by a
  sellable variant. Zero stock retains a card; inactive or unpriced variants do not create one. Other options remain within the group.
- Preserve Product, Variant, media relationships and cart/order rules. No feature flag, environment variable or new dependency.

### 2. Listing identity and compatibility

- Add optional `groupBy=product|listing` to store list and search; default product preserves the existing public contract. The supplied
  storefront opts into listing for visible lists, including home and SQL fallback. Suggestions and sitemap remain product-level.
- Add `listingKey` and nullable `listingOption` (`optionCode`, `valueCode`, locale-resolved `optionName`, `valueName`) to summaries.
  Keep `id` as product id, `slug` as product slug and `title` unsuffixed. In listing mode, ids can repeat and keys cannot.
- Internal key encoding is product id alone, or `productId:optionCode:valueCode` for split cards. Codes are immutable and exclude the
  delimiter; API consumers treat keys as opaque. No labels, stock bits or representative variant ids determine identity.
- Listing-mode price range, availability and `defaultVariantId` concern the group's current sellable variants. One variant enables
  add if available; several require choose, even when a search filter matches just one. Filtered `match` stays separate and group-local.
- The storefront adds the translated value suffix to the title, uses the group image, keys cards by `listingKey`, and merges split
  preselection with matching non-split options in the product link. Product SEO/canonical URLs and cart variant ids stay unchanged.

### 3. Search remains one document per variant

- Every document carries `listingKey`; listing-mode distinct queries use that field, product mode still uses `productId`.
  Add the key to filterable/displayed/sortable settings, not searchable fields or facets; no index `distinctAttribute`.
- Bump document version 3 → 4 and rebuild/swap through the existing indexer. Before live v4 readiness, listing search returns
  `503 search_unavailable`, allowing catalog/category SQL fallback; legacy product searches continue during the rebuild.
  A build in flight resumes only when its recorded rebuild key (new `search_index_state.build_rebuild_key`) equals the current one;
  otherwise, including a build started before the upgrade, it restarts, so a v3 build can never go live labelled v4.
- Hydrate ordered listing references from current Postgres groups, batching reads by product id without collapsing sibling cards.
  Drop obsolete groups and enqueue stale products; never substitute another value or expose a stale engine price.
- Flag changes mark all products of the type via transactional `SEARCH_PORT.productsChangedWhere`, reason `option_changed`.
  Job 13 syncs documents; fan-out above 5 000 requests job 14's all-locale rebuild. Search-off writes nothing to search tables.
- Counted product-level facets count listing groups in listing mode using exhaustive distinct queries. Variant-level facets, including
  the split option, still use undistinct document queries for values and expose `count: null`. Keep disjunctive limits and undistinct
  price stats. The pinned v1.55.0 S1 tests must verify these semantics with the new key.
- Query/federation topology, ADR 0036 request costs, ADR 0037 retry and ADR 0038 forwarding remain unchanged. Per-request distinct and
  exhaustive paging requirements are supported by the [engine search reference](https://www.meilisearch.com/docs/reference/api/search/search-with-post);
  representative-facet details rely on `apps/api/src/spikes/search-s1.spec.ts` and require extended real-engine tests.

### 4. All list paths agree

- SQL enumerates/counts groups before pagination; TypeScript does not expand an already-paged product list. Preserve category/brand
  filters and bounded batched hydration. No SQL text search or facet implementation is added.
- Listing newest order is `publishedAt desc, productId desc, listingKey asc`, with equivalent SQL byte ordering. Equal price sorts gain
  deterministic product/key tie-breakers. Group image is first matching value image, else first general image, else placeholder.
- Shared cache keys include grouping; ADR 0040's limits, page-1 guard, forwarding and stale window remain. Home keeps its SQL read path.
- Migration 0014 includes a hand-written down file and exact journal-row deletion by `created_at`; privacy inventory classifies the
  new column as D24/no personal data. Existing rows remain false; existing seeded types are never overwritten.

## Supersedes in part; exact scope

- **ADR 0004:** supersedes in part the inherited interpretation of its catalog model as requiring one card per Product; refines the
  unnumbered **Draft entities / catalog** model with a listing projection. It contains **no grouping decision number**. Decisions 1
  (attributes), 2 (prices), 3 (inventory) and 4 (cart/orders) are unchanged; do not falsely attribute product distinct to decision 4.
- **ADR 0034:** supersedes in part decision **3** (`distinct: productId` for all result hits), **4** (product-count meaning for counted
  facets) and **10** (hydration keyed only by product id). These become grouping-mode dependent. Decision **2** keeps one document per
  variant and gains a field/version; decision **5**'s transactional coalescing queue is reused, not replaced.
- **ADR 0039:** supersedes in part decision **4**'s product-granularity SQL fallback: fallback now counts/pages listing groups when
  requested. Its fallback statuses, notice and deliberately reduced filter support remain. Its decision 5 is already superseded by 0040.
- **ADR 0040:** supersedes in part decision **1**'s product-based page bounds (now group totals for listing mode) and **5**'s two-field
  newest order (add group tie-breaker). Decisions 2–4's cache, forwarding and failure rules remain; cache identity gains grouping mode.
- ADR 0005's facet problem stays resolved as in 0034: exact variant/group option counts are not introduced. No old ADR is edited.

## AGENTS.md 2.3 wording change (approved by the owner, applied 2026-11-14)

- Replace “Catalog filters operate on variants and group results by product. Search runs through a search index, not ad-hoc SQL JOINs.”
  with: “Catalog filters operate on variants. Storefront listings group by product plus the value of the product type's single option
  marked `splits_listing`, or by product when none applies. Product-level API mode remains available for compatibility. Search runs
  through a search index, not ad-hoc SQL JOINs; the plain SQL list and fallback use the same listing groups.”
- Clarify the first Product bullet's parenthesis from “card, SEO, reviews, categories” to “content, SEO, reviews, categories;
  one or more listing cards”. This does not move purchasability from Variant to Product or to a listing card.
- Applied to AGENTS.md 2.3 in the same PR as this ADR's acceptance (PR 306).

## Consequences

- A visual option can produce several cards without duplicating products, SKUs, media uploads, URLs or commerce logic.
- At most one axis keeps cardinality understandable. Multi-axis splitting, exact variant-facet counts and merchandising are deferred.
- Additive fields plus opt-in grouping preserve old clients; changing API defaults later needs an explicit contract decision. API-first
  deployment is required because older servers reject `groupBy`; updated UI tolerates summaries without new fields.
- Reindexing, current-data hydration and cache expiry remain asynchronous. Totals/facets can temporarily disagree with hydrated items;
  no atomic DB/engine snapshot or immediate visibility after an admin save is promised.
- More cards increase reachable page counts within existing caps. Real-service paging, facet, stale-index, cost and migration tests are
  required by the plan before acceptance; this ADR records no new runtime verification.
