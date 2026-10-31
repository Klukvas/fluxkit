# Search engine client: transport and concurrency limit (2026-10-31)

Status: implemented (branch pushed, no independent review yet); approved by the owner (both items, through the orchestrator, 2026-10-31). Branch `fix/search-engine-client-performance`.
Source: `docs/plans/2026-10-29-search.md`, "Measurements at scale (2026-10-31)": finding F1 and the concurrency-32 rows of table 3.

## Goal
1. **F1:** remove the ~40 ms the engine client adds to every engine answer larger than ~1.4 KB (global `fetch`: 44.3 ms; `node:http` with a keep-alive agent: 1.6 ms for the same request).
2. **Overload:** at concurrency 32 the engine saturates (~85 search requests a second with the full mix); 22 of 12 870 search requests and 19 % of the catalog-through-search mix answered `503` because engine calls passed the 2 s search timeout. Bound the interactive engine calls so the engine is not driven past saturation and a call that cannot start in time fails fast into the existing degraded path.

## What exists (checked before building)
- `apps/api/src/search/engine/search-engine.ts`: `SearchEngine.request` is the single choke point of every engine call (global `fetch`, `AbortSignal.timeout`, `redirect: "error"`, typed `SearchEngineError`). One instance per app, created in `SearchModule.register` (`SEARCH_ENGINE`, `useValue`), plus test-only instances in `src/test/search-world.ts` and `search-engine.spec.ts`. No lifecycle hook today (fetch keeps no handle of ours).
- No limiter or semaphore exists in `apps/api` (`rate-limit/` counts requests per address and window; it does not bound concurrency). `shipping/store/provider-cache.ts` coalesces, it does not queue.
- No spec stubs global `fetch` for the engine: the engine specs use the real Meilisearch plus loopback `node:http` servers for the broken-engine cases (`search-indexer.spec.ts` calls `fetch` itself only to read the engine directly). So no spec has to move; the new cases use loopback servers too.
- Callers' degraded path: `StoreSearchService.guard` turns every `SearchEngineError` except `engine_rejected` into `503 search_unavailable` with `Retry-After: 30`; the storefront then falls back to SQL (ADR 0039). The admin status (`health`) and the indexer (jobs 13, 14, `search:reindex`) store or report codes.
- Behaviour of the current `fetch` path, probed on Node 22.22 (to keep it exactly): 301, 302, 303, 307, 308 reject `fetch` (`TypeError`, with or without `Location`) -> `engine_unreachable` without status; 300, 304, 305, 306 are answers (`engine_rejected` by status); a body cut after the headers rejects `text()` -> `engine_unreachable` with the status; a timeout in either phase -> `engine_timeout`.

