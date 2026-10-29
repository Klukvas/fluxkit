# 0034. Catalog search

Status: accepted 2026-10-29 under the owner's standing instruction to take the recommended options (`docs/plans/2026-10-29-search.md`, section "Owner answers"). It resolves the two open decisions of ADR 0005 (Ukrainian morphology, variant-level facet counts); ADR 0005 itself is not edited. Two items were marked CONFIRM; the orchestrator confirmed both on 2026-10-29 under the owner's standing instruction (the amended morphology bar with the `нозі` exception covered by a demo synonym; the vendored BSD-3 Snowball code, licence allowed by AGENTS.md section 16): the amended acceptance of the morphology bar (decision 6) and the vendoring of the Snowball code (decision 7).

Builds on ADR 0002 (Meilisearch, fed from Postgres), 0004 (search through an index, outbox for "needs reindex"), 0005 (spike findings), 0006 (catalog schema, attribute flags, page limits), 0007 (the store offers only values some sellable variant uses), 0011 and 0012 (one shop currency, availability), 0018, 0021 and 0025 (scheduler, bounded jobs, leases), 0026 and 0027 (storefront and admin architecture), 0031 (a dedicated queue table instead of `domain_event`). It refines ADR 0004 decision 4 for search: the feed is a coalescing queue table, not the event outbox.

Nothing described under Decision is built yet except the pure core rules of plan step 3 (filter, query, document, settings, facets, sort, stemmers). Engine facts carry the S1 numbers of the plan (section "Spike S1 results", E1 to E12), pinned by `apps/api/src/spikes/search-s1.spec.ts` against Meilisearch v1.55.0.

## Context

- No search code exists. The catalog list `GET /store/products` has one fixed order and no text query, filters or facets (ADR 0006, plan "Existing functionality").
- Meilisearch has no stemming or lemmatization for any language (M6); typo tolerance covers regular endings only. On a synthetic corpus of 320 Ukrainian titles it finds 76.7% of the relevant products for inflected queries (plan, S1).
- `distinct` (one hit per product) is applied lazily by the engine: facet counts are exact only on the exhaustive `page`/`hitsPerPage` path (E3); variant-level facets lose values with distinct (E4); an index-level `distinctAttribute` cannot be switched off per request (E1).
- Catalog, price and stock writes are spread over many repositories; the change feed must commit with the change (ADR 0004).

## Decision

### 1. Boundaries
- **Search is core with a configuration switch**, not a feature package: ADR 0002 decides the engine, ADR 0004 requires search through an index, and the queue writes sit inside core catalog, price and stock transactions (AGENTS.md 2.1). `SEARCH_ENABLED=false` gives no client, no routes (`404`), no queue writes, no jobs and `search: false` in both config routes.
- Pure rules in `packages/core/src/search/` (no I/O, TDD): query normalization, the stemmers, the safe filter builder, the search document builder, the index settings derivation and its hash, the facet plan and the sort mapping. The engine client, queue, indexer, routes and jobs live in `apps/api/src/search/`, the UI in `apps/storefront` and `apps/admin`. The `meilisearch` package stays out of core (dependency-cruiser).
- The engine is never reachable from browsers. All search goes through `/store/search*`; the browser never receives an engine URL or key.

### 2. Index layout
- **One index per locale** (`<MEILI_INDEX_PREFIX>catalog_<locale>`), **one document per sellable variant**, primary key `id` = variant id. Texts are resolved with the catalog fallback (requested locale, default locale, first) when the document is built.
- A product without a sellable variant (not `active`, or no active variant priced in `SHOP_CURRENCY`; the same rule as core `isVariantSellable`) has no documents.
- Fields (public data only): `id`, `productId`, `title`, `brandName`, `sku`, `optionLabels[]`, `categoryNames[]`, `attributeText[]`, `description` (cut to 2 000 characters), `stems[]` (Snowball stems), `stems5[]` (5-letter prefixes), `brand`, `categories[]` (ids with ancestors), `opt_<optionCode>`, `attr_<attributeCode>` (public `is_filterable` attributes), `price` (minor units in `SHOP_CURRENCY`), `inStock`, `publishedAt` (epoch seconds), `productSlug`. `displayedAttributes` is `id`, `productId`, `productSlug`, `title` only.
- **Never in the index:** internal or hidden attributes (`isPublicAttribute` is the one place that decides), barcodes, quantities, costs, drafts, inactive or unpriced variants, other currencies, compare-at prices, media. The builder is the guarantee; a marker-string test scans documents, settings and every response (plan section 11).
- **Settings are derived** from the definitions by core and hashed together with `SEARCH_DOCUMENT_VERSION`, `SHOP_CURRENCY` and the locale. A different hash of the filterable, sortable or synonym part updates the live index in place; a different document version or currency triggers a rebuild. `searchableAttributes` order: `title`, `brandName`, `sku`, `optionLabels`, `categoryNames`, `attributeText`, `stems`, `stems5`, `description`. Typo tolerance is off on `sku`, `stems`, `stems5` and on numbers. `distinctAttribute` is NOT set (E1); `pagination.maxTotalHits` 10 000.

