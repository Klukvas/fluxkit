# Review: catalog search (plan step 12, PR #182 `feat/search-api`)

Date: 2026-10-29. Reviewer: an independent agent (Claude Fable 5.1, a different model than the step authors). Branch `review/search` from `origin/feat/search-api` at `4bc456f`; no product code changed (every experiment was reverted, see "Method").
Scope: `docs/plans/2026-10-29-search.md`, ADR 0034, `packages/core/src/search/**`, migration `0010_search` (+down), `apps/api/src/search/**`, the `SEARCH_PORT` marks in the catalog, price, stock and reservation writers, jobs 13 and 14, `pnpm search:reindex`, the store and admin search routes, the api-client methods, `docs/api/search.md`, `docs/contracts/search.md`, configuration and the matrix modes.

Environment: real Postgres 17 (scratch databases `fluxkit_review_search_test` and `fluxkit_review_auth_test`), Redis, Meilisearch v1.55.0 with a key scoped to a fresh prefix per spec (as an operator would create it). Reproductions are in a scratch spec (`apps/api/src/search/zz-review.spec.ts`, run from the review checkout, NOT committed) and in `curl` probes of the engine; the lines quoted below are its output.

## Summary

| Severity | Count | Findings |
|---|---|---|
| Blocker | 0 | - |
| Major | 2 | F1 (a definition change takes search down until job 13 runs), F2 (`500` from a number-attribute range) |
| Minor | 4 | F3 (one store request is up to 20 engine requests, the ADR says one), F4 (synonym terms of more than three words are silently ignored), F5 (test gaps: the store sentinel test does not catch the public-attribute mutation; no hostile option value and no exact page boundary case), F6 (a public `GET` writes to the database on stale hits; recorded as a design note) |

Nothing found in: filter injection, data leakage of internal or hidden attributes, drafts, inactive variants, other currencies, stock numbers (document scan and response scan), authorization of the admin routes, `SEARCH_ENABLED=false` hardness, migration up/down/up/down, module boundaries, queue coalescing and the `change_seq` guard, hydration query count, logs. Details under "Verified OK".

## Findings

### F1 (Major) A catalog definition change makes every search answer `503` until job 13 applies the new index settings

- Where: `apps/api/src/search/store/store-search.service.ts:194-208` (`definitions()` derives the facet specs from the CURRENT definitions, cached 30 s) together with `:224-233` (`facetsByIndex` asks the engine to count every product-level and variant-level facet field of those specs) and `:251-265` (`call()` turns any `SearchEngineError`, including a `400 engine_rejected`, into `503 search_unavailable`). The live index gets the new `filterableAttributes` only when job 13 runs (`apps/api/src/search/indexer/search-indexer.ts:133-163`), i.e. at the next scheduler tick plus the engine's re-indexing time.
- Scenario: an admin assigns an option to a product type (`PUT /admin/product-types/{id}/options/{optionId}`), or flips `isFilterable` on a public attribute, or assigns a filterable attribute to a type. From that moment the API asks the engine for a facet (`opt_<code>` / `attr_<code>`) that is not yet filterable in the live index. Meilisearch refuses the whole multi-search (`400 invalid_search_facets`), and the API answers `503 search_unavailable` to EVERY `GET /store/search` (with or without `q`, with or without filters), not only to requests that use the new facet. Suggestions keep working (no facets). The storefront falls back to the SQL listing for the whole shop until job 13 has applied the settings; if that settings update fails, search stays down for the backoff period.
- Proof (scratch spec R2, real engine; a new app so the 30 s cache is cold):
  ```
  R2 search after a new type option -> 503 {"code":"search_unavailable",...}
  R2 filtered -> 503 {"code":"search_unavailable",...}
  WARN [StoreSearch] Search failed: engine_rejected [invalid_search_facets] after 4 ms (query of 1 words)
  WARN [StoreSearch] Search failed: engine_rejected [invalid_search_filter] after 17 ms (query of 0 words)
  R2 sync -> {"enabled":true,"paused":false,"settingsUpdated":2,"scanned":0,...}
  (after the sync the same request answers 200)
  ```
  Engine-level confirmation (`curl`, master key, probe index): a federation with `facetsByIndex` naming a non-filterable field answers `{"code":"invalid_search_facets"}`; a filter on it answers `{"code":"invalid_search_filter"}`.
