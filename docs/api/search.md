# API: catalog search

Store search and suggestions, and the admin status, rebuild and synonym routes (ADR 0034, `docs/plans/2026-10-29-search.md` steps 8 and 9).
Source of truth for shapes: `docs/api/openapi.json`. Facet keys, sort names and the document version are contract: `docs/contracts/search.md`.

- **Flag**: `SEARCH_ENABLED` (core, not a feature package). With `false` every route below answers `404 not_found`, nothing reads or writes the search tables, `GET /store/config` and `GET /admin/config` say `search: false` and the storefront uses `GET /store/products` only.
- **Engine**: Meilisearch, reached by the API only (`MEILI_URL`, scoped `MEILI_API_KEY`, `MEILI_INDEX_PREFIX`; `docs/contracts/config.md`). Browsers never talk to it; no engine address, key, index name or engine message appears in a store answer.
- **Public data only**: the index holds only published, sellable products, their public attributes and shop-currency prices (core `buildSearchDocuments`). Store items are hydrated from Postgres by product id with the `GET /store/products` code, so a stale index never shows a stale price, a draft, an archived, unsellable or deleted product: such ids are dropped from the page and marked for sync (`stale_hit`). A page may then hold fewer items than `limit`.
- **Errors**: as `docs/api/catalog.md` (Conventions), plus `503 search_unavailable` (`Retry-After: 30`): the engine is unreachable, slower than 2 s, or the locale has no live index yet (before the first build). The storefront then falls back to `GET /store/products`. Logged with the engine error code and the word count, never the query text. An engine that REFUSES a search (HTTP 400, `engine_rejected`: a bug or a drift between the API and the live index settings) is not an outage: the route answers `500 internal_error`, logs an error with the engine's code and counts it in `GET /admin/search/status` (`engine.rejectedSearches`).

## Store

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `GET /store/search` | public; window `search` (120 per minute per client address) | Products for a text query (empty `q` browses), with facets, price range, sort and pages | query `q`, `locale`, `f` (repeated), `price`, `sort`, `page`, `limit` (below) | 200 `{items, total, page, pageCount, limit, sort, relaxed, query: {normalized}, facets, price}` (below); `Cache-Control: public, max-age=30` | 400, 404 (off), 429, 500 (engine refused the search, see Errors), 503 | `SEARCH_ENABLED` |
| `GET /store/search/suggest` | public; window `searchSuggest` (120 per minute per client address) | At most 6 products for text typed so far | query `q` (required, 2 characters or more after normalization), `locale` | 200 `{items: [{slug, title}]}`, best first, titles from Postgres in the locale; `Cache-Control: no-store` | 400 (`too_short` and the `q` codes below), 404 (off), 429, 503 | `SEARCH_ENABLED` |

### `GET /store/search` parameters

Unknown parameters answer `400 unknown_field`. Every error names its parameter in `errors[].path`.

