# Review: catalog and category pages through search, demo synonyms (search plan step 13 for steps 10a rest and 11)

Independent QA review of PR #188 (`feat/search-finish`, commits `1668785` to `f207448`, ADR 0039) by a different model than the author. Branch `review/search-finish`; no product code changed (every experiment below was reverted, `git status` clean). Fixes are for the orchestrator to assign.

Stack used: real Postgres 16, Redis, Meilisearch (`/tmp/step8-meili`), the branch's build; scratch databases `fluxkit_rev_sfin_*_test` (all dropped afterwards), engine prefixes `revsfin_` and the e2e's `e2e3102_` (deleted). A manual stack of the built API (`SEARCH_ENABLED=true`, `TRUST_PROXY=1`, seeded and reindexed) on `:3200`, a second API whose engine address nothing listens on (`:3203`), and three `next start` storefronts: forwarding on (`:3201`), off (`:3202`), on the engine-down API (`:3204`).

## Findings

### Major

**F1. One client can switch every shopper's plain catalog and category pages to the SQL fallback for a minute, with a healthy engine.**
`apps/storefront/src/lib/catalog-search-data.ts:74-78` reads the unfiltered list through the data cache and, by design, `apps/storefront/src/lib/search-data.ts:67-68` forwards no address on that read, so every cache miss counts against the API's `search` window of the Next server's one address (`apps/api/src/rate-limit/rate-limiter.ts:55`: 60 a minute, keyed by client address, ADR 0036) whatever `STOREFRONT_FORWARD_CLIENT_ADDRESS` says. The key space of cacheable addresses is large (locale x category x `sort` x `page` up to 417), and a page past the last one is a cache miss too: `loadCatalogSearchPage` reads the engine first and answers `not_found` after (`catalog-search-data.ts:74,81`). So 60 distinct addresses in a minute, from one client, use the server's window up; a `429` is not cached (Next caches `200` only), and the fallback branch treats it as "search cannot serve this now" (`catalog-search-data.ts:85-87`), so for the rest of the minute every fresh unfiltered page of every shopper renders the SQL list with "Filters are temporarily unavailable".
Proof (storefront `:3201`, forwarding ON, one client address `10.5.5.5`):

```
74 distinct page addresses (/en/catalog?page=2..75, all 404 for the shopper) in 5 s
direct API from the server's own address now: 429
another shopper (10.6.6.6), fresh unfiltered /uk/c/demo-digital-goods?sort=price_asc: FALLBACK-NOTICE
another shopper (10.6.6.6), fresh unfiltered /en/c/demo-digital-books: FALLBACK-NOTICE
another shopper (10.6.6.6), FILTERED /en/c/demo-digital-books?f=brand:demo-brand: no-notice   (own address, forwarded)
engine health (GET /store/search from a fresh address): 200
.next/cache/fetch-cache: 26 files before, 101 after (one file per 404 page address, never deleted by next start)
```