- Why the tests miss it: `store-search.spec.ts` builds the index AFTER the fixture definitions exist and never changes a definition with the app running; `search-indexer.spec.ts` "a newly filterable attribute changes the settings in place" checks the engine settings, not a store request in between.
- Suggested fix: derive the facets the store asks for from what the LIVE index has, not from the definitions alone. Either store the applied filterable list (or the `settings_hash` already in `search_index_state`) and intersect the specs with it, or keep the specs as they are and drop a facet whose field is not in the live settings (read `settings.get` once per cache period, the key has it). Independently, an `engine_rejected` (HTTP 400) should not be reported as `search_unavailable`: it is a bug or a drift, so log it as an error and still fail the request, but count it separately so the admin status can show it. Add a store-level test: assign an option to a type with the app running, search, expect 200.

### F2 (Major) `GET /store/search` answers `500 internal_error` for a number-attribute range with a tiny decimal

- Where: `packages/core/src/search/selection.ts:32,146` accepts `attr.<code>:<min>..<max>` through `ATTRIBUTE_RANGE` (`-?\d+(\.\d+)?`) and only checks the magnitude; `packages/core/src/search/filter.ts:66-76` (`numberLiteral`) then refuses the value because `String(1e-7)` is `"1e-7"`, which fails `DECIMAL_PATTERN`, and throws `SearchFilterError`. `apps/api/src/search/store/store-search.service.ts:114-119` calls `planSearchQueries` (which calls `buildSearchFilter`) outside any `try`, and nothing in `apps/api/src/search/` maps `SearchFilterError` to a problem (`grep SearchFilterError apps/api/src` finds no handler).
- Scenario: a shopper (or anyone) sends `f=attr.weight:0.0000001..2` for a public, filterable number attribute. Any decimal whose JavaScript string form uses exponent notation (`|x| < 1e-6`) does it.
- Proof (scratch spec R1, a real number attribute `weight` assigned to the fixture type):
  ```
  ERROR [ProblemDetails] Unhandled error on GET /store/search: SearchFilterError: A range end must be a plain finite number
  R1 tiny decimal -> 500 {"status":500,"code":"internal_error",...}
  ```
  `f=attr.weight:1..2` answers 200 with the right product; `1e5..2`, `..9999999999999999999`, negative ranges and the other hostile values of the existing spec answer 400 or 200 as intended.
- Suggested fix: make `parseSelectionParams` and `buildSearchFilter` agree: either format range ends with a fixed decimal form (never exponent notation) in `numberLiteral`, or refuse in `parseRange` what `numberLiteral` would refuse (same `DECIMAL_PATTERN` test on `String(value)`). Also catch `SearchFilterError` in the service and answer `400` (defence in depth: the two layers are documented as such in `docs/api/search.md`). Regression test with `0.0000001..2`.

### F3 (Minor) One store request is up to 20 engine HTTP requests (40 engine queries); the ADR and the plan say one multi-search

- Where: `apps/api/src/search/store/store-search.service.ts:211-249` (`run()` sends ONE `POST /multi-search` PER planned query, in parallel) and `:123-129` (the `relaxed` pass repeats all of them). ADR 0034 decision 3 ("One federated multi-search ... up to three queries") and decision 4 ("one extra query per selected group"), plan section 6 ("All queries go in ONE `POST /multi-search`"). `docs/files/api.md` describes the implementation correctly ("sent as federations ... in parallel").
- Proof (scratch spec R3, `vi.spyOn(SearchEngine.prototype, "multiSearch")`):
  ```
  R3 simple: engine HTTP calls=3 db statements=4;
     heavy (8 groups, relaxed pass): engine HTTP calls=20 engine queries total=40 db statements=0
  ```
  A request with 8 selected groups and a two-word query that matches nothing costs 10 multi-search requests per pass and 2 passes. With the `search` window at 120 requests a minute per address this is up to 2 400 engine requests (4 800 engine queries) a minute per address, ten times what the ADR budgeted; the S1 latency numbers were measured for one multi-search per page.
