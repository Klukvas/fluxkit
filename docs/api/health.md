# API: health

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `GET /health` | public | Liveness plus Postgres reachability (`select 1`) | none | `200 {"status":"ok"}` | `503 {"status":"error","database":"unreachable"}` (cause is logged) | - |

OpenAPI: `docs/api/openapi.json` (core routes only). Regenerate: `pnpm openapi:export`; `apps/api/src/openapi.spec.ts` fails when it is stale.
