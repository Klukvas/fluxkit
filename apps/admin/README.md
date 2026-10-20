# @fluxkit/admin

The admin SPA: React 19 on Vite, served as static files under `/admin-ui/` on the storefront origin (ADR 0027). It calls the admin API `/admin/*` on the same origin with the `HttpOnly` session cookie; authorization stays on the API. Plan: `docs/plans/2026-10-19-admin-ui.md`. File map: `docs/files/admin.md`.

Status (step 5): the shell is built (sign-in, re-sign-in dialog, role-aware navigation, own account with password change, language switch, error, not-found and not-allowed views) and the catalog dictionaries are built (attributes, options, product types, brands, category tree; see "Catalog dictionaries" below). The other areas (products, orders, customers, admin users) are translated "not built yet" placeholders in their own lazy chunks; steps 6 to 10 fill them.

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

Checked after every build (`build-output.spec.ts`): `index.html` has no inline script, style or handler and no external URL, every asset is under `/admin-ui/assets/`, each area is its own lazy chunk, the initial JavaScript stays within its budget (440 000 bytes raw, 135 000 gzip; measured 392 050 and 120 027 on 2026-10-19 for the shell, 439 481 and 129 557 on 2026-10-20 with the catalog dictionaries: their uk and en messages, 47 KB, are merged into the entry, so the next area's messages need a lazy message load or a new budget), no zod, `localStorage` once (the UI language).

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

## Catalog dictionaries (`src/areas/catalog-dictionaries/`)

One lazy chunk for five screens, each with a list (or the category tree), a create form and an editor. Routes (`src/routes.ts`; the navigation already listed the five lists): `/catalog/{attributes,options,product-types,brands,categories}`, `.../new` (permission of the create operation, `catalog.write`) and `.../:id` (`catalog.read`). A sub-navigation links the five dictionaries on every screen.

- **Roles**: reads need `catalog.read`; every write control (create link, save, add, change, delete, assign, move) is rendered only if the session may run all the dictionary write operations (`dictionary-permissions.ts`, names `ADMIN_OPERATIONS` entries, so the table follows the API). The viewer sees read-only forms (inputs `readOnly`, checkboxes disabled, no actions) and `.../new` shows "not allowed"; a 403 still shows its message and reloads `me`.
- **Content locales** come from `GET /admin/config` (`ConfigGate`, nothing renders before they are known): one labelled field per locale, the default locale required, an empty optional locale omitted from the request map (`locale-text.ts`). A PATCH sends the whole map when one locale changed.
- **Forms are pure models first** (`attribute-form.ts`, `dictionary-forms.ts`, tested before the screens): early checks (code, slug and URL patterns copied from core and compared with core in tests, position 0 to 1 000 000, unit length, typed `validation`), request bodies, and PATCH bodies through `diffForPatch` (`src/lib/diff-for-patch.ts`, generic: changed fields only, maps and arrays replace whole, `null` clears, nothing for an unchanged field). The server stays the authority: its `400` paths (`name.uk`, `validation.min_length`, ...) land on the fields, a `409 conflict` that names a column (`code`, `slug`) on that field, anything else in the focused error summary.
- **Attributes**: all six flags by their API names; the input type and `isLocalized` are chosen once (read-only on edit); the `validation` fields follow the input type (text `min_length`/`max_length`, number `min`/`max`/`integer`/`max_decimals`, multiselect `min_items`/`max_items`, date `min`/`max`; none for boolean and select); the flags a type cannot have are disabled, and an internal attribute cannot be public (the form switches the public flags off). Options (select and multiselect) are added, changed (label, position) and deleted in a dialog.
- **Options** have values with the same dialog. **Product types** have `requiresShipping` and two assignment sections: attributes (picker, level `product`/`variant`, required, position; `PUT`/`DELETE`) and options (picker, position). Pickers are paged server lists: 100 per request, "load more", an item that cannot be chosen (already assigned) stays in the list, marked; nothing filters a loaded page (`picker-model.ts`).
- **Brands** take the logo as an http(s) URL (`safeHttpUrl`); the preview is a lazy `img` without referrer whose `alt` comes from the form's name. The page's CSP allows only the configured image hosts, so a logo from another host is reported in text instead of shown (no upload in this step).
- **Category tree**: nested list with an expand button per category (`aria-expanded`, Tab and Enter or Space), levels loaded when expanded (`GET /admin/categories?parentId=`), "load more" for a level over 100, no expand button at depth 5 (`category-tree.ts` is the tested model). **Known workaround:** the API cannot list the root level alone (no `parentId=null`), so the roots are found by paging the flat list (100 rows per request, at most 10 requests) and keeping the rows without a parent; if the cap is hit the screen says the list is truncated. An additive `parentId=null` filter would remove this (HANDOFF, known gaps). The expansion is not kept across a visit to an editor. Create takes its parent from the tree ("Add subcategory", `?parentId=`); move (`POST .../move`) is its own section with a parent picker and a confirmation.
- **Writes**: never optimistic, one request per click (`run-write.ts`; no retry), the button disabled while it runs. After a write the page reloads what the server has (`useRefreshingResource` keeps the old data on screen meanwhile, so a form being edited elsewhere on the page keeps its input), the status line (a live region the focus moves to) says "Saved". A create shows a confirmation panel (focused) with links to the new item; a delete replaces the editor with a panel (focused) and a link back. A lost answer (network, timeout, unreadable) is "the result is unknown": the page reloads and says so, a failed create points to the list; the screen never repeats the write. A refused delete (`409 in_use` or a rule) is explained in the dialog.
- **Unsaved changes**: every form uses `useUnsavedChangesGuard`; a dialog form (row or assignment) is discarded by Escape or Cancel on purpose.
- Messages: `src/messages/{uk,en}/catalog-dictionaries.json` (namespace `dict.*` and the titles of the new routes); `dictionary-messages.spec.ts` checks the keys that are built from data. The initial JavaScript carries these messages (about 47 KB raw, 9 KB gzip), because message files are merged eagerly; see "Serving and security headers" for the budget.

## Known limits

- Concurrent edits are last-write-wins per field (no version on the API, owner answer 13); there is no audit log for catalog, price, user or customer changes.
- No proactive "session ends soon" warning (the API does not expose the expiry).
- The focus moves to the heading only when the path changes, not on a query-only change.
