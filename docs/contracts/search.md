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
| `relaxed` flag | unreleased | `true` only when the page holds products that match some, not all, words of `q` |
| Public data rule | unreleased | the index and every search answer hold only published, sellable products, shop-currency prices and public attributes (never internal or not-visible attributes, stock quantities, locations, other currencies) |
| Command `pnpm search:reindex` | unreleased | rebuilds every locale's index now, swaps it in and drains the queue; exit codes `0` done, `1` failure or search off, `2` a running scheduler holds the lock (`docs/api/jobs.md`) |

## What is not contract

- The engine (Meilisearch), its version, index settings, ranking rules, stemming and the text queries the API sends; the order of hits beyond "best first" for `relevance`.
- Index names (`<MEILI_INDEX_PREFIX>catalog_<locale>` live, `..._<UTC stamp>` while building), the document shape and `SEARCH_DOCUMENT_VERSION` (core; a new version only triggers a rebuild). Clients never read the engine.
- The tables `search_sync_queue`, `search_index_state`, `search_synonym_group` and the job numbers and budgets (13 `sync-search-index`, 14 `rebuild-search-index`).
- The rate-limit numbers of the windows `search` and `searchSuggest`, the cache time of `GET /store/search` (`public, max-age=30`), the 2 s engine timeout, the `Retry-After` value, the 30 s label cache.
- The exact `facets` order beyond `brand`, `category`, `inStock`, then options and attributes by code; how many disjunctive counts are exact (at most 3 selected product facets per request); the `detail` texts.
- Engine error codes in `GET /admin/search/status` (`engine.code`, `lastErrorCode`, `errorCodes`): informational, may gain values.
