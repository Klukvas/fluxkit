# Search admission: tails of the PR 207 review and a re-measurement at 20 000 products (2026-11-01)

Status: the owner asked (through the orchestrator, 2026-11-01) for the open tails of the independent review of PR 207 (ADR 0043) and a re-measurement at 20 000 products. Branch `fix/search-admission-tails`. Results at the end.
Source: the review findings F1 to F3 of PR 207 (recorded in the orchestrator's review notes; summarised here), `docs/plans/2026-11-01-search-admission-followups.md`, ADR 0042 and ADR 0043, `docs/plans/2026-10-29-search.md` "Measurements at scale (2026-10-31)".

## What exists (checked before building)
- `apps/api/src/search/engine/concurrency-limiter.ts`: strict FIFO; `acquireUpTo` grants the head `min(weight, free)` slots (ADR 0043); `drain()` grants waiters while the head's minimum fits; `abandoned` is incremented for a signal aborted while queued AND for one already aborted on arrival.
- `engine/search-engine.ts`: `withAdmission` sizes `InteractiveAdmission` by the grant for its whole life (ADR 0043 decision 1: "a granted pass does not grow later"); its calls take a slot of a private `ConcurrencyLimiter` of that size, so with a 1-slot grant a pass of 10 calls runs fully serial inside its 2 s deadline.
- Multi-call passes exist only for searches with several text queries (one federated request per planned query, `store-search.service.ts` `run()`); browsing and single-text searches are one call.

## Findings and decisions
- **T1 (review F1, design): let a granted pass grow while nobody waits.** Recommended by the review; chosen over a minimum grant of `ceil(weight / 2)` because a minimum grant makes the head of the queue idle freed slots again until half its weight is free (the ADR 0042 defect that ADR 0043 removed), while growth never idles a slot and never takes one a waiter wants.
  - Limiter: `takeSpare()` takes one slot only when a slot is free AND the queue is empty (never queues, not an admission, counted in `inFlight`, released once); `watchSpare(listener)` is called from `drain()` when a slot frees and nobody waits, so a pass whose calls wait can take it at once (round robin among watchers).
  - Admission: the private limiter is sized by the weight asked for (`min(calls, N)`); the slots not granted are held by placeholders. A call that finds no private slot first tries `takeSpare()`, else watches for a spare while it waits; each spare replaces one placeholder. When a call ends and no call of the pass waits, one spare is given back at once (the pass shrinks to its grant), so a grown slot is held for one call at a time, not until the pass ends; whatever is left is given back with the grant after every call settled.
  - Invariants: strict FIFO for waiters (a spare is taken only with `queue.length === 0`); at most N slots in flight (a spare needs a free slot); a pass never holds more slots than `min(calls, N)` and never runs more calls than it holds; every slot released exactly once after the call on it settled; `inFlight` counts granted and spare slots; `admitted`/`granted` unchanged (a spare is not an admission).
  - Supersedes ADR 0043 decision 1 in part ("does not grow later") → ADR 0044.
- **T2 (review F2): an already aborted signal is not counted as `abandoned`.** It never waited, so it is not "given up while waiting"; it is refused with `aborted` as before and counted nowhere (the store cannot reach it in practice: no I/O between its passes). Smaller than rewording the description in six places; the field and its description stay; one behaviour line in the changelog.
- **T3 (review F3): pin "`drain()` grants every fitting waiter per release".** Spec: hold N with one `acquireUpTo`, queue N one-call waiters, release, expect all N granted and `inFlight === N`; mutant "grant the head, then return" must fail.

## Public contract
- No field added, removed or retyped. `engine.interactiveLane.abandoned` keeps its description (now exact). `inFlight` may include spare slots (it already counts slots held). Variables unchanged.

## Measurement (part 2)
- 20 000 products, same generator and query mix as 2026-10-31 (scratch scripts, not committed), a dedicated Meilisearch on a free port with a new data dir, a new scratch database ending `_test`; disk checked before each heavy step (about 2.9 GB free; stop above ~300 MB left).
- Branch code, and `origin/main` where cheap on the same data: first full build time; search/suggest p95 at concurrency 1/8/32 (64 if not saturated) incl. deep pages, `503` rate, `engine.interactiveLane` counters, number of `Search failed: engine_timeout` lines; catalog through search vs SQL; 50 edits/s for 180 s (oldest unsynced change, drain per tick); an `isFilterable` flip on a large attribute. Indicative: one shared 4-vCPU sandbox.

## Files
- `apps/api/src/search/engine/concurrency-limiter.ts` (+ spec), `engine/search-engine.ts`, `engine/search-engine-transport.spec.ts` or a new fake-timer admission spec.
- Docs: ADR 0044, `docs/adr/README.md`, `docs/api/search.md`, `docs/files/api.md`, `CHANGELOG.md`, `docs/HANDOFF.md`, `docs/plans/2026-10-29-search.md` (new subsection), this plan.

## Verification
- Failing first per tail; mutation checks (revert the implementation line, the new specs fail).
- `pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:env`, `check:docs`; search tests, full API suite, admin, api-client and config tests against real services; openapi freshness.
