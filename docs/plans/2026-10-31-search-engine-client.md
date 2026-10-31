# Search engine client: transport and concurrency limit (2026-10-31)

Status: approved by the owner (both items, through the orchestrator, 2026-10-31). Branch `fix/search-engine-client-performance`.
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
- **Pools (lanes):** two keep-alive agents per engine: `interactive` (store search, suggest and their two settings reads: `multiSearch`, `filterableAttributes`, `sortableAttributes`), with `maxSockets` = the concurrency limit; `background` (indexer writes, task polling, stats, health of the admin status), `maxSockets` 8 (the indexer works one batch at a time). Idle sockets close after 4 s (undici's default keep-alive timeout, under Meilisearch's) and are unreferenced while idle, so they never hold the process open.
- **Stale keep-alive socket:** a READ (GET or `multi-search`) that fails with `ECONNRESET`/`EPIPE` on a REUSED socket before any answer is retried once on a new socket within the same deadline (the race where the server closes an idle socket as we write; Node's documented `reusedSocket` pattern). Writes are never retried (an enqueue might have happened).
- **Limiter:** a FIFO concurrency limiter on the interactive lane only. At most N calls in flight; up to Q waiting; a call that finds the queue full, or waits longer than `min(max wait, remaining deadline)`, fails with the new code `engine_busy` (the engine was not asked). The queue wait counts against the call's deadline: the transport gets only what is left. The background lane bypasses it, so the indexer and task polling are never queued behind shoppers and never take shoppers' slots.
- **`engine_busy`** is a new `SearchEngineErrorCode`; the store's `guard` already maps every non-`engine_rejected` engine error to `503 search_unavailable`, so the degraded behaviour is the same as `engine_unavailable`/`engine_timeout` today (pinned by a spec). It is never stored (the indexer and the admin status do not use the interactive lane).
- **Defaults (indicative, from the measurements; verified with a reduced run, see the report):** N = 8 (concurrency 8 had no errors and p95 440 ms with the full mix; the engine had 3.4 of 4 cores busy at saturation, so more than 2 calls per core only adds queueing inside the engine, where it cannot be bounded); Q = 64 (at ~85 to 150 engine calls a second, 64 waiting calls drain in about 0.5 s, inside the max wait); max wait 1 000 ms (half the 2 s search timeout, leaving 1 s for the engine call itself; failing then gives the storefront time to fall back).
- **Configuration (config-schema change, additive):** `SEARCH_ENGINE_MAX_CONCURRENCY` (1 to 256, default 8) and `SEARCH_ENGINE_MAX_QUEUE` (0 to 10 000, default 64), read and validated by `@fluxkit/config` only when `SEARCH_ENABLED=true` (like `MEILI_*`), in `.env.example` (commented) and `docs/contracts/config.md`. The max wait stays a code tuning (`SearchTuning.engineQueueWaitMs`, tests shorten it), not a variable.
- **Lifecycle:** `SearchEngine.close()` destroys both agents and fails waiting calls; `SearchModule` calls it in `onApplicationShutdown` (after the HTTP server stopped).

## Files
- `apps/api/src/search/engine/search-engine.ts` (transport, lanes, limiter use, `close`), new `engine/concurrency-limiter.ts` + `concurrency-limiter.spec.ts` (TDD, fake timers), new `engine/search-engine-transport.spec.ts` (loopback servers), `engine/index.ts`.
- `apps/api/src/search/search.module.ts` (options, shutdown hook), `search-config.ts` (tuning field), `src/app.factory.ts`/`main.ts` only if the env must be passed through.
- `packages/config/src/env.ts`, `search.ts`, `search-env.spec.ts`.
- Docs: `docs/files/api.md`, `docs/files/config.md`, `docs/contracts/config.md`, `.env.example`, `CHANGELOG.md`, `docs/api/search.md` if the 503 description names causes, ADR 0041 (transport and lanes), `docs/HANDOFF.md`, a follow-up note under the measurements of the search plan.

## Risks
- A behaviour difference between undici and `node:http` that no spec covers (compression: fetch asked for gzip, the new client asks for nothing and the engine answers plain; proxies: neither honours `HTTP_PROXY`).
- Keep-alive race on a socket the server closes: mitigated by the 4 s idle timeout and the single retry of reads.
- N too low for a bigger engine: operators raise `SEARCH_ENGINE_MAX_CONCURRENCY`; too high brings back the timeouts.
- The limiter is per process, like the rate limits (run one API instance, HANDOFF section 2).

## Verification
- TDD for the limiter: failing specs first (FIFO order, never more than N, release on error/timeout/abort, overflow fails fast, wait counts against the deadline, no slot leak).
- Transport specs against loopback servers: keep-alive reuse (one socket for sequential calls), timeout destroys the socket, unreachable, 3xx not followed (each redirect status), 300/304, body cut, a body over 64 KB, retry of a read on a stale socket, no retry of a write.
- Existing search specs unchanged and green; full API suite; `pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:env`, `check:docs`.
- Before/after micro-measurement of F1 (same request, old `fetch` vs new transport, p50) and a reduced concurrency-32 run (3 000 products) before/after the limiter; indicative only.
