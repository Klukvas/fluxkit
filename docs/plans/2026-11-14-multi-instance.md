# Several API and storefront instances

- Status: APPROVED by the owner on 2026-11-14 (all four decisions of section 8 as proposed: Redis for the limits and the email pacer, storefront caches per process with URL hashing at the edge, `RATE_LIMIT_STORE`, per-process fallback with an error log while Redis is down, HMAC key derived from `ORDER_TOKEN_SECRET` with its own label). Four PRs as in section 7; not started.
- Source: `docs/HANDOFF.md` section 2 item 6. Related: ADR 0040 (storefront shared catalog lists), ADR 0051 (product detail answer cache), ADR 0009/0010/0016/0031/0036 (in-memory windows, "single process, Redis later"), ADR 0018/0021/0025 (scheduler).
- Coordination: the `launch-blockers` session is changing `apps/api/src/rate-limit/` (catalog windows, `TRUST_PROXY`). Code of this plan starts only after that PR is merged; the plan is written against its interface.

## 1. Goal

Run N API and N storefront containers behind the edge proxy with the same behaviour as one: limits count once across all instances, nothing is lost or doubled, and the switch needs no downtime. N on one host first (compose replicas); several hosts is a later step (section 7).

## 2. What exists (inventory on `main` 779328fe)

Redis is in the dev compose only. `REDIS_URL` is parsed (`packages/config/src/env.ts`) but no running code reads it; `ioredis` 6.0.0 and `bullmq` are in `apps/api/package.json` and used only by a spike spec. `infra/docker-compose.prod.yml` leaves Redis out on purpose (`docs/deployment.md`). The nginx upstreams already use `zone` + `server … resolve`, so compose replicas are picked up as several addresses without a config change.

Already safe with N instances (no change): sessions and CSRF (Postgres, stateless header), checkout idempotency (`sales_order.idempotency_key`), webhook de-duplication (journal dedupe key), guest order tokens (HMAC), `MAX_OPEN_ORDERS` (database count under locks), the search sync outbox (`search_sync_queue`, drained under the scheduler lock), the scheduler itself (`pg_try_advisory_lock`, one instance per tick; event leases; email outbox `SKIP LOCKED`), admin and customer account lockout (database columns), the per-email reset-token count (database).

Per-process state and the decision for each:

| State | Where | With N instances | Decision |
|---|---|---|---|
| Request rate limits (all named windows, incl. catalog windows of the launch-blockers PR) | `apps/api/src/rate-limit/rate-limiter.ts`, `ip-window-limiter.ts` | each limit becomes N times larger | **Move to Redis** (phase 1) |
| Limits counted in services: `passwordResetEmail`, `verificationResend`, account deletion, `dataExport` | `account-email.service.ts`, `account-deletion.service.ts`, `personal-data-export.service.ts` | N times | **Redis** (same limiter, phase 1) |
| Admin login throttle | `auth/login-throttle.ts` | N times | **Redis** (phase 1; this is HANDOFF item 7b, done here once) |
| Email send pacer (immediate sends from requests bypass the scheduler lock) | `email/outbox/send-pacer.ts` | provider rate (about 10/s for Resend) can be exceeded | **Redis** per-second window shared by all instances (phase 2) |
| Media files on local disk | `media/local-media-storage.ts`, volume `media` | another instance answers `404`; cleanup job deletes only on the lock holder's disk | **Shared volume** on one host (the named volume is mounted by every replica, phase 2). Object storage is its own plan (new dependency) before going multi-host |
| Shipping carrier caches and per-provider concurrency gate | `shipping/store/provider-cache.ts`, `shipping-directory.service.ts` | N cold caches, N times the in-flight cap | **Keep per process**; document "caps are per instance". Redis cache later only if carrier quotas demand it |
| Payment status read single-flight | `payments/payment-reads.service.ts` | N times the provider reads, correctness unaffected (ADR 0032 decision 14) | **Keep** |
| Search interactive lane (8 concurrent) | `search/engine/search-engine.ts` | N times 8 against Meilisearch | **Keep**; document that the lane size is per instance |
| Search definitions (30 s TTL), diagnostic counters | `store-search.service.ts`, `search-rejections.ts` | up to 30 s disagreement; `/admin/search/status` shows one instance | **Keep**; document |
| Media processing slots | `media/media.module.ts` | memory headroom per instance | **Keep**; document 512 MB per API replica |
| Storefront shared catalog lists (ADR 0040), product answers (ADR 0051), last-good copies, Next data cache (tmpfs) | `apps/storefront/src/lib/shared-search-cache.ts`, `fresh-answer-cache.ts`, `store-data.ts` | each instance stale on its own: a shopper may see a list or a just-unpublished product flip between instances inside the 60 s bound | **Keep per process + consistent hashing at the edge** (phase 3): `hash $request_uri consistent` on the storefront upstream (Caddy: `lb_policy uri_hash`), so one URL is served by one instance and its cache. The 60 s bound of ADR 0051 holds per instance as today. A Redis `cacheHandler` would need a Redis client in the storefront (new dependency there) and is not proposed |
| Log-once sets | several | each warning logged N times | **Keep** |

## 3. Design of the shared limiter (phase 1)

