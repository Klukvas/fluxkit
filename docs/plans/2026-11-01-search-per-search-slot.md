# Search: one admission per search pass, and refusal counters (2026-11-01)

Status: approved by the owner (both items, through the orchestrator, 2026-11-01); implemented on branch `fix/search-per-search-slot-and-refusals`, no independent review yet.
Source: the deferred review findings F2 and F4 of `docs/plans/2026-10-31-search-engine-client.md` (PR 204, ADR 0041).

## Goal
1. **F2:** a search that is refused by the interactive lane (`engine_busy`: queue full or no slot within 1 s) must not spend engine work afterwards: no sibling call still waiting for a slot, none started later. A shopper who disconnects, and a call that reaches its deadline, leave no waiting call and no running engine request either.
2. **F4:** refusals must be visible without reading tens of warn lines a second: per-process counters and gauges in `GET /admin/search/status`, shown on the admin Search status screen, and a sampled log.

## What exists (checked before building)
- `engine/concurrency-limiter.ts`: FIFO, one slot per caller, bounded queue, a maximum wait; `LimiterRejection` reasons `queue_full`, `wait_exceeded`, `closed`; no weights, no abort signal, no counters.
- `engine/search-engine.ts`: every interactive call (`multiSearch`, `filterableAttributes`, `sortableAttributes`) acquires its own slot in `request()`; one deadline per call covers the wait and the exchange; no `AbortSignal`.
- `store/store-search.service.ts`: one search runs up to three engine passes in sequence (the two settings reads of `liveFieldsOf`, cached 30 s; the planned queries; the relaxed retry). A pass with several text queries sends one federated `multiSearch` per planned query through `Promise.all` (up to `SEARCH_MAX_PARALLEL_ENGINE_CALLS` = 10), each with its own `guard`, so each failing call logs its own warn line; suggest sends one call. Nothing passes the HTTP request's lifetime down: a shopper who left still has their calls queued and run.
- `search-rejections.ts` (`SearchRejections`): the per-process counter pattern (a small class with `record` and `snapshot`, shown in the admin status as `engine.rejectedSearches`).
- `@fluxkit/config` refuses `SEARCH_ENGINE_MAX_QUEUE=0` while `SEARCH_ENGINE_MAX_CONCURRENCY` is below 10 (review F3 of PR 204): with one slot per call a search could otherwise refuse itself.
- `@fluxkit/api-client` is hand-written (`admin-types.ts`) with contract tests against `docs/api/openapi.json`; the admin screen is `apps/admin/src/areas/search/search-status-view.tsx` with view models in `search-view.ts`.
- No Nest-wide request timeout exists; the per-call 2 s search deadline is the only timeout of a search pass.

## Design chosen: one admission per pass (b), with an abort signal for disconnects (a small part of a)
- **Admission.** `SearchEngine.withAdmission(calls, {timeoutMs, signal}, work)` takes `min(calls, SEARCH_ENGINE_MAX_CONCURRENCY)` slots of the interactive lane at once, FIFO, before any call of the pass starts. The pass is admitted or refused as a whole (`engine_busy`), so a refusal never leaves sibling calls behind. Inside the admission the pass's calls (`multiSearch`, `filterableAttributes`, `sortableAttributes` with `{admission}`) run on the admission's own slots, never on the shared queue; a pass with more calls than slots (only when the limit is below the pass size) runs at most that many at once. A call without an admission takes a one-slot admission of its own (the old behaviour, kept for other callers and the tests).
- **N keeps its meaning.** `SEARCH_ENGINE_MAX_CONCURRENCY` stays "interactive engine calls in flight at once per process": an admission holds at most N slots and never runs more calls than it holds. `SEARCH_ENGINE_MAX_QUEUE` counts the slots waited for (a pass of k calls waits for `min(k, N)` slots), which equals "calls waiting" for the one-call passes that are most of the traffic. No variable is added, renamed or re-ranged.
- **Siblings and the caller.** The first failing call of an admission aborts the others (a waiting one never starts; one in flight has its request and socket destroyed); when `work` ends (value or error) whatever it left running is aborted, and the slots are released only after every call of the admission has settled, so no slot leaks and no request outlives the pass. `withAdmission` also takes an `AbortSignal`: the store controllers pass one that fires when the shopper's connection closes before the answer, which removes a waiting admission from the queue and aborts the running calls. The limiter gains `weight` and `signal` on `acquire` and the reason `aborted`.
- **Deadlocks:** admissions never nest: a call with an admission never touches the shared queue, and a call without one takes its own. A caller that, against the rule, calls without its admission while holding one cannot hang: every wait is bounded (1 s or the deadline), so it is refused.
- **Fairness:** strict FIFO by arrival over admissions of any weight: a one-slot suggest behind a waiting eight-slot pass waits (at most 1 s) instead of overtaking, so large passes are never starved; the price is that slots freed while the head waits for enough of them stay idle until it fits (head-of-line blocking). Measured, not assumed (below).
- **The `MAX_QUEUE=0` rule is obsolete and removed:** a pass on an idle lane is always admitted whatever the limits, so `0` with any concurrency now means only "refuse whenever no slot is free". Additive for the configuration: every value accepted before is still accepted; `docs/contracts/config.md` and `CHANGELOG.md` say so.
- **New error code `engine_aborted`** (the caller gave up: a sibling failed or the shopper left; never stored, never shown); the store answers it as `503` without a log line (the response usually cannot be delivered anyway).