A crawler walking the category pages and sorts does the same without malice (ADR 0039 decision 5 counts "one engine search per locale, category, page and sort a minute" as the cost, but not that they all share one 60-a-minute key). ADR 0039's consequence "beyond [the window] shoppers see the fallback notice" was written for the filtered reads of an unforwarded storefront, not for this.
Suggested fix (needs a decision; the API window is a public contract, section 14): (a) do not read the engine for an address that cannot have a page: read page 1 of the same list (cached) first, or keep the page count of the cached answer, and answer `notFound()` without a second read; (b) count the storefront's cached reads outside the per-address window, for example a separate, larger window for the storefront's internal reads (a header the edge strips, or the API's `TRUST_PROXY` hop address allow-listed), or do not treat a `429` of a *cacheable* read as an outage (serve the last good cached answer); (c) at least document the exposure in ADR 0039 and `apps/storefront/README.md`. The e2e `catalog-facets` 429 test proves the forwarded path only; add a test for the server-address path.

### Minor

**F2. "Newest first" differs between the search listing and the SQL listing for products published in the same second.**
The SQL listing orders by `published_at desc, id desc` (`docs/api/catalog.md`); the search document stores `publishedAt` as epoch seconds (`packages/core/src/search/document.ts:178,219`), so the engine's `newest` sort (`packages/core/src/search/sort.ts`, `publishedAt:desc`) breaks ties in engine order. On the seeded catalog (8 products, 7 published within one second) the same category lists the same products in a different order in the two modes, so a shopper who hits the fallback (or a shop that switches search on) sees the list reshuffled, and a catalog imported in bulk lists in arbitrary order. Not introduced by this PR (step 9), but this PR makes it the catalog's default order. Proof (`GET /store/products` vs `GET /store/search?f=category:<id>`, both locales):

```
en (all): sql total=8 search total=8 DIFF
  sql:    demo-template-pack,demo-e-book,demo-adjustable-wrench,demo-hammer,demo-screwdriver,demo-linen-shirt,demo-hoodie,demo-t-shirt
  search: demo-screwdriver,demo-adjustable-wrench,demo-template-pack,demo-hoodie,demo-linen-shirt,demo-e-book,demo-hammer,demo-t-shirt
en demo-clothing: DIFF (same 3 products), en demo-tools: DIFF (same 3 products); the 7 subcategories with 1 or 2 products: SAME. uk: identical picture.
```

Totals and product sets were equal for every category and for the brand filter (`brand: sql total=8 search total=8`). Suggested fix: index `publishedAt` in milliseconds (a document version bump, so a rebuild), or add a tie-break sort on the id; say in ADR 0039 that the orders may differ meanwhile.

**F3. Test gaps found by mutation (3 of 17 mutants survived; the other 14 were killed, list below).**
- `apps/storefront/src/lib/catalog-route.server.ts:147`: `brandSlug: null` in the fallback branch survives: no spec checks that the SQL fallback of `?f=brand:x` (or `?brand=x`) still shows the brand line and its "Clear the filter" link (`CatalogView`'s `brand` prop); the specs only check the `brand` parameter of the SQL read. Add an assertion on the rendered brand chip in `catalog-page.spec.tsx`.
- `apps/api/src/search/admin/admin-search.service.ts:189-196`: dropping `eq(searchSynonymGroup.locale, locale)` from `ensureGroup`'s "already exists" query survives: a `uk` group holding one of an `en` group's terms would make the `en` group count as existing and never be created. Add a case to `seed.spec.ts` (a group of the other locale with a shared term, then the seed creates the demo group anyway).
- `apps/storefront/src/components/search-results.tsx:190` (chips not filtered by `hiddenFacetKeys`) survived but is an equivalent mutant: a `category:` facet never reaches a category page (`resolveCatalogAddress` answers 404), so no chip can be hidden. No test needed.

**F4. `docs/HANDOFF.md` is not updated (AGENTS.md section 8: a finished plan step updates it).**
The PR marks steps 10a (rest) and 11 done in `docs/plans/2026-10-29-search.md` but `docs/HANDOFF.md` still says "Search (partial): steps 1 to 3 merged (#175) ... No open search PR" (`docs/HANDOFF.md:19`, last touched by #180). This staleness predates the PR (steps 4 to 10a part 1 did not update it either); this PR should bring it current (search state, `SEARCH_SYNONYM_SEEDER`, the fallback behaviour, the F1 exposure once decided).

## Mutation experiments (all reverted)

Run with `vitest` on the storefront specs `catalog-page`, `catalog-search`, `catalog-search-data`, `search-data`, `search-results`, `search-page` (95 tests) and, for the API, `seed.spec.ts` + `search/admin` (55 tests, real Postgres):

| Mutant | Result |
| --- | --- |
| M1 `rate_limited` answered as not found instead of the fallback (`catalog-search-data.ts`) | killed (2 tests) |
| M2 fallback does not report a dropped `sort` (`fallbackCatalogQuery`) | killed |
| M3 facet-filtered reads enter the data cache (`isCacheableCatalogSearch`) | killed (4 tests) |
| M4 category page does not add `category:<id>` to the request | killed (3 tests) |
| M5 `category:` facet accepted on a category page | killed (2 tests) |
| M6 `?brand=` alias duplicated next to `f=brand:<same>` | killed |
| M7 a sorted view is not `noindex` (`isFilteredCatalog`) | killed |
| M8 a page past the last search page is listed instead of 404 | killed (2 tests) |
| M9 "already exists" needs the exact term list (an edited group is re-created) | killed |
| M10 "already exists" ignores the locale | **survived** (F3) |
| M11 the cached read forwards the shopper's address (`search-data.ts`) | killed |
| M12 the category facet is offered on a category page (`hiddenFacetKeys`) | killed |
| M13 fallback loses the brand chip (`brandSlug: null`) | **survived** (F3) |
| M14 the canonical redirect goes to `/search` instead of the page's path | killed |
| M15 hidden facet keys still shown as chips | survived, equivalent (F3) |
| M16 summary says `searchEnabled` with search off (`catalog-seeder.ts`) | killed |
| M19 words (`q=`) accepted on a catalog page | killed (2 tests) |

## Verified OK

- Unit and integration specs of the PR: storefront `catalog-page`, `catalog-search`, `catalog-search-data`, `search-data` (57 tests); `@fluxkit/seeds` (16); API `seed.spec.ts` on real Postgres (41, including search on: 11 groups created, a second run `existing 11`, an edited group left alone, a deleted one re-created, `LOCALES=uk` skips `en`).
- e2e (real stack, Chromium): `catalog-facets.e2e.ts` 4 passed (25.5 s); `E2E_SEARCH=off`: `search-off.e2e.ts` + `not-found` 9 passed, the catalog lists without search.
- `scripts/feature-matrix.sh search-on` against the real engine: OK (seed writes `synonyms=11`, `search:reindex` applies them, `q=spanner` finds the wrench; the key and the prefix's indexes are deleted at the end).
- Search ON: `/en/catalog` and `/en/c/<slug>` list through `GET /store/search` with the facet panel (`aria-label="Filters"`), sort, chips; `h1` page, `h2` count, `h3` product titles. The filter form has no `action` (submits to the page's own path), the script-less submit redirects to the canonical address (`?priceMin=1&priceMax=2` -> `307 ?price=100..200`).
- Search OFF (`search: false`): the SQL listing of before, no filter panel, no search read (unit spec), e2e `search-off`.
- Engine DOWN (API `:3203`, `MEILI_URL` unreachable, storefront `:3204`): `/en/catalog`, `/uk/c/demo-clothing` -> 200, fallback notice (`role="status"`), SQL list with `h2` product titles, no panel; `/en/c/demo-tools?f=brand:demo-brand&sort=price_asc` -> notice with the "could not be applied" wording, "Try again" keeps `?f=brand%3Ademo-brand&sort=price_asc`; `/en/catalog?page=2` -> 404 (8 products). Wording in both locales from `messages/*.json`; `uk` and `en` key sets equal apart from the Ukrainian plural forms.
- Window exhausted (`429`): e2e proves the forwarded path; manually, with `10.7.7.7` exhausted directly on the API: forwarding storefront, fresh UNFILTERED page -> no notice (not forwarded, by design); FILTERED page -> notice (forwarded); non-forwarding storefront, FILTERED -> no notice. Caveat: F1.
- Data cache: `.next/cache/fetch-cache` grows by one file for the first read of an unfiltered address, not for the second, not for `f=` or `price=` reads (24 -> 25 -> 25 -> 25 -> 25). The cached read sends no `X-Forwarded-For` (the window proof above), so no shopper address enters a cache key; locale and category id are part of the request URL (key), currency is the shop's.
- Category scoping: the search document holds the category and its ancestors (`document.ts:211`), the SQL listing uses the subtree; for every seeded category and both locales the two listings return the same product set and total (F2 is order only). A `category:` facet on a category page is a 404; on `/catalog` a `category:` value the API refuses renders the "selection refused" state with a clearing link, never a silent list.
- Canonical and redirects: `?page=1`, `?q=`, `?sort=newest|relevance`, `?utm_source=x&page=1`, duplicate `f=` -> 307 to the short address on the same path (`/en/catalog`, `/en/c/demo-tools`); `?brand=demo-brand` 200 without a redirect and is the checked brand facet; `?brand=demo-brand&page=1` -> `?f=brand%3Ademo-brand`; `?brand=&f=brand:x` 200; `?brand=a&brand=b` first wins; `?brand=<script>`, `?f=opt.color:"><img src=x>` (space), `?sort=<script>`, `?page=<script>`, `?price=2..1`, `?q=shirt` -> 404. No redirect loop found (the Location of every 307 answered 200 or 404 on the next hop). The redirect target is always `localizedHref(locale, searchPath(query, basePath))`: path-relative, no open redirect (a slug of `//evil.example` is percent-encoded).
- Escaping: `?f=brand:<script>alert(1)</script>` -> 200, the value appears only percent-encoded inside `href`s (`brand%3A%3Cscript%3E...`), never raw.
- Metadata: filtered or sorted views are `noindex, follow` with the plain list as canonical (`/en/c/demo-tools`), both `?brand=x` and `?f=brand:x` alike; the plain list has no robots tag.
- `SEARCH_ENABLED=false` hardness: the seed writes no synonym group and says "synonym groups not written: search is off" (spec and matrix `search-off` wording); `CatalogSeeder.fromContext` resolves `SEARCH_SYNONYM_SEEDER` only when `SEARCH_PORT.enabled`; `src/seed/` imports nothing of `src/search/` (`check:boundaries` below).
- Seed with search ON against a database without `search_synonym_group` (migration 0010 not applied): exit 1 with `Error: Failed query: select "id" from "search_synonym_group" ...` from `ensureSynonymGroups`; nothing silent (the catalog rows written before it are idempotent on the next run).
- Synonym content: 11 generic groups, no brand or client words, normalized per core `parseSynonymTerms` (spec). Against the engine: `spanner` finds the wrench (and the hammer, through its category name "Hammers and wrenches", the same as `wrench`); `рубашка` -> the linen shirt, `відвертка` -> the screwdriver, `толстовка` -> the hoodie (and the t-shirt through the category "Футболки та худі", the same as `худі`). `man`/`men`, `woman`/`women`, `foot`/`feet`, `mouse`/`mice`, `scarf`/`scarves`, `нога`/`ноги`/`нозі` match no seeded product (no cross-matching: Meilisearch synonyms match whole words, `woman` does not contain the word `man`); they are demo content only.
- Seed idempotency and edit semantics: documented and tested ("existing when any term is in a group of the locale": an edited group with one demo term kept is left alone, a deleted one is re-created); a group whose every demo term was replaced by an admin is created again (by design, documented in `seeds/README.md`).
- Tokens only: no colour, size or font literal in the PR's storefront diff; the notice uses `Alert variant="warning"` (`bg-muted`, `border-warning` tokens).
- Lint, typecheck, boundaries on the branch: see the end of this file.

## Not verified

- Bundle size delta against `main`: no `main` build was available and the disk (1.9 GB free) did not allow a second storefront build. On this branch `/en/catalog` references the same 12 scripts (628.7 KB) in search mode and in SQL mode, so a search-off shop also downloads the catalog route's search islands (`search-island` code is in chunk `1ysc5ewrtffr1.js`, 22.8 KB); the delta vs `main` is at most that chunk plus route glue, not measured.
- Unpublished, hidden-category or unsellable products leaking through facets: not reproduced (it would need admin writes during the review); the seeded catalog has none, and the indexer's own specs cover document visibility (earlier steps).
- The scheduler path for the synonym groups (job 13 on a tick): `search:reindex` was used instead, as the matrix does.
- `feature-matrix` modes `search-off`, `on|off|deleted`: not run here (CI runs them).
- `pnpm check:docs`, `check:licenses`, `audit:prod`: not run (no dependency change in the PR).
- The 60-second cache behaviour across the real production edge (nginx/Caddy) and `STOREFRONT_FORWARD_CLIENT_ADDRESS=true` (`infra/production.env.example`): reasoned from the code and the local proxy-less stack only.

## Checks on the branch

`pnpm lint` exit 0; `pnpm typecheck` passed (turbo, 22 cached); `pnpm check:boundaries`: modules cruised 2247, violations 0. Build: turbo cache hit for all 16 tasks.
