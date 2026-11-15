# 0055. Shared state for several instances

Status: accepted by the owner 2026-11-14 (multi-instance plan, all four decisions). PR 2 implements request/service rate limits and admin login; later PRs cover the email pacer and replica deployment.

## Context

Process-local request windows multiply limits with each API instance. Postgres already shares sessions, account lockout, reset-token counts, scheduler locks and outbox claims. Redis and ioredis 6.0.0 are already approved dependencies.

## Decision

- Select `RATE_LIMIT_STORE=memory` (default) or `redis` (requires `REDIS_URL`, unreachable Redis fails startup). One ioredis client per API process, offline queue off, bounded command/connect timeout, closed on shutdown.
- `WindowStore.hit(name, key, limit)` is async. Memory keeps the existing fixed-window rules, IPv6 /64 grouping, mapped IPv4 normalization and bounded oldest-client eviction. Redis uses one atomic Lua call: `INCR`, first-hit `PEXPIRE NX`, `PTTL` for `Retry-After`. Numbers and window durations stay unchanged. Admin and customer login remain separate windows. Reset email, verification resend, account deletion and data export share the selected store too.
- Redis keys are `fluxkit:{prefix}:rl:{limitName}:{HMAC-SHA256(key)}`. Prefix is the URL-encoded database name. HMAC key is HKDF-SHA256 of `ORDER_TOKEN_SECRET`, empty salt, info `rate-limit`, 32 bytes. Subject normalization precedes HMAC. Redis sees integer counts and window TTLs only, never raw addresses/emails/ids. These are ephemeral pseudonyms, retained at most 24 hours and excluded from exports; see the privacy guide.
- Runtime Redis failure falls back to bounded per-process windows for that request. Log only `rate_limit_store_unavailable`, at most once a minute per process. Existing readiness route `GET /health` adds `rateLimitStore: memory | redis | degraded`; it remains 200 when Postgres is reachable. A successful shared hit clears degradation. Do not fail closed.
- Email pacing will use Redis in PR 3. Storefront caches stay per process (ADR 0040/0051); URL hashing at the edge, shared media volume and replica rollout are PR 4. Shipping caches/gates, payment read single-flight, search lane/definitions/diagnostics, media slots and log-once sets stay per instance. Multi-host media storage is a separate plan.

## Consequences

- Supersedes the single-process/Redis-later limitation for rate limits in ADR 0009, 0010, 0016, 0031 and 0036. No migration or new dependency.
- Redis outage temporarily multiplies allowable traffic by process count. Recovery restores shared windows; no attempt to merge local fallback counters. Changing the database namespace or the secret starts fresh counters; switching to memory and back within a window resumes the Redis counts that have not expired. Redis must be private, password protected and shared by the shop's instances.
- One API/storefront instance remains the deployment recommendation until PRs 3 and 4 finish. No replica or production compose changes in PR 2.