### Alternatives
- **(a) alone, an `AbortSignal` through `multiSearch` that cancels siblings on a refusal:** removes the waiting siblings, but the siblings already granted have started; destroying them frees our slots while the engine may still be computing (whether Meilisearch stops a search whose client disconnected was not verified), so after every refusal the lane would admit more work than the engine finishes: the bound ADR 0041 relies on weakens exactly under overload. Keeping them running wastes the work F2 is about. It also keeps the `MAX_QUEUE=0` self-refusal.
- **(b) with one slot per search regardless of its size:** simplest, but N would mean searches, not calls: up to 10 N engine calls in flight, a silent change of the documented variable and of the measured default.
- **Weighted admission without FIFO (small passes overtake):** better utilisation, but large passes (facet-heavy searches) could starve.

## F4: counters and the log
- `ConcurrencyLimiter` counts granted acquisitions, refusals by reason (`queue_full`, `wait_exceeded`), abandoned waiters, and the high-water marks of slots in use and slots waited for; the engine counts the interactive calls it sent. `SearchEngine.interactiveLane()` returns a snapshot; the admin status shows it additively as `engine.interactiveLane: {maxConcurrency, maxQueue, inFlight, queued, inFlightHighWater, queuedHighWater, admitted, calls, refused: {queueFull, waitExceeded}, since}`. Per process, since the process started (like `rejectedSearches`).
- Log: the first refusal of a quiet period is one warn line (code, wait, word count, never the query, key or URL); further refusals are summed into at most one warn line per 30 s with the counts by reason; a window without refusals ends the period. A refused pass is one guard, so one line, not one per call.
- Admin screen: an "Interactive lane" block in the engine section (numbers, the refused share, a warning with the advice of ADR 0041 when anything was refused), i18n `uk` and `en`, tokens only.

## Files
- API: `apps/api/src/search/engine/concurrency-limiter.ts` (+ spec), `engine/search-engine.ts`, `engine/index.ts`, `engine/search-engine-transport.spec.ts`, new `store/busy-log.ts` (+ spec), `store/store-search.service.ts`, `store/store-search.controller.ts`, `store/store-search.spec.ts`, `admin/admin-search.schemas.ts`, `admin/admin-search.service.ts`, `admin/admin-search.spec.ts`.
- Config: `packages/config/src/env.ts`, `search.ts`, `search-env.spec.ts` (the obsolete rule).
- Client and admin: `packages/api-client/src/admin-types.ts`, `admin-contract.spec.ts`; `apps/admin/src/areas/search/search-view.ts`, `search-status-view.tsx`, specs, `apps/admin/src/messages/{uk,en}/search.json`.
- Docs: `docs/api/openapi.json` (regenerated), `docs/api/search.md`, `docs/files/api.md`, `docs/files/admin.md`, `docs/files/config.md`, `docs/contracts/config.md`, `CHANGELOG.md`, ADR 0042 (supersedes ADR 0041 decision 3 in part), `docs/adr/README.md`, `docs/HANDOFF.md`, `docs/plans/2026-10-31-search-engine-client.md` (F2 and F4 done).

## Risks
- Head-of-line blocking costs some throughput when large and small passes mix (measured below, indicative).
- A destroyed in-flight request (sibling failure, disconnect, deadline) frees its slots while the engine may still work on it, as the deadline already did under ADR 0041.
- Counters are per process (one API instance, HANDOFF section 2).
- `MAX_QUEUE` now counts slots: an operator who tuned it for calls of large passes sees the same number of waiting calls (a pass of k ≤ N calls waits for k slots).

## Verification
- TDD, failing first: limiter (weights, FIFO without overtaking, queue by weight, abort removes a waiter and lets the next in, a timed-out head lets smaller ones in, counters, high-water marks); transport against loopback servers (an admission refused sends nothing and leaves no waiter; a sibling failure aborts waiting and running siblings; abort while waiting and in flight; no slot leak after success, failure, abort, timeout and `close()`; FIFO across admissions; counters); store against a loopback engine counting requests (a refused federated search starts no engine call afterwards; a disconnect leaves no waiting call and destroys the running ones); busy log with fake timers; admin status and screen.
- `pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:env`, `check:docs`; the search tests, the full API suite and the admin tests against real services; `pnpm openapi:export` and the freshness test.
- If disk allows: the reduced overload run (3 000 products, concurrency 192) before/after: engine requests per refused search, the `503` rate and successful searches a second; indicative only.
