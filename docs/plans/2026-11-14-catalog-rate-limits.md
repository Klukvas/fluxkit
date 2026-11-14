# Rate limits on the plain catalog reads of `/store/*`

Status: implemented on `fix/catalog-rate-limits` (launch blocker, `docs/HANDOFF.md` section 2 item 5). No new dependency, no migration, no new configuration variable.

## Goal

`GET /store/config`, `/store/categories`, `/store/products`, `/store/products/{slug}` and `/store/banners` had no rate limit. A script that reads them through the edge could keep the API and Postgres busy without any bound. Search already has its windows (`search`, `searchSuggest`).

## What exists (checked before building)

- `apps/api/src/rate-limit/`: `RateLimiter` (named in-memory windows, one `IpWindowLimiter` per name), `@RateLimit(name)` and `RateLimitGuard`, `RATE_LIMIT_SUBJECTS` (who a limit counts). Used by checkout, cart, search, shipping, payments, auth.
- `TRUST_PROXY` (ADR 0024) feeds Express `trust proxy`; `request.ip` is then the client address the edge forwarded.
- The storefront's Next server reads the catalog through `API_INTERNAL_URL`, straight to the API, without `X-Forwarded-For` (only the search results page forwards it, and only with `STOREFRONT_FORWARD_CLIENT_ADDRESS=true`, ADR 0038). Its reads go through the Next data cache (60 s) or the product answer cache (ADR 0051); brand-filtered lists are uncached.
- A shopper's browser never calls these routes (pages are rendered by the Next server; grep of the client components).

## Why no dependency is needed

The HANDOFF note "needs a dependency" gives no reason, and none is recorded elsewhere (`docs/HISTORY.md` repeats it); the existing guard does the job. The real obstacle is another one: every server-rendered catalog read arrives from the Next server's one address. A plain per-address window on these routes would count every shopper of the shop in that one window and, at the first busy minute, answer `429` to the Next server: the whole shop would go down. That is why the routes were left open.

## Decision

1. One shared window `catalogRead`, 300 reads a minute per client address, on the five routes. One window, not five: a scraper walks all of them, and per-route windows would multiply its budget by five. 300 a minute (5 a second) leaves room for an honest integration (a price comparison feed) and stops a tight loop. An internal default like the other numbers (`RATE_LIMITS`), not a public contract.
2. New subject `proxiedClientAddress`: the window counts only requests that came through the trusted proxies. With `TRUST_PROXY` above 0 and no address taken from `X-Forwarded-For` (`request.ips` empty), the request reached the API from inside the deployment (the Next server) and is not counted. With `TRUST_PROXY=0` every request counts by its socket address, like the other windows. A `trust proxy` value that is not a hop count counts the request (fails closed).
3. Why this is safe: with `TRUST_PROXY` above 0 the API must already be reachable only through the edge (README "Deployment notes"; a client that reaches it directly can choose its key for every other window anyway). Through the edge `X-Forwarded-For` is always set: nginx replaces it (`snippets/forwarded-headers.conf`), Caddy's `reverse_proxy` sets it. A misbound API port leaves the catalog reads unlimited, which is today's state, not a new hole.
4. Search is unchanged: its routes keep the `search` and `searchSuggest` windows with the `clientAddress` subject, so the results page with forwarding off still counts the Next server (ADR 0038, accepted behaviour).
5. Not in scope: the blog's store routes (a feature package that cannot use the API's guard today; follow-up through the feature extension points) and limiting page views (follow-up below).

## Alternatives considered

- `@nestjs/throttler` (MIT): a new runtime dependency (red zone) that adds nothing the existing guard lacks, and has the same Next-server problem.
- Forward the shopper's address on every server catalog read (extend ADR 0038): the Next data cache key includes the request headers, so a forwarded address would split the cache per shopper and grow `.next/cache/fetch-cache` without bound (storefront review M2). Rejected.
- A shared secret header from the storefront to exempt its reads: a new configuration variable (public contract change) and a secret to rotate, for no gain over the proxy rule above.
- Rate limit at the edge (nginx `limit_req`): built into nginx, but Caddy needs a third-party module (a custom build), and the limit would live outside the tested API. Kept as a follow-up for page views.

## Risks and limits

- The Next server's own reads stay unlimited, so a client can still make the API work by requesting pages (each uncached brand list is one API call). Limiting page requests belongs to the edge (follow-up).
- In memory per process like every other window (ADR 0009, 0016): one API instance.
- A wrong `TRUST_PROXY` (too low) puts every shopper behind the edge into one window; too high lets a client choose its key. The rule is the one of every other window, but the cost is higher now: a wrong value used to degrade checkout, login and the like, and now also the catalog reads of scripts and integrations (`docs/deployment.md` checklist).
- With `TRUST_PROXY=0` (development, or a storefront deployed without the edge) the Next server's own reads count too, in one window for every shopper; a busy shop without the edge could be refused its own catalog reads. Every deployed environment runs the edge (ADR 0026), and the Compose example refuses to start without `TRUST_PROXY`.
- `API_INTERNAL_URL` must point at the API itself; through the public edge the Next server's reads would carry a forwarded hop and count as one client (`docs/deployment.md` checklist).
- Specs that share one app with the default `TRUST_PROXY=0` count every catalog read in one window: `catalog/store/store.spec.ts` makes an estimated 100 to 150 (review estimate, not counted); a spec that grows past 300 reads per minute gets `429` and should pass `rateLimits` or forward an address per test.

## Verification

- Unit (`rate-limit.guard.spec.ts`): 300 then `429` with `Retry-After: 60`; per address; no count without a forwarded hop when `trust proxy` is 1; every request counted with `trust proxy` 0 or a non-number; separate from another window.
- Real app (`catalog-rate-limit.spec.ts`): the shared window across the five routes (`application/problem+json`, `too_many_requests`, `Retry-After: 60`, also for an unknown slug), per forwarded address, a new window after a minute, 350 reads without a forwarded hop all `200` with `TRUST_PROXY=1`, every read counted and a spoofed header ignored with `TRUST_PROXY=0`, the search window independent of a used-up catalog window.
- Real app, more: counted before validation (`429`, not `400`, for a refused read with a bad query); `TRUST_PROXY=2` takes the client the CDN saw, so an invented address opens no new window.
- `rate-limiter.spec.ts` pins the number and the subject.
- Mutation check: with the "not counted" branch disabled, the two tests of that rule fail (unit and real app) and the rest pass.
- Full API suite (`vitest run` in `apps/api`, 267 files) against real Postgres, Redis and Meilisearch, Node 24: 4 574 passed, 1 failed, the `openapi.json` freshness check; after `pnpm openapi:export` (five `429` responses added) that spec and the rate limit specs pass on Node 22. The full suite was not re-run after the two extra tests.
- Independent review (a different agent, Sonnet): no blockers; its doc points (the `TRUST_PROXY=0` and `API_INTERNAL_URL` notes, the checklist) and two test gaps (`TRUST_PROXY=2`, counted before validation) are taken in. Not taken: a `deploy-smoke` check through the real edge (a follow-up).

## Follow-ups

- An edge limit for page requests (an nginx `limit_req` zone on the storefront location; Caddy needs a module, so it would be documented as optional).
- The blog's store routes: a way for feature packages to use a named window (feature extension points, ADR 0049).
- Shared windows in Redis for more than one API instance (HANDOFF section 2 item 6).
- A `deploy-smoke` step that reads `/store/config` through the nginx edge until `429` (end-to-end proof that the edge always sets the header).
