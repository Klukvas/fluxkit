# Search admission: tails of the PR 207 review and a re-measurement at 20 000 products (2026-11-01)

Status: the owner asked (through the orchestrator, 2026-11-01) for the open tails of the independent review of PR 207 (ADR 0043) and a re-measurement at 20 000 products. Implemented on branch `fix/search-admission-tails` (results at the end); PR 208 open, independently reviewed (findings F1 to F6 fixed on the branch, see "Review follow-ups of PR 208").
Source: the review findings F1 to F3 of PR 207 (recorded in the orchestrator's review notes; summarised here), `docs/plans/2026-11-01-search-admission-followups.md`, ADR 0042 and ADR 0043, `docs/plans/2026-10-29-search.md` "Measurements at scale (2026-10-31)".

## What exists (checked before building)
- `apps/api/src/search/engine/concurrency-limiter.ts`: strict FIFO; `acquireUpTo` grants the head `min(weight, free)` slots (ADR 0043); `drain()` grants waiters while the head's minimum fits; `abandoned` is incremented for a signal aborted while queued AND for one already aborted on arrival.
- `engine/search-engine.ts`: `withAdmission` sizes `InteractiveAdmission` by the grant for its whole life (ADR 0043 decision 1: "a granted pass does not grow later"); its calls take a slot of a private `ConcurrencyLimiter` of that size, so with a 1-slot grant a pass of 10 calls runs fully serial inside its 2 s deadline.
- Multi-call passes exist only for searches with several text queries (one federated request per planned query, `store-search.service.ts` `run()`); browsing and single-text searches are one call.

## Findings and decisions
- **T1 (review F1, design): let a granted pass grow while nobody waits.** Recommended by the review; chosen over a minimum grant of `ceil(weight / 2)` because a minimum grant makes the head of the queue idle freed slots again until half its weight is free (the ADR 0042 defect that ADR 0043 removed), while growth never idles a slot and never takes one a waiter wants.
  - Limiter: `takeSpare()` takes one slot only when a slot is free AND the queue is empty (never queues, not an admission, counted in `inFlight`, released once); `watchSpare(listener)` is called from `drain()` when a slot frees and nobody waits, so a pass whose calls wait can take it at once (round robin among watchers).
  - Admission: the private limiter is sized by the weight asked for (`min(calls, N)`); the slots not granted are held by placeholders. A call that finds no private slot first tries `takeSpare()`, else watches for a spare while it waits; each spare replaces one placeholder. When a call ends while another pass waits in the lane's queue, or while no call of the pass waits, one spare is given back at once (the pass shrinks towards its grant), so a grown slot is held for one call at a time while anyone queues, not until the pass ends (corrected after review F1 of PR 208: the first version gave it back only when no call of the pass waited).
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

## Results (2026-11-01)
- **Failing first** (specs written before the code, run against `origin/main`'s code): 8 red: T2 (`abandoned` 1 instead of 0 for an aborted arrival), `takeSpare`/`watchSpare` missing (2), and every admission spec (the moderate-load probe ended `engine_timeout` for some passes; the idle-slots pass ran on 1 slot; FIFO, release and abort specs: the pass never grew). T3 passed against the existing code (it pins behaviour), so it was mutation-checked instead. All green after the change.
- **Mutation check** (one mutant at a time, limiter + admission + transport specs, file restored after each): killed: `takeSpare` ignores the queue (FIFO), ignores `maxInFlight` (bound), counts as `granted`; `drain()` offers no spares; no round robin among watchers; no growth at call entry; no shrink after a call; shrink gives a lane slot back without taking its private slot (more calls than slots); shrink before the call's private release; settle does not stop watching (watcher leak); growth beyond the waiting calls (hangs); T2 counting an aborted arrival again; **T3 "`drain()` grants the head then returns" (the PR 207 survivor) now killed**. Growth disabled while keeping the rest (a temporary switch, removed): 5 of the 6 admission specs red (only the saturation spec, which pins that nothing grows, passes).
- **Two dead branches removed instead of tested:** releasing spares in `settle()` (every spare is already given back by `#shrink` when its call ends while no call of the pass waits) and the `open`/`aborted` guards of `#grow` (an aborted call is removed from the private queue at once, so nothing waits). Mutants of them survived because they are unreachable.
- **T1 evidence: policy comparison** (scratch fake-timer harness, the real engine client with tasks that only wait, N = 8, 2 s deadline; heavy outcome counts, browse = one-call passes):

| Load shape | ADR 0043 | growth (ADR 0044) | minimum grant `ceil(w/2)` | both |
|---|---|---|---|---|
| S1 saturation: 8 browsers renewing 100 ms pages, 20 heavy passes 5 x 250 ms | heavy p50 1 550 ms, browse p95 400 ms | same (nothing grows: the queue is never empty) | heavy p50 950 ms, browse p95 750 ms | as minimum grant |
| S2 overload: 6 browsers, 15 heavy passes 10 x 250 ms every 300 ms | 14 of 15 heavy `engine_timeout` | 13 `engine_timeout` | 11 ok, 4 heavy and 18 browse `engine_busy` | as minimum grant |
| S3 intermittent: 8 browsers with 50 ms think time, 16 heavy 8 x 250 ms | 10 of 16 heavy `engine_timeout` | **2** `engine_timeout`, browse p95 550 ms (was 500) | 0 timeouts, browse p95 800 ms | 0 timeouts, browse p95 650 ms |
| S4 light: 4 browsers, 10 heavy 10 x 200 ms | heavy p50 2 100 ms | **500 ms**, browse p95 200 ms (was 100) | 700 ms, browse p95 300 ms | 500 ms |

  Decision: growth (ADR 0044). It never adds a refusal or a timeout and never idles a slot; the minimum grant removes timeouts under saturation but idles freed slots at the head again and refuses one-call passes (catalog pages) under overload. Limit stated in ADR 0044: under sustained saturation a heavy pass does not grow (FIFO wins), pinned by a spec.
- **Re-measurement at 20 000 products:** plan `docs/plans/2026-10-29-search.md`, "Re-measurement at 20 000 products (2026-11-01)". No `engine_timeout` of a multi-call pass with either code; ADR 0043 and ADR 0044 within the noise on that load loop; sustained 50 edits a second and the flag flip now meet their targets.
- Throughput note: in the policy comparison one-call (browse) passes completed slightly less often under growth (S2 290 to 283, S3 222 to 214, S4 271 to 245): heavy passes used the spare slots.

## Review follow-ups of PR 208 (2026-11-01)
Independent review: no blocker, one major. Fixed on this branch, each with a spec that failed first (`red-pr208` log: 2 red before the code change).
- **F1 (major): a spare served the pass's backlog while another pass queued.** With more calls than N (N = 2, a 10-call pass of 250 ms calls grown onto the second slot, a catalog page queued at 11 ms) the page waited the whole backlog and was refused `engine_busy` after 1 s. Now, when a call ends while the pass holds a spare and someone waits in the lane's queue, its private slot becomes a placeholder and the spare goes back to the lane (the waiter gets it); the pass grows again once nobody waits. Spec "a pass with more calls than N gives a spare back ..." red before (the page was still waiting at 311 ms), green after: the page ends by 300 ms, the heavy pass still ends `ok`, no refusal.
- **F2:** HANDOFF and this plan say PR 208 is open.
- **F3:** ADR 0044 decision 1 and its consequence, this plan, `docs/files/api.md` and the changelog say when a spare is given back as the code does it now.
- **F4:** the "call issued later" spec asserts the start times before awaiting the pass, so the mutant "no growth at call entry" fails by assertion, not by a 20 s timeout. (The earlier mutation logs list that mutant as SURVIVED because the spec was added after them; the run below supersedes them.)
- **F5: round robin per slot.** `offerSpares` goes round the watchers while slots stay free, and an admission's watcher takes at most one spare per offer, so slots freed together are shared among the waiting passes (limiter spec: 3 slots freed at once, two watchers wanting 2 each: a, b, a; before: a, b and the third slot idled; admission spec: two growing passes each get one of two slots freed together).
- **F6:** `withAdmission` constructs the admission inside the `try`, so a constructor error can no longer hold the grant.
- **Mutation run after these fixes** (17 mutants, one at a time): all killed, including the three new ones (F1 revert, a single offer round, a watcher taking every slot it wants in its turn); "no growth at call entry" now fails by assertion.
