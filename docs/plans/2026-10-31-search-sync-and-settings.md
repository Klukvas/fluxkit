# Search sync throughput and in-place settings (2026-10-31)

Status: implemented (branch `fix/search-sync-throughput-and-settings` pushed, no PR, no independent review yet); both items approved by the owner through the orchestrator on 2026-10-31. Results: section "Results" at the end.
Source: `docs/plans/2026-10-29-search.md`, "Measurements at scale (2026-10-31)": the incremental-lag target missed under sustained load (table 4, "Targets") and finding F2.

## Goal
- **A, throughput of job 13:** a sustained 50 product changes a second drains: lag at most two ticks (60 s each) at 50 changes a second. Today job 13 syncs at most 2 000 products a run (about 33 a second), so the queue grows by 800 to 1 000 rows a minute and the oldest change reached 120 s after 3 minutes.
- **B, F2:** an attribute flag change on more than 5 000 products must not rebuild every locale when only the index settings change; when documents must change, requests made while a rebuild is pending or running give ONE build, never two back to back.

## What exists (checked before building)
- **The cap (A).** Core `SEARCH_INDEXING` (`packages/core/src/search/indexing.ts`): `syncPageSize` 100, `syncMaxPages` 20, `taskTimeoutMs` 20 000. `SearchIndexer.sync` (`apps/api/src/search/indexer/search-indexer.ts`) loops pages until 20 pages or the job budget (`JobBudget`, 30 s, `apps/api/src/jobs/job-budget.ts`, checked before each page: a page that has begun finishes). Per page: claim (`FOR UPDATE SKIP LOCKED`, 120 s lease), one read of the products (`readSearchProducts`), per locale `addDocuments` (batches of 1 000) and one or more delete-by-filter tasks, then wait for every task in order, then `settleSynced` (delete where `change_seq` is the claimed one). One engine failure ends the run. The plan text says "job 12"; the code and `docs/api/jobs.md` say job 13.
- **The rule (B).** The fan-out writers call `SearchPort.productsChangedWhere`; above `fanOutRebuildThreshold` (5 000) `SearchQueue.requestRebuild` sets `search_index_state.rebuild_requested_at = now()` for every locale; core `decideIndexAction` then answers `rebuild` (cause `requested`), job 13 pauses and job 14 builds and swaps. There is NO comparison of a settings fingerprint for this path: the attribute PATCH (`attributes.service.ts`) fans out on ANY change (name, description, validation, every flag), and the settings hash (`deriveIndexSettings`) is applied in place by job 13 only when no rebuild is due.
- **Why a flag change needs documents today.** Core `buildSearchDocuments` writes the filter field `attr_<code>` only when the attribute `isFilterable`, and `attributeText`/`stems` only when `isSearchable`; `isVisibleOnStorefront`/`isInternal` decide whether the attribute appears at all (public-data rule); `unit` is part of the searchable text of number attributes. `isComparable`, `isSortable`, `name`, `description`, `validation` reach neither the documents nor the settings. ADR 0034 decision 5 and plan section 3 say settings changes are applied in place by job 13; that is true for the settings hash, but the attribute PATCH always fanned out, so above 5 000 products every flag change (even `isComparable`) requested a full rebuild (F2).
- **Coalescing today.** `completeSwap` clears a request made at or before `build_started_at` (app clock) and keeps a later one, which then rebuilds everything again after the swap (two builds). The request stamp is the requesting transaction's START time (`now()`), so a request whose transaction started before the build but committed after the build read its definitions is cleared although early pages missed it (a narrow lost-update race).
- **Not contract:** the document shape, `SEARCH_DOCUMENT_VERSION`, index settings, job budgets (`docs/contracts/search.md`, "What is not contract"). No schema change is needed.

## Design
### A: job 13 throughput (exact numbers chosen from the profile below)
- Profile a run at 3 000 products (time per phase: claim, read and build, `addDocuments`, delete, waiting for tasks, settle).
- Candidates, smallest safe first: drop the page cap in favour of the existing 30 s budget when there is a backlog (catch-up), larger pages, overlapping the engine wait of one page with the read of the next. Keep: claim with lease and `SKIP LOCKED`, delete only `WHERE product_id AND change_seq = claimed`, add before delete per index (tasks of one index run in order), backoff on failure, one failure ends the run, job 13 paused during a rebuild, budget checked between pages, coalescing upsert unchanged.

### B1: settings-only changes in place
- Documents carry the filter field of every PUBLIC attribute of a filterable input type whether or not it is filterable (`SEARCH_DOCUMENT_VERSION` 2 -> 3: one rebuild at upgrade, as for every version). `isFilterable` then only changes `filterableAttributes` (settings hash), applied in place by job 13 at the next tick (measured 2.8 to 3.1 s per index at 63 000 documents). A non-filterable field is stored but never filterable (not in `filterableAttributes`), never displayed (`displayedAttributes` is fixed) and never searched (`searchableAttributes` is fixed); the public-data rule is unchanged (only public attributes).
- A pure core rule `attributeChangeAffectsSearchDocuments(before, after)`: true only for `isSearchable`, `isVisibleOnStorefront`, `isInternal`, `unit`, `inputType`, `isLocalized`. The attribute PATCH fans out only then; `isFilterable`, `isComparable`, `isSortable`, `name`, `description`, `validation` enqueue nothing and request nothing.
### B2: coalescing of rebuilds
- A request is "absorbed" by a build run that READ it before reading the definitions (requester writes definitions and request in one transaction, so a visible request means visible definitions). Job 14 reads `search_index_state` first, then the definitions; it clears exactly the request value it read (`... = case when rebuild_requested_at = <read> then null ...`) when it starts a build, and when a build is running and a request is pending it starts the build over from the first product in the same build index (documents are replaced by id) instead of building again after the swap (not while a locale has no live index: a working index first, then a follow-up build). A request that arrives during the last run of a build is built after the swap (the swap answers nothing). Requests become strictly increasing per row (`greatest(now(), previous + 1 microsecond)`), so clearing "the value I read" can never clear a newer request with an equal timestamp. `completeSwap` no longer clears requests.
- Result: changes A and B within seconds give one build whether B lands before the build starts or while it runs; the build that swaps used definitions that include every absorbed request.
- Risk kept as today: a stream of definition changes faster than a build starves the swap (today it gave back-to-back builds); job 13 is paused either way.