### 3. Query strategy
- **Results page:** words are normalized (NFC, lower case, apostrophe variants to one form, whitespace collapsed, at most 200 characters and 10 words) and sent with a **trailing space** so the last word is not prefix-matched (E8). One federated multi-search with `distinct: productId`, exhaustive `page`/`hitsPerPage`, `matchingStrategy: all` and up to three queries: the original words on the text fields, the Snowball stems on `stems`, the 5-letter prefixes on `stems5` (no stems queries when the words have no Cyrillic or English letters).
- **If the federation finds nothing and the query has two or more words**, the same federation runs once more with `matchingStrategy: last` and the response says `relaxed: true` (the page tells the shopper these are partial matches). One retry at most.
- **Suggest:** the text as typed on the text fields only (no stems, no trailing space), `limit: 6`, products only (measured: stemming a half-typed word lowers precision, plan S1).
- The Meilisearch filter string is built only by core `buildSearchFilter` from typed selections, every value quoted and escaped.

### 4. Facets and counts (resolves ADR 0005 decision 2)
- **Exact product counts for product-level facets** (`brand`, `category`, `attr_*` of product level): `facets` on the hits query with distinct; disjunctive behaviour by one extra query per selected group without that group's filter, `distinct` with `page: 1, hitsPerPage: 0` (never `limit` 0 or 1: E3). At most **3 disjunctive queries** per request (measured p95 112 ms at 50 000 documents per locale); further selected groups show the counts of the main query.
- **Variant-level facets** (`opt_*`, variant-level `attr_*`, `inStock`) list their values from a query WITHOUT distinct and `limit: 0` (cheap, E4) and carry `count: null`: the storefront shows no number. Exact variant counts per product (computed in Postgres) are a later plan.
- Filters on variant fields apply to the same variant document (E7); with sort `price` the representative of a product is its cheapest matching variant.
- `price` facet: `facetStats` min and max. Only values with matches are listed, at most 20 facets, in the order of the definitions.
- Facet values are codes; labels are resolved per request from the definitions (a label change needs no reindex).