- Suggested fix: either send the planned queries in one `POST /multi-search` (the engine accepts many independent queries; federation can only merge queries of one result set, so this needs the non-federated form for the facet queries and one federated query for the hits, or several federations are not possible in one request: check and record the engine fact), or update ADR 0034 decision 3 and 4 and the plan to the real design and lower the `search` window or the group cap accordingly. Record the measured cost.

### F4 (Minor) A synonym term of more than three words is accepted and stored but ignored by the engine

- Where: `packages/core/src/search/indexing.ts:178-207` (`parseSynonymTerms`: 1 to 50 characters, no word limit), `docs/api/search.md` "Synonym terms" (documents the character limit only). Meilisearch applies multi-word synonyms of at most three words.
- Proof (scratch spec R4 with the real engine; two groups created through `POST /admin/search/synonyms`, both `201`, then job 13 `settingsUpdated: 1`):
  ```
  R4 three-word synonym items: 1 four-word synonym items: 0 relaxed: false
  ```
  Engine probe: `synonyms: {"shirt": ["long sleeve cotton top"], "long sleeve cotton top": ["shirt"], "tee": ["shirt"]}`; `q=tee` finds the shirt, `q=long sleeve cotton top` finds nothing.
- Suggested fix: refuse terms of more than three words in `parseSynonymTerms` (`invalid_term`) and say so in `docs/api/search.md` and the admin UI validation message; or document the engine limit as a known limitation. Pin the engine fact in `search-s1.spec.ts` style.

### F5 (Minor, test gap) The store-level sentinel scan does not catch the "public attribute" mutation

- Where: `apps/api/src/search/store/store-search.spec.ts:294-310` ("never returns an internal attribute value ..."). The internal fixture attribute is `text` with `isSearchable` false (the database forbids `isInternal` together with `isSearchable`), so removing `isPublicAttribute` from `buildSearchDocuments` (mutation M2) does not change what that spec can observe: it passed (`2 passed`) while `document.spec.ts` (`2 failed`) and `search-indexer.spec.ts` "public data only" (`1 failed`) caught the mutation.
- Suggested fix: give the store spec a HIDDEN attribute (`isVisibleOnStorefront: false`, `isSearchable: true`) with the sentinel, as the indexer spec does, so a search for the sentinel must find nothing. The plan (section 11) asks for exactly this scan on the responses.
- Two more gaps from the mutation table: no store-level hostile value for an `opt.<code>` or `attr.<code>` facet (mutation M13 survived the store spec), and no page whose first hit is exactly 10 000 (`page=251&limit=40` must be 400; mutation M16 survived core and store specs).

### F6 (note, no action required) A public `GET /store/search` writes to the database

- Where: `apps/api/src/search/store/store-search.service.ts:133-137`: a hit the shop no longer sells is marked `stale_hit` in `search_sync_queue` in its own transaction. The ids come from the engine (never from client text) and the write is a coalescing upsert, so a shopper cannot grow the table or choose the rows; the rate limit bounds the rate. Recorded because it is a write on a cached (`public, max-age=30`) public GET and the plan did not say so. Verified: the write is in its own short transaction, after the read, and the queue row is removed by the next sync.

## Verified OK (with evidence)