## Decisions
- **Transport:** `node:http` / `node:https` by the URL scheme, inside `SearchEngine.request`; no new dependency. One overall deadline per call (queue wait, connect, send, headers, body), as `AbortSignal.timeout` did; on expiry the request and its socket are destroyed (never returned to the pool). Body decoded with `TextDecoder` (what `Response.text()` does). Headers: `authorization: Bearer`, `content-type` and `content-length` only with a body. Error taxonomy and messages unchanged (no URL, key or engine message).
- **Pools (lanes):** two keep-alive agents per engine: `interactive` (store search, suggest and their two settings reads: `multiSearch`, `filterableAttributes`, `sortableAttributes`), with `maxSockets` = the concurrency limit; `background` (indexer writes, task polling, stats, health of the admin status), `maxSockets` 8 (the indexer works one batch at a time). Idle sockets close after 4 s (undici's default keep-alive timeout; Meilisearch v1.55.0 kept an idle connection open for at least 7 s in a probe, its exact idle limit was not measured) and are unreferenced while idle, so they never hold the process open.
- **Stale keep-alive socket:** a READ (GET or `multi-search`) that fails with `ECONNRESET`/`EPIPE` on a REUSED socket before any answer is retried once on a new socket within the same deadline (the race where the server closes an idle socket as we write; Node's documented `reusedSocket` pattern). Writes are never retried (an enqueue might have happened).
- **Limiter:** a FIFO concurrency limiter on the interactive lane only. At most N calls in flight; up to Q waiting; a call that finds the queue full, or waits longer than `min(max wait, remaining deadline)`, fails with the new code `engine_busy` (the engine was not asked). The queue wait counts against the call's deadline: the transport gets only what is left. The background lane bypasses it, so the indexer and task polling are never queued behind shoppers and never take shoppers' slots.
- **`engine_busy`** is a new `SearchEngineErrorCode`; the store's `guard` already maps every non-`engine_rejected` engine error to `503 search_unavailable`, so the degraded behaviour is the same as `engine_unavailable`/`engine_timeout` today (pinned by a spec). It is never stored (the indexer and the admin status do not use the interactive lane).
- **Defaults (indicative, from the measurements; verified with a reduced run, see the report):** N = 8 (concurrency 8 had no errors and p95 440 ms with the full mix; the engine had 3.4 of 4 cores busy at saturation, so more than 2 calls per core only adds queueing inside the engine, where it cannot be bounded); Q = 512 (first planned as 64; the reduced run below showed 64 refusing about a quarter of the full search mix at concurrency 64, a load the unlimited client served without errors, because one search fans out into up to about 7 parallel engine calls; so the 1 s wait, not the length, sheds load); max wait 1 000 ms (half the 2 s search timeout, leaving 1 s for the engine call itself; failing then gives the storefront time to fall back).
- **Configuration (config-schema change, additive):** `SEARCH_ENGINE_MAX_CONCURRENCY` (1 to 256, default 8) and `SEARCH_ENGINE_MAX_QUEUE` (0 to 10 000, default 512), read and validated by `@fluxkit/config` only when `SEARCH_ENABLED=true` (like `MEILI_*`), in `.env.example` (commented) and `docs/contracts/config.md`. The max wait stays a code tuning (`SearchTuning.engineQueueWaitMs`, tests shorten it), not a variable.
- **Lifecycle:** `SearchEngine.close()` destroys both agents and fails waiting calls; `SearchModule` calls it in `onApplicationShutdown` (after the HTTP server stopped).

## Files
- `apps/api/src/search/engine/search-engine.ts` (transport, lanes, limiter use, `close`), new `engine/concurrency-limiter.ts` + `concurrency-limiter.spec.ts` (TDD, fake timers), new `engine/search-engine-transport.spec.ts` (loopback servers), `engine/index.ts`.
- `apps/api/src/search/search.module.ts` (options, shutdown hook), `search-config.ts` (tuning field), `src/app.factory.ts`/`main.ts` only if the env must be passed through.
- `packages/config/src/env.ts`, `search.ts`, `search-env.spec.ts`.
- Docs: `docs/files/api.md`, `docs/files/config.md`, `docs/contracts/config.md`, `.env.example`, `CHANGELOG.md`, `docs/api/search.md` if the 503 description names causes, ADR 0041 (transport and lanes), `docs/HANDOFF.md`, a follow-up note under the measurements of the search plan.

## Risks
- A behaviour difference between undici and `node:http` that no spec covers (compression: fetch asked for gzip, the new client asks for nothing and the engine answers plain; proxies: neither honours `HTTP_PROXY`).
- Keep-alive race on a socket the server closes: mitigated by the 4 s idle timeout and the single retry of reads (never after `close()`).
- N too low for a bigger engine: operators raise `SEARCH_ENGINE_MAX_CONCURRENCY`; too high brings back the timeouts.
- The limiter is per process, like the rate limits (run one API instance, HANDOFF section 2).

## Verification
- TDD for the limiter: failing specs first (FIFO order, never more than N, release on error/timeout/abort, overflow fails fast, wait counts against the deadline, no slot leak).
- Transport specs against loopback servers: keep-alive reuse (one socket for sequential calls), timeout destroys the socket, unreachable, 3xx not followed (each redirect status), 300/304, body cut, a body over 64 KB, retry of a read on a stale socket, no retry of a write.
- Existing search specs unchanged and green; full API suite; `pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:env`, `check:docs`.
- Before/after micro-measurement of F1 (same request, old `fetch` vs new transport, p50) and a reduced concurrency-32 run (3 000 products) before/after the limiter; indicative only.

## Results (2026-10-31, indicative: one shared 4-vCPU sandbox runs the engine, Postgres, the API and the load loop)

### F1 micro-measurement (same request, 200 sequential calls each after 20 warm-up calls, Meilisearch v1.55.0 on loopback)
| Answer | old client (`fetch`) p50 / p95 | new client (`node:http` keep-alive) p50 / p95 |
|---|---|---|
| 24 hits, `productId` only (1 457 bytes) | 44.0 / 46.3 ms | 1.4 / 1.9 ms |
| 24 full documents (4 142 bytes) | 44.0 / 47.7 ms | 1.5 / 2.0 ms |
| 1 hit (237 bytes) | 1.6 / 2.7 ms | 0.8 / 1.1 ms |

### Reduced load run (3 000 products, 19 596 documents, 2 runs of 15 s per row)
Method: the scratch load loop of the 20 000-product measurement (closed loop, 2 000 forwarded addresses), deep pages scaled to the catalog (pages 70 to 104), and on a search `503` the loop reads the SQL listing as the storefront does (otherwise a fast `503` is just an instant retry). "before" = the built API with the `origin/main` engine client (fetch, no limit); "limited N-Q" = this branch. At concurrency 32 the small catalog does not saturate the engine, so the overload rows use 192.

| Mix, concurrency | Client | search `503` | successful searches/s | page p95 (search or fallback) |
|---|---|---|---|---|
| catalog through search, 32 | before | 0 % | 97 | 689 to 704 ms |
| catalog through search, 32 | limited 8-512 | 0 % | 97 to 100 | 479 to 492 ms |
| full search mix, 32 | before | 0 % | 149 to 155 | 324 to 344 ms |
| full search mix, 32 | limited 8-512 | 0 % | 171 to 175 | 285 to 296 ms |
| full search mix, 64 | before | 0 % | 168 to 169 | 531 to 573 ms |
| full search mix, 64 | limited 8-64 | 24 to 27 % | 134 to 137 | 538 to 568 ms |
| full search mix, 64 | limited 8-512 | 0 % | 164 to 170 | 533 to 560 ms |
| catalog through search, 64 | before / limited 8-512 | 0 % / 0 % | 98 to 101 / 104 | 923 to 940 / 769 to 773 ms |
| catalog through search, 192 | before | **86 to 99 %** | **1 to 13** | 2 087 to 2 337 ms |
| catalog through search, 192 | limited 8-512 | 44 to 46 % | 81 to 85 | 1 767 to 2 132 ms |
| full search mix, 192 | before | 0 % | 150 | 2 274 to 2 558 ms |
| full search mix, 192 | limited 8-512 | 16 % | 139 to 140 | 1 451 to 1 995 ms |

Reading: below saturation the limit refuses nothing and lowers p95; under overload the old client collapses on the catalog mix (the engine keeps working on calls whose 2 s timeout has passed, so almost every search fails) while the limited one keeps the engine's capacity (~85 successful searches a second) and sheds the rest to the SQL fallback within 1 s. The price is the last row: where the old client still answered every search of the full mix, slowly, the limited one sends 16 % to the fallback. With the fallback-free loop of the first attempt (instant retries) the limited client showed 92 % `503`: that loop measures retry storms, not shoppers, and is not used for the verdict. Other limits tried at 192 (8-64, 16-64, 32-256) were within the noise of 8-512 on the catalog mix. The transport alone (limit off: 256-10000) changed nothing under overload (engine-bound), as F1 predicted. Not measured: the 20 000-product catalog (disk), a real storefront in the loop, several API instances.

## Independent review of PR 204 (2026-10-31)
Verdict: safe to merge, low findings. Fixed in the PR: F1 (`close()` is final: no stale-socket retry and no new attempt after it; spec red then green), F3 (`SEARCH_ENGINE_MAX_QUEUE=0` refused while `SEARCH_ENGINE_MAX_CONCURRENCY` is below 10, the most engine calls one search sends at once: `hits`, `variant_facets` and one per selected group, at most 8), F6 (docs: `engineQueueWaitMs` in `docs/files/api.md`, the admin `ENGINE_CODES` comment, the 4 s idle timeout no longer claimed to be under Meilisearch's limit). The deadline spec's upper bound was loosened (it now waits 800 of 1 000 ms and only has to tell 1 000 from 1 800 ms).

Open follow-ups (not fixed here):
- Review F2: deferred follow-up. A refused search still spends engine work on its sibling calls (up to 10 parallel calls per search; the others are not cancelled when one is refused). Fix: one shared slot per search, or an AbortSignal into `multiSearch`.
- Review F4: deferred follow-up. `engine_busy` refusals are visible only as warn log lines; add a per-process counter to `GET /admin/search/status` and sample the log.
