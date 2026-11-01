# 0042. Search engine client: one admission per search pass, refusal counters

Status: accepted 2026-11-01 (owner approval of the two follow-ups F2 and F4 of the PR 204 review, through the orchestrator; plan `docs/plans/2026-11-01-search-per-search-slot.md`). Supersedes in part ADR 0041 decision 3 (one slot per call); keeps its limits, defaults and variables.

## Context

- ADR 0041 put the store's engine calls behind a FIFO limit with one slot per call. One store search pass sends up to 10 calls at once (`Promise.all` of the planned queries when there are several text queries; two settings reads). When one call was refused (`engine_busy`), the search answered `503` at once, but its siblings were not stopped: granted ones ran on the engine and waiting ones kept their queue places for up to 1 s, then ran (review F2). A search could also refuse itself on an idle lane when the queue was shorter than its fan-out, hence the configuration rule "no queue of 0 below a concurrency of 10" (review F3).
- Nothing passed the HTTP request's lifetime down: a shopper who left still had calls queued and run.
- Refusals were visible only as one warn line each: tens of lines a second under overload, nothing in `GET /admin/search/status` (review F4), although ADR 0041 tells operators to raise `SEARCH_ENGINE_MAX_CONCURRENCY` for a bigger engine.

## Decision

1. **One admission per pass.** `SearchEngine.withAdmission(calls, {timeoutMs, signal}, work)` takes `min(calls, SEARCH_ENGINE_MAX_CONCURRENCY)` slots at once before any call of the pass starts; the pass is admitted or refused as a whole. Its calls (`{admission}`) run on those slots only, at most as many at once as it holds, under one deadline; a single call without an admission takes an admission of one. The store uses one admission for the two settings reads and one per pass of planned queries.
2. **Meaning of the variables kept.** `SEARCH_ENGINE_MAX_CONCURRENCY` still bounds engine calls in flight per process; `SEARCH_ENGINE_MAX_QUEUE` counts slots waited for (equal to calls for one-call passes). The rule refusing a queue of 0 below a concurrency of 10 is removed: an idle lane always admits a pass. Every configuration accepted before is still accepted.
3. **Strict FIFO across weights:** a small pass never overtakes a larger one that waits (no starvation of facet-heavy searches; the price is head-of-line blocking while the head waits for enough slots, bounded by the 1 s wait).
4. **Siblings and callers stop together.** The first failing call aborts the others (a waiting one never starts, a running one has its request and socket destroyed); when `work` ends, whatever it left running is aborted; the slots are released only after every call has settled. The store routes pass an `AbortSignal` that fires when the connection closes before the answer, which takes a waiting pass out of the queue and destroys its running calls. The new code `engine_aborted` (never stored, never shown) is answered `503` without a log line.
5. **No nesting, so no deadlock:** a call with an admission never touches the shared queue. Every wait is bounded (1 s or the deadline), so even a misuse cannot hang.
6. **Visibility.** The limiter counts granted admissions, refusals by reason (`queue_full`, `wait_exceeded`) and the high-water marks of slots held and waited for; the engine counts the calls it sent. `GET /admin/search/status` shows them additively as `engine.interactiveLane` (with the limits and the current gauges), and the admin Search status screen shows them with ADR 0041's advice once anything was refused. The log shows the first refusal of a quiet period and then at most one summary line per 30 s with the counts by reason. All per process.

## Consequences

- A refused search spends no engine work; a disconnected shopper's search stops within one event-loop turn instead of at its 2 s deadline.
- A destroyed request (sibling failure, disconnect, deadline) frees its slots while the engine may still be computing it (whether Meilisearch stops a search whose client went away was not verified); under ADR 0041 only the deadline did this.
- Operators can see the refused share and the high-water marks and decide on `SEARCH_ENGINE_MAX_CONCURRENCY` without reading logs; with several API instances each reports its own numbers.
- Admin status response: additive field `engine.interactiveLane` (`docs/api/search.md`).
