# @fluxkit/admin

The admin SPA: React 19 on Vite, served as static files under `/admin-ui/` on the storefront origin (ADR 0027). It calls the admin API `/admin/*` on the same origin with the `HttpOnly` session cookie; authorization stays on the API. Plan: `docs/plans/2026-10-19-admin-ui.md`. File map: `docs/files/admin.md`.

Status (step 4b): the shell is built (sign-in, re-sign-in dialog, role-aware navigation, own account with password change, language switch, error, not-found and not-allowed views). Every area (products, catalog dictionaries, orders, customers, admin users) is a translated "not built yet" placeholder in its own lazy chunk; steps 5 to 10 fill them.

## Run

```bash
pnpm build                                     # once: workspace packages
pnpm --filter @fluxkit/api start               # the API, with ADMIN_COOKIE_SECURE=false and TRUST_PROXY=0 for plain HTTP
pnpm --filter @fluxkit/admin dev               # http://localhost:5173/admin-ui/
```

- The dev server proxies `/admin`, `/admin/*` and `/admin?…` to `ADMIN_DEV_API_URL` (default `http://127.0.0.1:3000`; read from the shell or the root `.env`, development only, a malformed value stops the dev server). `/admin-ui` is never proxied.
- Sign in with an owner from `pnpm admin:create`. The cookie is host-only, so open the dev server by the host name you configured (not a mix of `localhost` and `127.0.0.1`).
- `pnpm --filter @fluxkit/admin preview` serves the build with the security headers below and the same proxy (a local CSP check).
- Tests: `pnpm --filter @fluxkit/admin test` (Vitest, node, `renderToStaticMarkup`; no DOM library, owner answer 9). `build-output.spec.ts` checks `dist/`, so run `pnpm --filter @fluxkit/admin build` first (the root `pnpm test` builds). Browser e2e is step 11.

## Serving and security headers

The edge proxy serves `apps/admin/dist` for `/admin-ui` and `/admin-ui/*` with an `index.html` fallback (deep links and reloads), keeps routing `/admin/*` and `/store/*` to the API and everything else to the storefront. Every response under `/admin-ui` carries these headers; the single copy is `security-headers.ts` (`ADMIN_SECURITY_HEADERS`, `adminSecurityHeaders({ imageHosts })`, `ADMIN_CACHE_CONTROL`), for the e2e proxy and the deployment docs to reuse:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: [https://<image host> ...]; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` (ADR 0027; also a `<meta name="referrer">` in `index.html`) |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cache-Control` | `index.html` (and the fallback): `no-cache`; `/admin-ui/assets/*` (hashed): `public, max-age=31536000, immutable` |
| `Strict-Transport-Security` | set by the TLS proxy, as for the storefront |

Image hosts: the same list as `STOREFRONT_IMAGE_HOSTS` (a static SPA has no runtime configuration). The CSP protects the SPA from injected script; it does NOT protect the admin API from an XSS in the storefront, which shares the origin (risk accepted in ADR 0027). The router writes the start page as `/admin-ui` (no slash), so the proxy must serve both `/admin-ui` and `/admin-ui/*`.

Checked after every build (`build-output.spec.ts`): `index.html` has no inline script, style or handler and no external URL, every asset is under `/admin-ui/assets/`, each area is its own lazy chunk, the initial JavaScript stays within its budget (440 000 bytes raw, 135 000 gzip; measured 392 050 and 120 027 on 2026-10-19), no zod, `localStorage` once (the UI language).

## Structure and conventions

- `src/routes.ts` is the route table: path (relative to `/admin-ui`), the API operation whose permission guards it (from `ADMIN_OPERATIONS`, tested against `x-fluxkit-permission` in `docs/api/openapi.json`), title key, page (eager or lazy). Only `/login` is public; no route may start with `/admin`. A new screen adds one row and, for the navigation, one entry in `src/layout/navigation.ts`.
- `can(permission)` reads only the permission list of `GET /admin/auth/me`. A 403 reloads `me`; a 401 anywhere except sign-in opens the re-sign-in dialog over the page (input survives, the failed request is not replayed; another user signing in drops all state and goes to the start page).
- Data: `adminClient` (`src/lib/api.ts`; CSRF header on writes, 15 s reads, 30 s writes, never retries) and `useResource(loader, deps)` (abort on unmount and on new deps, states `loading | ready | error | forbidden | notFound`, `reload()`), with `ResourceFallback` for the non-ready states. No cache library, no optimistic updates. A timed-out write's result is unknown: reload and show what the server has.
- Errors: `src/lib/problem-messages.ts` maps every problem `code` (`errors.code.*`) and every documented rule and `errors[].code` (`errors.reason.*`) to uk/en text; an unknown code shows a generic message plus the code in small print; the API's English `detail` is never shown. `fieldErrorsFromProblem` puts `errors[].path` on form fields.
- i18n: `src/messages/{uk,en}/<area>.json`, one file per area, merged in `src/messages/index.ts` (a key in two files throws). UI language: stored choice, else the browser language, else `uk`; the switch is remembered in `localStorage` (the only storage use; nothing personal, no credential).
- Forms: `method="post"` and no `action`, native constraints for early feedback, server errors on the fields and in a focused summary, `useUnsavedChangesGuard` plus `UnsavedChangesDialog` for dirty forms.
- Money and dates: `src/lib/format.ts` (integer minor units to a decimal string, `Intl` with the exponent from `GET /admin/config`; never `amount / 100`). `safeHttpUrl` for URLs from data.
- Tokens only (design guard and contrast scan read `src/`); no hardcoded text (`source-guards.spec.ts` walks the JSX); no `dangerouslySetInnerHTML`.
- No `@fluxkit/core` in the bundle: core has a single entry and no `"sideEffects": false`, so importing `parseDecimalString` and `toDecimalString` pulled zod and the whole core (measured 88.6 KB minified; with `"sideEffects": false` in core it would be 1.5 KB, a change outside this app that needs the orchestrator's approval). Constants the admin needs are copied and compared with core in tests (`PASSWORD_LIMITS`).
- react-router 8.4.0 is used in data-router mode only (`createBrowserRouter`, `RouterProvider`, lazy route objects, `useBlocker`); no framework mode, no server features, no `ScrollRestoration` (the shell scrolls to the top on a path change). It reads one `sessionStorage` key of its own (view transitions, unused here) and writes none.

## Known limits

- Concurrent edits are last-write-wins per field (no version on the API, owner answer 13); there is no audit log for catalog, price, user or customer changes.
- No proactive "session ends soon" warning (the API does not expose the expiry).
- The focus moves to the heading only when the path changes, not on a query-only change.