- **No new dependency**: `ioredis` 6.0.0 (MIT) is already a runtime dependency of `apps/api`. One `RedisClient` provider in a new `apps/api/src/common/redis/` module, closed on shutdown, `lazyConnect` off, `enableOfflineQueue: false` (a request never waits on a reconnect).
- **Store interface**: `WindowStore.hit(name, key, limit): Promise<ThrottleDecision>` with `MemoryWindowStore` (today's `IpWindowLimiter`, unchanged rules: fixed window, IPv6 /64 keys, client cap) and `RedisWindowStore` (one Lua script: `INCR`, `PEXPIRE … NX` on the first hit, `PTTL` for `Retry-After`; one round trip, atomic). `RateLimiter.attempt` and the login throttle become `async`; every caller awaits (guard, services). Window semantics and numbers do not change (they stay internal, not contract).
- **Keys hold no personal data** (ADR 0033, 0035): `fluxkit:{prefix}:rl:{limitName}:{HMAC-SHA256(key)}`; the HMAC key is derived from `ORDER_TOKEN_SECRET` with HKDF and the label `rate-limit` (no new secret). An IPv4 address hashed without a secret could be brute-forced, so a plain hash is not enough. TTL = the window, so nothing outlives it. Recorded in the personal-data inventory notes and `docs/privacy/`.
- **Selection**: new variable `RATE_LIMIT_STORE` = `memory` (default, today's behaviour; one-command local setup unchanged) or `redis` (requires `REDIS_URL`; startup fails loudly if missing or unreachable at boot).
- **Redis down at runtime** (owner decision 3): proposed: the limiter falls back to the in-process window for that request (exactly today's single-process behaviour), logs an error at most once a minute with the error code only, and `/health/ready` reports `rateLimitStore: degraded`. Not fail-closed: a Redis outage must not take login and checkout down. Alternative: fail closed (`503`) for the auth windows only.
- **Key prefix**: derived from the database name in `DATABASE_URL` (no new variable), so the test suites and several shops on one Redis never share keys. Documented in `docs/contracts/config.md`.

## 4. Tests (real Redis, AGENTS.md section 13)

- Unit: `MemoryWindowStore` keeps the existing `ip-window-limiter` and `login-throttle` specs green (same behaviour, now async).
- Integration (`REDIS_URL` already required by the integration suite; each spec file uses its own random key prefix and deletes only its keys):
  - two `RateLimiter` instances with two separate Redis clients share one count: `maxAttempts` hits spread over both, the next one is refused with the right `Retry-After`;
  - window expiry with a 1-second test window; IPv6 /64 grouping across instances; per-email and per-customer windows;
  - no raw address, email or customer id appears in any Redis key or value (`SCAN` the prefix);
  - Redis stopped (client pointed at a closed port): requests are still limited per process, one error log, readiness `degraded`;
  - the admin login and customer login endpoints over two Nest apps on one database and one Redis: the 21st attempt from one address is `429` whichever app answers.
- `deploy-smoke`: production compose with `api` scaled to 2 and Redis on; hits through the edge proxy prove a shared limit (`429` after the window) and that media uploaded via one replica is served by the other.
- `feature-matrix` / CI: `verify` already has a Redis service container; no new job.

## 5. Migration without downtime

1. Add Redis to `infra/docker-compose.prod.yml` (unmodified image, AGPLv3 exception already approved, internal network only, password, no persistence: counters are disposable; `maxmemory` with `volatile-ttl`), `docs/deployment.md`, `deploy-smoke`. No app change; deploy.
2. Deploy the API with the new code and `RATE_LIMIT_STORE=memory`: behaviour unchanged.
3. Switch the test server to `RATE_LIMIT_STORE=redis` (still one replica). Counters restart from zero once (windows are at most 24 hours; acceptable). Rollback = set `memory` again.
4. Scale `api` to 2. Docker DNS gives the edge both addresses (`server … resolve`). The deploy workflow restarts replicas one at a time and waits for health, so a deploy no longer drops requests (change in `.github/workflows` deploy and `docs/deployment.md`).
5. Add `hash $request_uri consistent` (nginx) / `uri_hash` (Caddy) to the storefront upstream, then scale `storefront` to 2.
6. Check from two networks that per-address limits hold (HANDOFF item 5 already asks for it).

## 6. Docs and decisions

- New ADR (next free number, after the rotation ADR if that lands first): "Shared state for several instances". Supplements ADR 0040 and 0051 (their caches stay per process; consistent hashing added) and replaces the "single process, Redis later" notes of ADR 0009, 0010, 0016, 0031, 0036 for the limits. Old ADRs are not edited.
- `docs/contracts/config.md`, `.env.example`, `pnpm check:env`: `RATE_LIMIT_STORE`; `REDIS_URL` becomes required when it is `redis`.
- `docs/deployment.md`: Redis service, replicas, per-instance caps (search lane, shipping gate, media slots).
- `CHANGELOG.md`, `docs/HANDOFF.md` (items 6 and 7b).

## 7. PRs

1. `chore/prod-redis`: Redis in the production example, `deploy-smoke` (step 5.1).
2. `feature/shared-rate-limits`: Redis provider, async limiter with both stores, login throttle and service windows, tests (steps 5.2 to 5.3).
3. `feature/shared-email-pacer`: the pacer on the same store.
4. `chore/replicas`: shared media volume note, consistent hashing at the edge, replicas in the example and the deploy workflow, `deploy-smoke` with 2 replicas (steps 5.4 to 5.5).
Multi-host (object storage for media, Redis outside the host) is a separate later plan.

## 8. Owner decisions (approved 2026-11-14, all as proposed)

1. Approve the split "Redis for limits and the email pacer; storefront caches stay per process with consistent hashing".
2. Approve the new variable `RATE_LIMIT_STORE` (config contract) and Redis in the production example.
3. Redis down at runtime: fall back to per-process limits (proposed) or fail closed for the auth windows.
4. HMAC key derived from `ORDER_TOKEN_SECRET` (proposed) or a dedicated secret variable.
