# Contract: catalog search

Status: new in this release (search plan steps 4 to 9, ADR 0034); not released yet, so it can still change before the first SemVer release (recorded in `CHANGELOG.md`).
Routes, shapes and errors: `docs/api/search.md` and `docs/api/openapi.json`. Configuration: `docs/contracts/config.md` (`SEARCH_ENABLED`, `MEILI_URL`, `MEILI_API_KEY`, `MEILI_INDEX_PREFIX`).

## What is contract

| Item | Since | Contract |
|---|---|---|
| Routes | unreleased | `GET /store/search`, `GET /store/search/suggest`, `GET /admin/search/status`, `POST /admin/search/rebuild`, `GET`/`POST /admin/search/synonyms`, `PATCH`/`DELETE /admin/search/synonyms/{id}`: parameters, response shapes, status codes and error codes as in `docs/api/search.md`. All answer `404` with `SEARCH_ENABLED=false` |
| `search` in `GET /store/config` and `GET /admin/config` | unreleased | a boolean, `SEARCH_ENABLED`; a storefront calls the search routes only when it is `true` |
| Problem code `search_unavailable` | unreleased | `503` with `Retry-After` (seconds) when the engine cannot answer; clients fall back to `GET /store/products` |
| Facet keys (the `f` parameter and `facets[].key`) | unreleased | `brand` (value: brand slug), `category` (value: category id; matches the subtree), `inStock` (`true`/`false`), `opt.<optionCode>` (value: option value code), `attr.<attributeCode>` (value: attribute option code, `true`/`false`, or `<min>..<max>` for a number attribute). Option and attribute codes are the catalog codes, which are never renamed (`docs/contracts/api.md`, Stability of identifiers). Which options and attributes are facets is data: options of product types, and attributes that are filterable, visible on the storefront and not internal, of a filterable product type |
| Facet kinds and levels | unreleased | `kind` in `slug`, `uuid`, `code`, `boolean`, `range`; `level` in `product` (values with `count`) and `variant` (values with `count: null`) |
| Sort names | unreleased | `relevance`, `newest`, `price_asc`, `price_desc`. Engine sort or filter syntax is never accepted |
| Request limits | unreleased | `q` at most 200 characters (10 words used), suggest `q` at least 2 characters and at most 6 suggestions, at most 50 `f` values and 8 keys, `limit` 1 to 48 (default 24), `(page - 1) * limit < 10000`. Raising a limit is minor, lowering one is breaking |
| `relaxed` flag | unreleased | `true` only when the page holds products of the second pass: the complete words of `q` matched nothing, and the products match the last word as a prefix or (2 words or more) only some of the words (ADR 0037) |
| Grouping (ADR 0052) | unreleased (additive, minor) | optional `groupBy=product|listing`, default product; unknown is `400 invalid_value`. Listing summaries expose opaque `listingKey`, nullable localized `listingOption`, group offers and group totals/pages. Listing reads wait for live listing-capable readiness (v4 or later) (`503 search_unavailable`); SQL list grouping is the fallback. Counted facets count cards; variant facets (including split options) stay uncounted. `newest` uses `publishedAt desc, productId desc, listingKey asc`; listing price ties use `productId desc, listingKey asc`. |
| `match` of a store search item | unreleased (additive, 2026-11-02) | present only when the request selects at variant level (`inStock`, `price`, an option, a variant-level attribute); `{variantId, variantCount, price: {from, to, currency}, availability, optionValues: [{optionCode, valueCode}]}` of the product/group's sellable variants that fit the facets and the price (never the words), from current data; `null` when none fits any more; absent otherwise. The representative is the best available, then the cheapest, then the first in the product's variant order. Never a SKU or a quantity |
| Public data rule | unreleased | the index and every search answer hold only published, sellable products, shop-currency prices and public attributes (never internal or not-visible attributes, stock quantities, locations, other currencies) |
| Command `pnpm search:reindex` | unreleased | rebuilds every locale's index now, swaps it in and drains the queue; exit codes `0` done, `1` failure or search off, `2` a running scheduler holds the lock (`docs/api/jobs.md`) |

## What is not contract

- The engine (Meilisearch), its version, index settings, ranking rules, stemming and the text queries the API sends; the order of hits beyond "best first" for `relevance`.
- Index names (`<MEILI_INDEX_PREFIX>catalog_<locale>` live, `..._<UTC stamp>` while building), the document shape and `SEARCH_DOCUMENT_VERSION` (core; a new version only triggers a rebuild). Clients never read the engine.
- The tables `search_sync_queue`, `search_index_state`, `search_synonym_group` and the job numbers and budgets (13 `sync-search-index`, 14 `rebuild-search-index`).
- The rate-limit numbers of the windows `search` and `searchSuggest`, the cache time of `GET /store/search` (`public, max-age=30`), the 2 s engine timeout, the `Retry-After` value, the 30 s label cache.
- The exact `facets` order beyond `brand`, `category`, `inStock`, then options and attributes by code; how many disjunctive counts are exact (at most 3 selected product facets per request); the `detail` texts.
- Engine error codes in `GET /admin/search/status` (`engine.code`, `engine.rejectedSearches.lastCode`, `lastErrorCode`, `errorCodes`): informational, may gain values. `engine.rejectedSearches` counts per API process.
- When a new option or filterable attribute becomes a facet key: after job 13 applied the index settings and the API's 30 s cache of the live index's filterable fields expired; until then the key is `unknown_facet_key`.

## Document version 5 (2026-11-15)

- Store list, hydration and the search indexer share one SQL predicate for required product text: a usable title in any locale and usable names/labels for every active variant's referenced option and value, including unpriced variants.
- A product failing that predicate has no search documents. Incremental sync deletes its existing documents; syncing repaired text restores them, so totals, pages, facets and price ranges converge.
- The document version changes from main's 4 (listing keys) to 5 (required-text visibility): job 14 or `pnpm search:reindex` rebuilds existing indexes on upgrade (ADR 0040). Until sync/rebuild completes, hydration still omits corrupt hits and queues them as stale.
- A running build resumes only when its persisted `build_rebuild_key` equals the current document-version/currency/locale key. A mismatched or NULL key (an inherited build) makes job 14 delete the build index and create an empty one with a fresh cursor; resetting only the cursor would retain documents now excluded by visibility. The key is cleared on discard and swap.
- Job 14 never leaves an index the state does not name: a new build's uid is recorded in `search_index_state` before its index is created only while the locale has no build (so overlapping runs never overwrite each other's uid; a recorded build is dropped only while still the one the run deleted), and a stale or missing recorded build is deleted before it is forgotten (a creation still queued runs first, the engine keeps an index's task order), and after a verified swap the old index under the build uid is deleted before the completion clears that uid (a failed delete is retried by the next run). Indexes left by runs before this change are not found: listing indexes needs `indexes.get`, which the API key does not have.
