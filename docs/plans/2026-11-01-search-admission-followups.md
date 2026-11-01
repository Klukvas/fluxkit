# Search admission: review follow-ups of PR 206 (2026-11-01)

Status: the owner asked to fix every finding of the independent review of PR 206 (ADR 0042), through the orchestrator, 2026-11-01. Implemented on branch `fix/search-admission-review-followups` (results below); no independent review yet.
Source: the review of `fix/search-per-search-slot-and-refusals` (findings F1 to F7, recorded in `docs/plans/2026-11-01-search-per-search-slot.md`, "Review follow-ups").

## What exists (checked before building)
- `apps/api/src/search/engine/concurrency-limiter.ts`: strict FIFO over weights; `drain()` grants the head only when `active + weight <= maxInFlight`; counters `granted`, `refusedQueueFull`, `refusedWaitExceeded`, `abandoned`, high-water marks.
- `engine/search-engine.ts`: `withAdmission(calls, ...)` asks for `min(calls, N)` slots; `InteractiveAdmission` already runs a pass whose calls outnumber its slots serially on its own private limiter, inside one deadline (that path exists for `calls > N`). `interactiveLane()` omits `abandoned`. `InteractiveAdmission.call` throws `engine_busy` when the deadline elapsed after the slot came, but `engine_timeout` when the private wait itself ran out.
- `store/store-search.service.ts` `guard()`: `error.code === "engine_aborted" || signal?.aborted === true` silences any engine error when the shopper's signal fired, `engine_rejected` included.
- Admin: `laneView().refusedShare = refused / (admitted + refused)`; copy "of the searches asked for", "Searches let through".
- `.env.example` and ADR 0042 say `SEARCH_ENGINE_MAX_QUEUE=0` refuses when "no slot is free"; `docs/contracts/config.md` says "whenever the slots are not free" (the code: the slots ASKED FOR).

