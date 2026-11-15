# Swagger UI and `/docs-json` in production

Status: **decided by the owner on 2026-11-14: option A** (keep today's behaviour, not public; no code change). The options below stay as the record of what was weighed. Revisit with option C if a client wants the UI on a staging host (a new configuration variable is a public contract change, AGENTS.md section 17).

## Where it is wired today

| Place | What it does |
|---|---|
| `apps/api/src/main.ts` (line 39) | `SwaggerModule.setup("docs", app, buildOpenApiDocument(app))`: every API process, in every environment, serves Swagger UI at `/docs` and the document at `/docs-json` (and `/docs-yaml`) on its own port. No guard, no flag. |
| `apps/api/src/app.factory.ts` `buildOpenApiDocument` | Builds the document from the running app: every core route, the routes of the enabled features and providers (`FEATURES_ENABLED`, `*_PROVIDERS_ENABLED`), the admin CSRF header and the admin permission of each route (`x-fluxkit-permission`). |
| `infra/proxy/nginx/templates/fluxkit.conf.template` (line 7), `infra/proxy/caddy/Caddyfile` (line 83) | The edge does NOT route `/docs`, `/docs-json`, `/health`: from outside they reach the storefront and answer 404. |
| `scripts/deploy-smoke.sh` (line 242) | Asserts that `/docs`, `/docs-json`, `/health` answer 404 through the edge. |
| `docs/deployment.md` (lines 34, 283) | "The owner's decision stays open, the default is not public"; checklist item. |
| `README.md` (lines 24, 81) | Development: "Swagger UI at `/docs`", "try /health and /docs". |

So on the test server `fluxkitcore.com` the UI and the document are NOT reachable from the internet today; they are reachable inside the Docker network (`docker compose ... exec api wget -qO- http://127.0.0.1:3000/docs-json`).

What none of the options changes: `docs/api/openapi.json` is written by `pnpm openapi:export` (`apps/api/src/openapi-export.ts`, its own `createApp` with search on and `OPENAPI_FEATURES`), and its freshness is checked by `apps/api/src/openapi.spec.ts`; both call `buildOpenApiDocument` and never `SwaggerModule.setup`. The committed file stays the source for `@fluxkit/api-client` contract tests and for integrators. Only option C, if built as a Nest controller, would add its own route to the document (an extra `openapi:export` and `docs/api/` line); built with `SwaggerModule.setup` behind a middleware it adds nothing.

## What the document reveals

Every admin route with its permission, the enabled features and providers (a fingerprint of the client's configuration), validation limits. No secrets, no data. The template's own routes are in the repository anyway; the per-client part (enabled features, providers) is not.

## Options

### A. Keep today's default: served by the API, not routed by the edge (recommended)

- What: no code change. The owner confirms "not public"; the docs say so as a decision instead of "open". Integrators get `docs/api/openapi.json` from the delivery.
- Pros: nothing to build or test; already verified by `deploy-smoke` and on the test server; no new variable.
- Cons: the API still serves the UI and the document on its internal port in production (anyone inside the Docker network reaches them); a wrong edge rule (routing everything to the API, or publishing the API port) makes it public silently.
- Risks: low. Guard the edge rule as today (`deploy-smoke` 404 check).

### B. Make it public through the edge

- What: route `/docs` and `/docs-json` to the API in both edge files; change the `deploy-smoke` assertion and `docs/deployment.md`.
- Pros: client integrators and partners read the live API of their shop without a delivery.
- Cons: every visitor sees the full admin surface and the shop's enabled features and providers; Swagger UI needs its own CSP (inline script and styles) at the edge; more public endpoints to keep patched (`swagger-ui-dist`).
- Risks: reconnaissance for attackers; a CSP mistake on the UI page.

### C. Switch with a configuration flag (for example `API_DOCS_ENABLED`, default `false`)

- What: `main.ts` calls `SwaggerModule.setup` only when the flag is true; `.env.example` sets it to `true` for development; `docs/contracts/config.md`, `pnpm check:env`, the README updated. Public contract change (new variable, minor version).
- Pros: production does not serve the UI at all unless the operator opts in; works with any edge; clear in the env file.
- Cons: a new variable to document and test; developers who copy an old `.env` lose `/docs` until they add it.
- Risks: low; a default of `true` would defeat the purpose, so the default must be `false`.

### D. Admin only: under `/admin/docs`, behind the admin session

- What: serve the UI and the document under `/admin/docs` (routed by the edge with the rest of `/admin`), guarded by the admin session and a permission (for example the owner role); new code in the auth area (red zone).
- Pros: the shop's own staff and its developers see the live document of their configuration, nothing public.
- Cons: `SwaggerModule.setup` takes no Nest guard, so it needs an Express middleware that checks the session cookie, or a controller plus a static UI; Swagger UI needs a CSP exception on an admin path; the admin CSRF header must be sent by the UI's "Try it out" calls.
- Risks: medium: a hand-written session check outside `AdminGuard` is the kind of code that leaks; more to review than the value it gives over A or C.

## Decision

A (owner, 2026-11-14). Integrators get `docs/api/openapi.json` with the delivery; `scripts/deploy-smoke.sh` keeps asserting that the edge answers 404 for `/docs`, `/docs-json` and `/health`. C remains the path if a client ever needs the UI on a staging host.