- **Baseline:** every search suite of the branch passes on the review stack: core `src/search` 9 files, 109 tests; API `src/search` + `migrations.spec.ts` 10 files, 107 tests (56.8 s). `pnpm check:boundaries`: 2 175 modules, 0 violations; no file under `apps/api/src/catalog`, `inventory` or `common` imports `src/search/` (only `common/search-port.ts` defines the port).
- **Filter injection:** values are shape-checked (`SLUG_PATTERN`, `UUID_PATTERN`, `CODE_PATTERN`, `VALUE_CODE_PATTERN`, decimal pattern) and then quoted; facet keys must exist in the derived specs; the sort is a closed enum; the hits query sends no client text except `q` (normalized to letters, digits, marks and apostrophes). Scratch spec R6: `locale=UK`, `page=99999&limit=1`, `f[a]=b`, `q[]=a&q[]=b`, `1e5..2`, 19-digit range ends, upper-case UUID, upper-case value code and an unknown parameter all answer 400 (`unknown_field` for the parameter). The existing spec covers quotes, `OR`, parentheses, NUL, bad booleans and prices. Mutations M1 (unescaped quote), M3 (unknown key ignored), M11 (control characters) and M13 (value codes not shape-checked) each failed at least one test (M13 only through the 400 assertions: quoting alone would still hold).
- **Public data:** the document builder is the one place (`isPublicAttribute` plus the flags, `isVariantSellable`); the indexer spec scans every stored field and setting of both locales for a sentinel in an internal attribute, a hidden attribute, a draft title, an unpriced product's title and an inactive variant's SKU; `displayedAttributes` is `id, productId, productSlug, title`; store items are hydrated from Postgres (titles, slugs, prices, availability), suggestions too. Mutations M2 and M14 (sellable rule dropped) failed the core and indexer specs. Scratch spec R5: an attribute switched to internal (`isInternal: true` requires `isSearchable: false` and `isVisibleOnStorefront: false`, the API enforces it) still matched its old value in the index until the next sync (`queue: attribute_changed`), then the product no longer matched: the window is one sync, as documented ("matching may be up to one sync behind"); the value itself is never returned.
- **Hydration and query count:** `listItemsByIds` keeps hit order and names the missing ids; one `GET /store/search` with hits costs 4 Postgres statements (one by-id load and the three batched reads of `toListItems`) plus one brand-name query when a brand facet has values, whatever the page size; an empty page costs 0. Mutation M9 (hydration without the sellable check) and M15 (stale hits not marked) failed the "drops a product ... and marks it for sync" test.
- **Queue and consistency:** marks are in the writer's transaction (`search-queue.spec.ts`: a rollback leaves no row; 20 concurrent transactions with overlapping sets never deadlock); every catalog, price, stock and reservation writer marks (`write-path.spec.ts`, read through: products create/update/delete/transition/categories, variants update/delete/generate, product options, prices one/many/delete, inventory adjustment, reservations hold/release/commit/expire, brand, category, option value, attribute, product type attribute). A manual variant create does not mark; it is allowed on drafts only, which have no documents, and publishing marks. Mutations M4 (settle without the `change_seq` guard) and M10 (a repeated mark keeps its `change_seq`) failed the guard test; M12 (sync not paused during a rebuild) failed "sync waits while no live index exists" and "a change made while a build runs is not lost". Jobs 13 and 14 run last in the tick under the one scheduler lock, so they never overlap; `pnpm search:reindex` takes the same lock (exit 2 when held).
- **Engine failures:** an unreachable engine answers `503 search_unavailable` within the timeout with `Retry-After: 30` and logs the code and the word count only (existing spec); sync failures keep rows with a code and backoff; a key without the needed actions is `engine_unauthorized`; the swap is awaited through a later settings task and a document count check (scoped keys cannot read the swap task).
- **Deleted or unpublished product:** hydration drops it at once (the stale id is marked), the sync deletes its documents at the next run (`search-indexer.spec.ts` "unpublish"; mutation M17, the delete filter for products without documents removed, failed that test).
- **Authorization:** `@AdminController("search")` defaults: `catalog.read` for reads, `catalog.write` for writes; the spec walks a viewer (200 on status and synonyms, 403 on rebuild and create); the api-client operation table carries the same permissions. Synonym bodies are strict (`unknown_field`), terms are normalized, limited to 20 (`too_many_terms`), 50 characters (`invalid_term`), no control characters, no duplicates after normalization; responses are JSON, so no XSS surface in the API.
- **`SEARCH_ENABLED=false`:** no engine client, `DISABLED_SEARCH_PORT`, no controllers (404 on every store and admin search route in the specs), jobs return `enabled: false` before any read; `write-path.spec.ts` "no write reaches the search tables" (mutation M5, the queue provided while off, failed it). Matrix `search-off` and `search-on`: see "Not verified" for what did and did not run here.
- **Migration 0010:** `migrations.spec.ts` applies 0000 to 0010, rolls back 0010 alone (tables, sequence and its journal row gone, 0009 untouched), re-applies, rolls back everything to 0000 and repeats, twice (passes here). The down script's `created_at` 1793271071859 equals the journal `when`. CHECKs mirror the core patterns (`search-schema.spec.ts`).
- **Page limits:** `(page - 1) * limit < 10000`, `limit` 1 to 48 (mutation M16, the boundary off by one, failed the core spec and the store 400 test); `maxTotalHits` 10 000 in the settings.
- **Rate limits:** windows `search` and `searchSuggest`, 120 a minute per client address (mutation M6, the decorator removed, failed the rate-limit test). Server-rendered storefront requests share the HANDOFF launch blocker (one address), as the plan says.
- **Index naming and scope:** `<prefix>catalog_<locale>` with a UTC stamp for builds; `isOwnedIndexUid` guards every delete; the key is scoped to `<prefix>*` (the spec shows `403 invalid_api_key` outside it); two environments on one engine need different prefixes (documented).
- **Docs vs behaviour:** `docs/api/search.md`, `docs/contracts/search.md`, `docs/api/jobs.md` (13 and 14), `docs/contracts/config.md`, `docs/files/api.md`, `seeds/README.md`, `.env.example`, `CHANGELOG.md` and the README key command (`tasks.delete` included) match the code, except the items in F3 (the ADR's "one multi-search") and F4 (synonym term length only).

## Mutation experiments (17, all reverted with `git checkout`)

| Id | Mutation | Caught by | Survived |
|---|---|---|---|
| M1 | filter: `"` not escaped | core `filter.spec.ts` (1 failed) | - |
| M2 | document: `isPublicAttribute` dropped | core `document.spec.ts` (2), api indexer "public data" (1) | store `store-search.spec.ts` sentinel test (F5) |
| M3 | selection: unknown facet key ignored | core `selection.spec.ts` (1), store "refuses" (2) | - |
| M4 | queue settle without the `change_seq` guard | indexer "change_seq guard" (1) | - |
| M5 | search off still provides the writing queue | write-path "SEARCH_ENABLED=false" (1) | - |
| M6 | store route without `@RateLimit` | store "rate limited" (1) | - |
| M7 | hits query without `distinct` | store: inflected word (`total` 3 instead of 1), browse, disjunctive counts (3 failed) | - |
| M8 | disjunctive product facet with `limit: 0` | core `facets.spec.ts` (2), store "disjunctive" (1) | - |
| M9 | hydration without the sellable check | store "drops a product" (1) | - |
| M10 | repeated mark keeps its `change_seq` | queue "coalesces" (1), indexer guard (1) | - |
| M11 | query accepts control characters | core `query.spec.ts` (1), store "control characters" (1) | - |
| M12 | sync not paused during a rebuild | indexer "sync waits while no live index exists", "a change made while a build runs is not lost" (2) | - |
| M13 | value codes not shape-checked | core `selection.spec.ts` (1), `filter.spec.ts` (1) | store "refuses" tests (19 passed): the hostile values of the store spec target the brand slug only, no hostile `opt.<code>` value (test gap; quoting still protects) |
| M14 | sellable rule dropped in the builder | core `document.spec.ts` (2), indexer "public data" (1) | - |
| M15 | stale hits not marked | store "drops a product ... marks it for sync" (1) | - |
| M16 | page boundary `>` instead of `>=` (a page starting exactly at hit 10 000 allowed) | nothing | core `facets.spec.ts` (14 passed) and store "refuses" (19 passed): no test uses a page whose first hit is exactly 10 000 (`page=251&limit=40`); the existing case `page=418&limit=24` starts at 10 008 (test gap) |
| M17 | products without documents never deleted from the index | indexer "incremental sync" (4 failed, among them the unpublish) | store "drops a product" (1 passed): it checks hydration and the mark only, by design |

## `auth-secrecy.spec.ts` flake ("Test setup bug: login answered 401")

Run here: `auth-secrecy.spec.ts` together with `auth-login.spec.ts`, 12 times in a row against the isolated database `fluxkit_review_auth_test` with three busy CPU loops (`node -e 'for(;;){}'`) running the whole time, while the search mutation suites ran against the other database: 12 of 12 runs green (42 tests each). **Not reproduced.**

Reading of the flaky step (`apps/api/src/auth/auth-secrecy.spec.ts:122-125`, the viewer's login with `NEW_PASSWORD` after `clock.advanceMinutes(11)`): the message comes from `apps/api/src/test/auth-http.ts:29` (`loginCookie`), which hides WHY the API answered 401 (the API logs a code only: `unknown_account`, `wrong_password`, `locked`, `inactive`, `ip_throttled`), and the spec swallows every stdout/stderr line into `output` and never prints it on failure.
- The per-address `LoginThrottle` (20 attempts per 10 minutes) and the account lockout (5 failures) use the app's `CLOCK`, the spec's `FakeClock`; the spec makes 4 logins and the viewer never fails, so neither should fire; both are per app instance, so other spec files cannot add to them. Test admin emails are unique per user (`auth-test-<uuid>@example.test`).
- The one step that decides the viewer's password, `users reset` (`POST /admin/users/{id}/reset-password` with `NEW_PASSWORD`, line 108), is NOT asserted: if it did not answer 200 under load (a lost or slow answer, a 5xx), the viewer still has `PASSWORD` and the login with `NEW_PASSWORD` is a plain `wrong_password` 401. This is the most likely root cause, but a hypothesis, not a proof.
- Suggested change to the spec (not product code): assert the status of every `run` the later steps depend on (`login ok`, `users reset`, `change ok`), and on a failed `loginCookie` print the captured `output` (the login reason codes) so the next flake carries its reason.

## Not verified

- Performance targets of plan section 13 (p95 at 10 000 products, rebuild time at scale): no large catalog here; only the query and statement counts per request were measured.
- Engine behaviour on versions other than v1.55.0; a long soak; an engine that answers slowly but inside 2 s.
- A settings update that the engine REFUSES (not just an unreachable engine): `sync()` returns after the first failed locale and skips the queue for that run; by reading, the backoff then lets later runs continue, but no spec provokes a refused settings task.
- The storefront and admin UI (plan steps 10a and 10b are not in this PR).
- Rate limiting behind the Next.js server (HANDOFF launch blocker, out of this PR).
- The DoS cost of very many facets: the engine is asked to count EVERY product-level facet field on the hits query and every variant-level field on the facets query (`maxFacets` 20 caps the response, not the engine work); not measured.
- Nothing else: the matrix modes DID run here. `scripts/feature-matrix.sh search-off`: OK (`Search: disabled`, `search: false`, 404 on the four search routes, `queue=0 state=0 synonyms=0` before and after seed plus the scheduler's first tick). `search-on`: OK against a fresh database (`Search: enabled (matrix_)` with an unreachable engine and an invented key, the key never in the log; with the real engine and a scoped key: `queue=8` after the seed, `queue=0 state=2` after `search:reindex`, the seeded screwdriver found by `GET /store/search?q=screwdriver` and `/suggest?q=screw`). Note for operators of a shared database: `search-on` run after `search-off` on the SAME database fails at "expected the seed's catalog writes to mark products" because the idempotent seed writes nothing the second time; CI gives every mode its own service container, so this is not a CI problem.

## Method

- Read: AGENTS.md sections 2.1, 2.3, 9, 11, 13, 14, `docs/HANDOFF.md`, the plan, the ADR, every file in scope and the writers that mark.
- Ran: the baseline suites, `pnpm check:boundaries`, the scratch spec `zz-review.spec.ts` (6 reproductions, R1 to R6, against the real stack), `curl` probes of the engine, 17 mutation experiments (each applied with an exact one-occurrence replacement, the named specs run, the file restored with `git checkout --`, core rebuilt before and after), the `auth-secrecy.spec.ts` loop, the matrix modes.
- Scratch files (not committed): `apps/api/src/search/zz-review.spec.ts`, the mutation runner and logs in the session scratchpad. Scratch databases `fluxkit_review_search_test`, `fluxkit_review_auth_test` (dropped by name at the end).