## Files
- `packages/core/src/search/indexing.ts` (constants, rebuild rules), `document.ts` (filter fields), `limits.ts` (document version), new rule for attribute changes, their specs.
- `apps/api/src/search/indexer/search-indexer.ts`, `search-index-state.repository.ts`, `apps/api/src/search/queue/search-queue.ts`, `apps/api/src/catalog/admin/attributes/attributes.service.ts`, `apps/api/src/jobs/search-index.jobs.ts` (comment), specs in `apps/api/src/search/indexer/` and the attribute/write-path specs.
- Not touched: `apps/api/src/search/engine/*`, `search-config.ts`, `search.module.ts`, `src/test/search-world.ts` (open PR 204). No migration, no new env var, no new dependency, no ADR unless the coalescing rule needs one (then 0042).
- Docs: `docs/api/jobs.md`, `docs/files/api.md`, `docs/files/core.md`, `CHANGELOG.md`, `docs/contracts/search.md` (only the "what is not contract" wording if needed), `docs/HANDOFF.md`, a follow-up paragraph under "Measurements at scale".

## Risks
- Larger runs of job 13 take more of the tick (still within its 30 s budget plus one page).
- Document version bump: every deployment rebuilds once at upgrade (job 14, sync paused for the build; 3.5 min at 20 000 products).
- Starting a build over discards the pages already built; total time to fresh is never longer than today's second build.

## Verification
- TDD: failing specs first for the budget/cap logic, the attribute rule, the document filter fields, the request/absorb/start-over rules and the scenario "flag A, flag B within seconds -> zero or one rebuild"; existing write-path and queue specs unchanged.
- `pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:env`, `check:docs`, the search specs and the full API suite on a scratch `_test` database and a dedicated Meilisearch.
- Indicative before/after: drain rate and oldest unsynced change under 50 edits a second for about 3 minutes at 3 000 products (more if the disk allows).

## Results (2026-10-31; one shared 4-vCPU sandbox, Meilisearch v1.55.0 on its own data directory, the built API with the scheduler at 60 s; indicative)
- **Profile of one job 13 run (3 000 products, 2 700 queued, before):** 2 000 synced in 4.4 to 4.6 s, then the page cap; per page of 100 about 220 ms: read and build 75 ms, `addDocuments` 22 ms, delete by filter 23 ms (2 tasks per locale), waiting for the 6 tasks 96 ms (engine busy 1.5 s of the run), claim and settle 8 ms. The 30 s budget was never reached: the cap was the limit. Decision: drop the cap (smallest change); larger pages, pipelining and one delete per locale were not needed for the target.
- **After:** 2 700 in 5.2 to 5.5 s (490 to 515 a second); at 9 000 products 6 000 in 13.8 to 14.0 s (430 a second), so one run can sync about 13 000 products.
- **50 edits a second for 180 s** (admin `PATCH` of titles, queue sampled every second):

| Catalog | Code | Max queue | Oldest unsynced change | All searchable after the last write |
|---|---|---|---|---|
| 3 000 products (2 618 edited, edits repeat) | before | 2 618 | 91 s | 86.5 s |
| 3 000 products | after | 2 618 | **59 s** | **6.1 s** |
| 9 000 products (7 875 edited) | before | 3 962 (growing per tick) | 119 s | 96.7 s |
| 9 000 products | after | 3 013 (drained at every tick) | **60 s** | **43.8 s** |

- **F2 at 9 000 products:** `isFilterable` off and on for `material` (6 734 products, above the 5 000 limit): no rebuild request, no queue row, settings fresh at the next tick (64.2 s and 58.9 s including the wait for the tick). The upgrade to document version 3 rebuilt the 9 000-product indexes once (about 130 s from API start, including the wait for the first tick).
- **Failing first:** core `document.spec.ts` 5 new cases red before (filter value of a non-filterable attribute, version 3, the attribute rule missing); API: 10 new cases red on the old code (`search-indexer.spec.ts` backlog drained 2 000 of 2 150 with `truncated: true`, and the next two cases on the rows it left; `search-rebuild-coalescing.spec.ts` 6 cases: rebuild requested by `isFilterable` and `isComparable`, a second build after the swap, the request stamped before the build cleared, no `restarted`, equal stamps in one transaction; `write-path.spec.ts` marks on `isFilterable`). All green after; existing write-path, queue and indexer specs unchanged.
- **No ADR:** ADR 0034 already says a filterable or synonym settings change is applied in place; the code now does that for attribute flags. The request rule is an implementation detail of job 14 (`docs/api/jobs.md`). No engine-client change, no migration, no new env var.
