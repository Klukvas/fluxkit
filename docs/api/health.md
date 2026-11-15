# API: health

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `GET /health` | public | Readiness: Postgres reachability (`select 1`) and rate-limit store status | none | `200 {"status":"ok","rateLimitStore":"memory"}`; store is `memory`, `redis` or `degraded` (Redis outage uses local fallback) | `503 {"status":"error","database":"unreachable"}` (cause is logged) | - |

OpenAPI: `docs/api/openapi.json` (core routes only). Regenerate: `pnpm openapi:export`; `apps/api/src/openapi.spec.ts` fails when it is stale.