| Parameter | Rule | `errors[].code` on failure |
|---|---|---|
| `q` | Optional; NFC-normalized, lower case, at most 200 code points, no control characters; words after the 10th are dropped. Empty or missing: browse (no text ranking) | `too_long`, `control_characters`, `not_a_string` |
| `locale` | As `GET /store/products`: one of `LOCALES`, missing means `DEFAULT_LOCALE`; picks the index and the language of labels and items | as the catalog |
| `f` | Repeated `<facetKey>:<value>`. Keys: `brand:<slug>`, `category:<uuid>` (matches the category and its visible descendants), `inStock:true` or `false`, `opt.<code>:<valueCode>`, `attr.<code>:<optionCode>` (select or multiselect attribute), `attr.<code>:true` or `false` (boolean attribute), `attr.<code>:<min>..<max>` (number attribute; either end may be left out; each end a plain decimal such as `-1.5`, magnitude at most 10^15, no exponent and nothing JavaScript would print with one, so `0.0000001` is `invalid_range`; `-0` reads as `0`). The key must be a facet of the index (a public, filterable attribute of a filterable product type, or an option of a product type) that the LIVE index can already filter: an unknown key is refused, never ignored. A new option of a type, a newly filterable attribute or a new filterable attribute of a type becomes a facet once job 13 has applied the settings (its next run, then within 30 s: the API re-reads the live index's filterable fields every 30 s); until then it is `unknown_facet_key` and searches without it are unaffected. Values of one key are OR, keys are AND. At most 50 values and 8 keys | `malformed`, `unknown_facet_key`, `invalid_value`, `invalid_range`, `too_many_values`, `too_many_groups` |
| `price` | `<min>..<max>` in minor units of the shop currency, integers, either end may be left out, `min <= max`. Matches products with a variant priced in the range | `invalid_range` |
| `sort` | `relevance` (default with `q`), `newest` (default without `q`; `relevance` without `q` also means `newest`), `price_asc`, `price_desc` (by the price of the product's best-placed matching variant) | `invalid_value` |
| `page`, `limit` | `page` from 1, `limit` 1 to 48 (default 24); the first hit of the page must lie below 10 000 (`(page - 1) * limit < 10000`) | `invalid_page`, `invalid_page_size`, `beyond_max_offset` |

The engine filter is built only by core `buildSearchFilter` from these typed values, each value checked against its pattern AND quoted; no client text reaches the engine as filter or sort syntax. `parseSelectionParams` accepts only values `buildSearchFilter` can write; should the two layers ever disagree, the route still answers `400` (`f`, the filter's reason), never `500`.

### `GET /store/search` response

- `items`: list items exactly as `GET /store/products` (`{id, slug, title, brand, image, publishedAt, price, availability}`), in hit order, one per product.
- `total`, `pageCount`: the engine's count of matching products (approximate by at most the number of stale products dropped). `page`, `limit`, `sort`: the values applied.
- `relaxed`: nothing matched every word of `q` (2 words or more), so a second pass matched the products that contain the most words, dropping words from the end. The storefront shows them as partial matches. Always `false` when the page is empty.
- `query.normalized`: the text that was searched (the normalized `q`). It is the only echo of the request.
- `facets`: at most 20, in this order: `brand`, `category`, `inStock`, then options and attributes by code. A facet is listed when it has a value in the result or is selected. Each is `{key, kind, level, label, counted, values: [{code, label, count, selected}], range}`:
  - `kind`: `slug` (brand), `uuid` (category), `code` (option or select attribute), `boolean`, `range` (number attribute: `values` empty, `range {min, max}` of the result, else `null`).
  - `level` and `counted`: `product` facets (brand, category, attributes set on the product) have `count` = products; a selected product facet is counted disjunctively (as if its own selection were not applied, the other selections still are; at most 3 such extra queries per request, further selected facets count from the main query). `variant` facets (`inStock`, options, attributes set on variants) have `count: null`: the values are those present in the result, without counts (ADR 0034 decision 4).
  - `label`: the option or attribute name in the locale; `null` for `brand`, `category` and `inStock`. Value labels: brand and category names, option value and attribute option labels in the locale; `null` for `true`/`false` (the storefront words them). Brand and category values are sorted by label, option values in the option's own order.
- `price`: `{min, max}` of the shop-currency variant prices in the result without the price selection, or `null` without hits.

## Admin

Mounted only with `SEARCH_ENABLED=true`. Reads need `catalog.read`, writes `catalog.write` (the catalog defaults, `docs/api/catalog.md`); admin answers are `no-store`.

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `GET /admin/search/status` | admin `catalog.read` | Index state per locale, queue and engine reachability | none | 200 `{engine: {reachable, code, rejectedSearches: {count, lastCode, lastAt}}, locales: [{locale, liveIndex, documents, builtAt, settingsFresh, documentsFresh, rebuildRequestedAt, build: {index, startedAt, documents} \| null, failedAttempts, lastErrorCode, lastErrorAt, nextAttemptAt}], queue: {depth, due, leased, dead, oldestEnqueuedAt, oldestDueAt, errorCodes: [{code, count}]}}`. `engine`: one `GET /health` of the engine with a 2 s limit; `code` is an engine error code (`engine_unreachable`, `engine_timeout`, `engine_unauthorized`, ...) and never a message; `rejectedSearches`: store searches the engine refused with HTTP 400 since this API process started (each answered `500`), with the engine's code of the last one (`invalid_search_facets`, ...) and its time; per process. `settingsFresh`: the live index has the settings the current definitions and synonyms derive (job 13 applies a change in place). `documentsFresh`: built for the current document version and shop currency and no rebuild is due. `dead`: products that failed 10 times or more (they keep retrying hourly) | 401, 403, 404 (off) | `SEARCH_ENABLED` |
| `POST /admin/search/rebuild` | admin `catalog.write` | Request a rebuild of every locale; job 14 builds new indexes and swaps them in atomically | none | 202 `{requestedAt, locales}`; idempotent: a request while a build runs is kept and served by the next build | 401, 403, 404 (off) | `SEARCH_ENABLED` |
| `GET /admin/search/synonyms` | admin `catalog.read` | Synonym groups, by locale, then creation time | `limit`, `offset`, `locale` (optional, a configured locale) | 200 page of `{id, locale, terms, createdAt, updatedAt}` | 400 (`locale` `invalid_value`), 401, 403, 404 (off) | `SEARCH_ENABLED` |
| `POST /admin/search/synonyms` | admin `catalog.write` | Create a group of terms that find each other (two-way) | `{locale, terms}` (strict) | 201 the group; `Location: /admin/search/synonyms/{id}` | 400 (`locale` `invalid_value`; `terms` `not_a_list`, `too_few_terms`, `too_many_terms`, `invalid_term`, `duplicate_terms`), 401, 403, 404 (off) | `SEARCH_ENABLED` |
| `PATCH /admin/search/synonyms/{id}` | admin `catalog.write` | Replace the terms of a group | `{terms}` (strict) | 200 the group | 400, 401, 403, 404 | `SEARCH_ENABLED` |
| `DELETE /admin/search/synonyms/{id}` | admin `catalog.write` | Delete a group | none | 204 | 400 (malformed id), 401, 403, 404 | `SEARCH_ENABLED` |

- **Synonym terms**: 2 to 20 distinct terms of 1 to 50 characters, normalized like a search query (lower case, NFC, one apostrophe form, words joined by one space) before they are stored, so `"Викрутка"` and `" викрутка "` are the same term; a term with nothing left after normalization is `invalid_term`. A change reaches the live index with the next run of job 13 (a settings change in place, no rebuild; `settingsFresh` is `false` until then). Rebuilds use the same groups.
- **Not in the audit log**: like the catalog writes, rebuild requests and synonym changes write no audit event (the audit log covers customers, admin users and privacy requests, `docs/api/audit.md`). A synonym group keeps the id of the admin who created it (SET NULL when that user is deleted); it is not returned.