## F1 decision: admit the head with the free slots (partial grant)
- **Defect, reproduced deterministically** (limiter spec with fake timers, the review's scenario): N = 2, two one-call passes hold a slot each, the second taken 600 ms after the first, each for 1 200 ms; a two-call pass arrives 100 ms later with the 1 s wait. Strict whole-weight FIFO: one slot is free from 1 200 ms, nobody may use it (the head needs two), and the head is refused at 1 700 ms (`wait_exceeded`) although a slot idled for 500 ms. Under sustained load with slow calls, passes of weight N are refused systematically and the smaller passes behind them get in only after the head gave up.
- **Change:** the head of the queue is granted `min(weight, free)` slots as soon as at least one slot is free (also on arrival with an empty queue); the admission is sized by the grant, and its calls beyond the granted slots run serially on them inside the same deadline (the existing `slots < calls` path).
- **What stays:** strict FIFO (only the head is ever granted, nobody overtakes); the queue accounting (a waiter counts the slots it asked for against `SEARCH_ENGINE_MAX_QUEUE`, so `queue_full` is unchanged); the bound "N = engine calls in flight per process" (a grant never exceeds the free slots, a pass never runs more calls than it holds); one admission per pass, refused as a whole before anything is sent.
- **No starvation:** a heavy pass now needs one free slot at the head of the queue, like a one-call pass; it can no longer be refused for waiting for all N together.
- **Price (accepted):** a heavy pass admitted with fewer slots than calls runs part of its calls in series; when they do not fit in the 2 s deadline it ends in `engine_timeout` (logged, counted nowhere new) instead of `engine_busy`, after spending some engine work. A pass does not grow its grant later (kept simple; slots freed later go to the next in line).
- **`MAX_QUEUE=0`** now means "refuse whenever no slot is free" (a pass on a lane with one free slot is admitted on it). That is what `.env.example` and ADR 0042 already say; `docs/contracts/config.md` and the limiter's comment are corrected (F7). More configurations admit work than before; nothing accepted before is refused now (additive).
- **ADR 0043** supersedes ADR 0042 decision 1 ("takes `min(calls, N)` slots at once") and decision 3 (head-of-line blocking) in part.
- Measurement: the reduced load run of PR 206 (3 000 products, concurrency 192) if disk allows; the deterministic spec is the evidence either way (results below).

## Other findings
- **F2 (tests only):** pin "slots released only after every call settled" (a third admission is not granted while a destroyed sibling is still in flight), "the first failure aborts the siblings" (`Promise.allSettled` in `work`, sibling `engine_aborted` while `work` runs), listener removal (`events.getEventListeners(signal, "abort")` empty after settle for the limiter and the engine, also with a 10-call pass). Mutation-checked.
- **F3:** `engine_timeout` in both branches of `InteractiveAdmission.call` (the deadline ran out, not the lane): no misleading lane-refusal log line.
- **F4:** `abandoned` (waiters whose shopper left while queued) shown additively as `engine.interactiveLane.abandoned` (schema, `openapi.json`, `api-client`, `docs/api/search.md`, admin block `uk`/`en`).
- **F5:** reword, not recount: a refused admission always ends its search (so the refused COUNT is searches), but `admitted` counts admissions (1 to 3 per search), so the share is a share of admissions. Copy and docs say "of the admissions asked for (a search asks for 1 to 3)" and "Admissions let through". Counting per search would need a store-side counter threaded into the engine's snapshot and a new field; rewording is the smaller correct fix.
- **F6:** `guard()` silences only `engine_aborted`; an `engine_rejected` during a disconnect is still logged, counted and drops the `liveFields` cache.
- **F7:** wording of `MAX_QUEUE=0` aligned (see F1).

## Public contract
- `GET /admin/search/status`: additive field `engine.interactiveLane.abandoned` (integer). No field removed or retyped.
- `SEARCH_ENGINE_MAX_QUEUE`/`SEARCH_ENGINE_MAX_CONCURRENCY`: same names, ranges and defaults; admission now uses the free slots (ADR 0043).

## Files
- API: `engine/concurrency-limiter.ts` (+ spec), `engine/search-engine.ts`, `engine/search-engine-transport.spec.ts`, `store/store-search.service.ts`, `store/store-search.spec.ts`, `admin/admin-search.schemas.ts`, `admin/admin-search.spec.ts`.
- Client and admin: `packages/api-client/src/admin-types.ts`, `admin-contract.spec.ts`; `apps/admin/src/areas/search/search-view.ts`, `search-status-view.tsx`, specs, `apps/admin/src/messages/{uk,en}/search.json`.
- Docs: `docs/api/openapi.json` (regenerated), `docs/api/search.md`, `docs/contracts/config.md`, `.env.example`, `docs/files/api.md`, `CHANGELOG.md`, ADR 0043, `docs/adr/README.md`, `docs/HANDOFF.md`, `docs/plans/2026-11-01-search-per-search-slot.md`.

## Verification
- Failing first per finding, then green; mutation checks for F2.
- `pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:env`, `check:docs`; search tests, full API suite, admin, api-client and config tests against real services; `pnpm openapi:export` and the freshness test.

## Results (2026-11-01)
- **Failing first** (the spec red against the code before the fix, green after):
  - F1: limiter 5 new specs red (`acquireUpTo` missing); transport "admits a waiting pass on the first free slot" red against the old engine (the pass was still waiting when the freed slot came: `condition not reached in time`, then `engine_busy`). Mutant "grant only the whole weight" (the ADR 0042 rule, in `drain()` or on arrival): killed by the review-scenario spec, the FIFO spec and the empty-queue spec. The review scenario with the old rule ends in `wait_exceeded` at 1 700 ms while a slot is free from 1 200 ms; with the new rule the head is granted 1 slot at 1 200 ms.
  - F2 (tests of existing behaviour, so mutation-checked instead): release before `settle()` killed by "releases a pass's slots only after every call settled"; no sibling abort in `call()` killed by the `Promise.allSettled` spec; `withAdmission` keeping its listener killed by 2 specs; the limiter never detaching killed by 3 specs (one in the limiter spec); an attempt keeping its listener killed by the 10-call spec. All five survived before (review), all killed now.
  - F3: transport spec red (`expected 'engine_busy' to be 'engine_timeout'`), green after.
  - F4: transport 2 red (`abandoned` missing), api-client contract 1 red, admin view 1 red, admin screen 1 red; green after `openapi.json` was regenerated.
  - F5: copy only (the screen spec checks the keys, not the wording).
  - F6: store admission spec red (the 400 during a disconnect was not counted: `condition not reached in time`), green after.
- **No starvation, no overtaking, bound kept:** limiter specs "keeps strict FIFO: the partly granted head does not grow, and the caller behind it gets the next free slot without overtaking" and "never holds more than maxInFlight under a burst of mixed weights" (60 acquisitions of weights 1 to 4 on 4 slots); transport spec: the pass's second call runs on its own slot after its first, the one-call pass queued behind it gets a slot only after the pass, `inFlightHighWater` stays at N.
- **Reduced load run** (indicative; same shared 4-vCPU sandbox runs the engine, Postgres, the API and the load loop; 3 000 products, 19 664 documents; the PR 206 load loop and mixes, 15 s per run, two rounds alternated). "before" = this branch with only the old admission rule restored (a pass waits for all its slots), "after" = this branch; both 8-512. The sandbox was slower than during the PR 206 run (fewer successful searches a second at concurrency 32), so compare within this table only.

| Mix, concurrency | Client | search `503` | successful searches/s | engine requests | page p95 |
|---|---|---|---|---|---|
| catalog through search, 32 | before / after | 0 % / 0 % | 79 to 81 / 78 to 82 | 1 223 to 1 240 / 1 197 to 1 248 | 600 to 603 / 614 to 616 ms |
| catalog through search, 192 | before | 34.2 to 38.9 % | 66 to 74 | 1 101 to 1 195 | 2 074 to 2 422 ms |
| catalog through search, 192 | after | 36.7 to 40.1 % | 70 to 76 | 1 140 to 1 232 | 1 936 to 2 222 ms |
| full search mix, 32 | before / after | 0 % / 0 % | 126 to 130 / 131 to 132 | 3 570 to 3 701 / 3 710 to 3 736 | 369 to 377 / 362 to 371 ms |
| full search mix, 192 | before | 18.6 to 24.2 % (mean 22.2) | 105 to 112 | 2 861 to 3 034 | 1 589 to 2 663 ms |
| full search mix, 192 | after | 13.7 to 16.0 % (mean 14.8) | 106 to 114 | 3 110 to 3 427 | 1 730 to 2 912 ms |

- Reading: in the full mix (where passes of several calls exist) the `503` share fell from 18.6 to 24.2 % to 13.7 to 16.0 % (four runs each, ranges do not overlap) and the engine did more work (more passes admitted), with successful searches a second and p95 within the run-to-run noise. The catalog mix sends one call per pass, so the change cannot apply there; its numbers overlap. No `engine_timeout` line was logged in any run (the cost named under "Price" did not show here). Indicative only: one shared sandbox, short runs.
- Not measured: the 20 000-product catalog, a real storefront in the loop, client disconnects under load, several API instances.
