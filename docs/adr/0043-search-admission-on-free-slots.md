# 0043. Search engine client: admit a waiting pass on the free slots

Status: accepted 2026-11-01 (the owner asked to fix every finding of the independent review of PR 206, through the orchestrator; plan `docs/plans/2026-11-01-search-admission-followups.md`). Supersedes in part ADR 0042 decision 1 ("takes `min(calls, SEARCH_ENGINE_MAX_CONCURRENCY)` slots at once") and decision 3 (head-of-line blocking while the head waits for all its slots). Keeps every other decision of ADR 0042, its limits, defaults and variables.

## Context

- Under ADR 0042 a waiting pass of weight w at the head of the queue was granted only when `inFlight + w <= N`. Slots freed meanwhile stayed idle, nobody behind could use them (strict FIFO), and the head was refused after its 1 s wait when the lane did not drain far enough (review F1 of PR 206).
- Reproduced in `concurrency-limiter.spec.ts` (fake timers): N = 2, two one-call passes hold a slot each (taken 600 ms apart, 1 200 ms each), a two-call pass arrives 100 ms after the second: one slot is free from 1 200 ms, yet the pass is refused at 1 700 ms (`wait_exceeded`); both slots are free together only at 1 800 ms. Under sustained load with slow calls, passes of weight N (facet-heavy, multi-word searches) were refused systematically, and the one-call passes behind them got in only once the head gave up.
- A pass can already run more calls than it holds slots: `InteractiveAdmission` runs the extra calls in series on its slots, inside the pass's one deadline (the path for passes larger than N).

## Decision

1. **Admission on the free slots.** The head of the interactive queue (or a pass arriving at an empty queue) is granted `min(weight, free)` slots as soon as at least one slot is free; the admission is sized by that grant, and calls beyond it run in series on its slots inside the pass's deadline. A granted pass does not grow later: slots freed afterwards go to the next in line.
2. **Kept from ADR 0042:** strict FIFO (only the head is ever granted, so nobody overtakes a waiting pass whatever the weights); the queue counts the slots a waiter asked for against `SEARCH_ENGINE_MAX_QUEUE` (a pass whose weight does not fit is refused with `queue_full`, as before); `SEARCH_ENGINE_MAX_CONCURRENCY` still bounds the engine calls in flight per process (a grant never exceeds the free slots and a pass never runs more calls than it holds); one admission per pass, admitted or refused as a whole before anything is sent; the counters.
3. **`SEARCH_ENGINE_MAX_QUEUE=0`** means "refuse whenever no slot is free" (what `.env.example` and ADR 0042 decision 2 already said); `docs/contracts/config.md` said "whenever the slots are not free" and is corrected. Every configuration accepted before is still accepted; some loads that were refused are now admitted.
4. `ConcurrencyLimiter.acquireUpTo` grants the partial weight; `acquire` keeps whole-weight grants for other callers.

## Consequences

- No slot idles while a pass waits, and a heavy pass is no longer refused for waiting for N slots together: it needs one free slot at the head of the queue, like a one-call pass.
- A heavy pass admitted on fewer slots than calls runs part of its calls in series; when they do not fit in the 2 s deadline it ends in `engine_timeout` (logged as a failed search, `503`) instead of `engine_busy`, after spending some engine work.
- Reduced load run (3 000 products, concurrency 192, one shared sandbox; plan "Results", indicative): in the full search mix the `503` share fell from 18.6 to 24.2 % to 13.7 to 16.0 % with throughput and p95 within the noise, and no `engine_timeout` was logged; one-call passes (catalog pages) are unchanged. Not measured at 20 000 products or on production hardware.
- The admin screen and `docs/api/search.md` describe admission on the free slots.