### 5. Indexing pipeline
- **Dedicated coalescing queue `search_sync_queue`**, one row per product id (no foreign key: a deleted product must still be removed from the index), written in the SAME transaction as every change that can alter a document (catalog, categories, options, prices of `SHOP_CURRENCY`, stock movements and reservations; fan-out writers enqueue their products in batches, above 5 000 products they request a rebuild). `change_seq` from a sequence guards the delete of a synced row. Not `domain_event` (volume, retries of unrelated handlers: ADR 0031 precedent), not `updated_at` polling (misses long transactions and hard deletes).
- **Job 12 `sync-search-index`:** claims rows with `FOR UPDATE SKIP LOCKED` and a lease, builds documents from the CURRENT database state outside any transaction, sends one `addDocuments` and one `deleteDocuments` by filter per locale, waits for both tasks (20 s), deletes the row `WHERE change_seq = <claimed>`; failures keep the row with backoff and a stored error code (never the engine's message). Idempotent. It also prunes its finished tasks (`DELETE /tasks?statuses=succeeded&beforeFinishedAt=...`, E11).
- **Job 13 `rebuild-search-index`:** builds `<live>_<stamp>`, pages through all sellable products by id cursor, adds documents in batches of 1 000, swaps all locales in one `POST /swap-indexes` (atomic and searchers see no error or empty answer, E9), updates the state row and deletes the old index. Job 12 pauses while a build runs; queue rows survive and are synced after the swap. `rename: true` (E9) is used only to move a freshly built index to a uid that does not exist yet. With search enabled and no live index, search answers `503 search_unavailable` until the first swap.
- Scale (S1): 100 000 documents index in 23 s of engine time, 483 MB RSS and 382 MB on disk.

### 6. Ukrainian morphology (resolves ADR 0005 decision 1) - CONFIRM
- **Snowball Ukrainian stemmer on both sides, together with 5-letter prefixes and the original text, as a federation of three queries** (decision 3), plus admin-managed synonym groups for different words and Russian queries. Typo tolerance stays.
- Measured on the S1 corpus (plan): recall@100 76.7% to 96.7%, P@10 76.7% to 95.3%, zero-result queries 21 to 3 of 90, one-letter typos, prefixes and brands unchanged at their previous level. The ADR 0005 failing list is fixed except `нозі` (k to z alternation of a four-letter word), which stays a documented exception covered by a demo synonym group.
- **CONFIRM:** the plan's bar said "every query of the ADR 0005 failing list finds its product, else synonyms only". Six of seven queries pass and the aggregate bar (recall up, precision not down by more than 5 points, no regression) is far exceeded. The decision takes the strategy with the exception recorded; if the owner insists on the literal bar, the stemmers are dropped by deleting `packages/core/src/search/stemmers/` and the two stems fields (the rest of this ADR is unaffected).
- **English** gets the Snowball English stemmer the same way (S1: plural recall 79.7% to 96.7%); irregular forms (`scarf`/`scarves`, `knife`/`knives`, `mouse`/`mice`) are synonyms. No Russian stemming in v1.

### 7. The stemmer code - CONFIRM
- **Source and licence:** the Snowball algorithms `ukrainian.sbl` and `english.sbl` of snowballstem/snowball 3.2.0 (commit `6389c79f91cd67ed2de3ebdcf84ec8c2d2d23c11`, 2026-10-17; the Ukrainian algorithm was added on 2026-10-15), BSD-3-Clause (AGENTS.md section 16 allows it). The BSD notice (copyright, conditions, disclaimer) is kept in the source tree and appended to `THIRD_PARTY_NOTICES.md` by `pnpm notices`.
- **Form:** no npm package (`snowball-stemmers` 0.6.0 has no Ukrainian; the site's `jsstemmer-3.2.0.tar.gz` was not used because executing downloaded code was refused in the build environment). The algorithms are vendored as TypeScript generated mechanically from the `.sbl` files by `scripts/snowball/generate.mjs` onto a small hand-written runtime (`packages/core/src/search/stemmers/snowball-runtime.ts`, semantics follow `javascript/base-stemmer.js` of the same release). The `.sbl` inputs and the generator are committed, so the output is reproducible and replaceable by the official compiler output.
- **Faithfulness:** the generated stemmers give exactly the reference stems for all 58 021 words of `snowball-data/ukrainian` and all 42 649 words of `snowball-data/english` (0 mismatches; run by hand, documented in the stemmers README); a sample of that data (BSD-3, a word frequency list) is committed as a CI test.
- **Update path:** a new Snowball release means replacing the `.sbl` files, regenerating and rerunning the vocabulary check; `SEARCH_DOCUMENT_VERSION` is bumped so every index is rebuilt.

### 8. Synonyms
Admin-editable synonym groups per locale (table `search_synonym_group`, `catalog.write`), applied as the engine's `synonyms` setting (an in-place settings update, no rebuild); demo groups in the seeds (`викрутка`/`відвертка`, `нога`/`нозі`, `scarf`/`scarves`, `knife`/`knives`, `mouse`/`mice`). Generic examples only.

### 9. Configuration (not implemented here; red zone, the owner edits AGENTS.md after the steps merge)
`SEARCH_ENABLED` (`false` in code, `true` in `.env.example` and e2e), `MEILI_URL`, `MEILI_API_KEY` (a key scoped to `<prefix>*` with actions `search`, `documents.add`, `documents.delete`, `indexes.create`, `indexes.delete`, `indexes.swap`, `settings.update`, `settings.get`, `tasks.get`, `tasks.delete`, `stats.get`; E10), `MEILI_INDEX_PREFIX` (default `fluxkit_`). The master key stays in the engine and the tests. `MEILI_URL` in production is `https` or a private address.

### 10. API surface (shapes fixed in `docs/api/search.md` with plan step 8)
`GET /store/search` (query, typed facet selections `f=<facetKey>:<code>`, `price=<min>..<max>`, `sort` in `relevance`, `newest`, `price_asc`, `price_desc`, `page`, `limit` at most 48, `page * limit` at most 10 000), `GET /store/search/suggest`, `search` in both config routes, admin `GET /admin/search/status` (`catalog.read`), `POST /admin/search/rebuild` and the synonym routes (`catalog.write`). Unknown facet keys are `400`. New problem code `search_unavailable` (`503`, `Retry-After`). Rate-limit windows `search` and `searchSuggest`. **Items are hydrated from Postgres** by product id through the existing list item code, so a stale index never shows a stale price, a draft or a deleted product; dropped ids are enqueued for sync.

### 11. Failure and privacy
- Engine down or slow: `503 search_unavailable` after 2 s; the catalog and category pages fall back to the SQL listing; sync keeps its rows with backoff; the admin status shows the lag. Query text is never logged (length, facet keys, duration, hit count and error codes only).
- A leaked `MEILI_API_KEY` can rewrite the catalog index but not other indexes or keys (E10).

## Consequences

- Shoppers find inflected and misspelled Ukrainian and English words without a second engine; the cost is two extra searchable fields, third-party BSD-3 code in core and a federation of up to three queries per search (no measurable latency cost, E7).
- Variant-level facets show values without counts; exact counts are a later plan. Facet UX for size and colour is simpler than in large shops.
- A rebuild needs the engine and about one scheduler tick per few thousand products; a wiped engine volume means minutes of `503` until the rebuild, with browsing alive through the SQL fallback.
- Renaming an attribute or option code changes facet keys in shared URLs.
- Everything that depends on Meilisearch behavior is pinned by `search-s1.spec.ts`; an engine upgrade that changes it fails a test and sends us back here.
- Not decided here: semantic or hybrid search, search analytics (privacy plan first), admin product list search through the index, merchandising, customer-group prices in the index.
