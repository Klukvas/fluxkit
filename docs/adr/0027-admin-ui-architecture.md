# 0027. Admin UI architecture: static SPA under `/admin-ui/` on the storefront origin

Status: accepted 2026-10-19 (owner approval of `docs/plans/2026-10-19-admin-ui.md` and its quiz answers, step 1). Builds on ADR 0002 (admin is a React SPA on Vite sharing the UI library and tokens), ADR 0009 and 0010 (admin sessions, CSRF header, lockout) and ADR 0026 (one origin, edge proxy, typed client). Nothing in those ADRs changes.

## Context

- The admin API owns every path matching `^/admin(?:/|$)`. The admin cookie is `HttpOnly`, `SameSite=Strict`, `Path=/admin`; writes need `X-Fluxkit-CSRF: 1`; there is no CORS. The SPA therefore must be same-origin with the API it calls and must not use a path under `/admin`, or a deep link or reload could not be told apart from an API request.
- The owner chose the storefront origin and the prefix `/admin-ui/` (quiz answer 1) over a separate admin host. The cookie is not sent to `/admin-ui/` page requests (its path is `/admin`), but fetches from any script on this origin to `/admin/*` do carry it.
- The storefront CSP allows `'unsafe-inline'` scripts (ADR 0026, decision 7). A storefront XSS therefore shares an origin with the admin API and could drive it with an admin's cookie and the CSRF header.
- A static SPA cannot read server configuration at runtime, and `pnpm build` runs without an API.

## Decision

1. **Where.** The built SPA (`apps/admin/dist`, Vite `base: "/admin-ui/"`) is served on the storefront origin. The edge proxy routes `/admin-ui/*` to the static files with an `index.html` fallback, `/admin/*` and `/store/*` to the API, everything else to the storefront. In development the Vite dev server serves the SPA and proxies `/admin` to the API. The storefront never serves or links `/admin-ui`.
2. **No SPA route starts with `/admin`.** A route-table test enforces it.
3. **Strict CSP for `/admin-ui/*`**, set by the edge proxy (and the dev and e2e proxies): `script-src 'self'`, no inline scripts, `frame-ancestors 'none'`, no external resources, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`. A test checks the built HTML for inline scripts and the proxy for the headers. This mitigates XSS inside the SPA only; it does not protect the admin API from an XSS in the storefront. That risk is accepted by the owner. The later hardening path is an own admin host (the proxy then drops `/admin/*` from the storefront host); it needs no SPA change except the base path.
4. **Authorization stays on the API.** The SPA shows what `GET /admin/auth/me` `permissions` allow, through one route and action to permission table checked against the API's own list.
5. **Admin client** lives in `@fluxkit/api-client` (`createAdminClient`, hand-written types, contract test against `docs/api/openapi.json`). It owns the CSRF header, never retries a write and never replays a failed one.
6. **Libraries.** Routing is `react-router` (owner answer 4; a runtime dependency, red zone, added by its own step with licence, size and exact pin). Data access (`useResource`), forms and validation are hand-written; no query-cache library; no optimistic updates. PATCH sends changed fields only; same-field edits are last-write-wins.
7. **Forms for products and variants** are generated from product type and attribute metadata (ADR 0002, 0004).
8. **Session expiry** shows a re-sign-in dialog over the page; the form state survives; the failed save is not replayed.
9. **i18n and theming.** uk/en, browser language by default with a switch remembered in `localStorage`, no locale in the URL; tokens only; layout through registered configuration (AGENTS.md 2.2).
10. **Tests.** Vitest and `renderToStaticMarkup` for components, Playwright in `apps/admin/e2e` as a separate suite; root `pnpm test:e2e` and the CI job run both.
11. **Media.** File upload in v1 (owner answer 5) is its own plan and ADR before the product screens; URL-based media stays supported.

## Consequences

- No second host or certificate is needed; deployment guidance and the dev, e2e and edge proxies gain an `/admin-ui/*` route.
- A storefront XSS can reach the admin API (see Context). Keeping the storefront free of untrusted HTML and tightening its CSP matters more because of this decision.
- `react-router` is a new dependency to keep current; replacing it later is a local change to the route table and links.
- Some screens need additive admin API changes (plan step 2) and the upload plan (step 2b).
- Moving the SPA to its own host, or moving the admin API under another prefix, would supersede part of this ADR.
