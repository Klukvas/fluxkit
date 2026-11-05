# Storefront small fixes (2026-11-05)

Branch `fix/storefront-small-fixes` from `origin/main` `49a9c95`. Follow-ups of design batch B (PR 218, plan `docs/plans/2026-11-03-storefront-design-b.md`).
No new dependency, environment variable, API route, schema or public contract. One commit per item.

## Found (existing functionality)
- `POST /theme`: `apps/storefront/src/lib/theme-route.ts` (`themeFormResponse`, unit tests `theme-route.spec.ts`), wired in `app/theme/route.ts`, which already reads
  `publicOrigin()` (`lib/public-url.server.ts`: `STOREFRONT_PUBLIC_URL`, validated as a bare lower-case `http(s)` origin by `@fluxkit/config`).
  The e2e stack posts through the proxy at `E2E_ORIGIN`, which is also the storefront's `STOREFRONT_PUBLIC_URL`.
- The 404 document: Next 16.4.3 `getErrorRSCPayload` (`next/dist/server/app-render/app-render.js`) hardcodes the error shell `<html id="__next_error__"><head/><body/>`.
- Pre-hydration budget: README "Keep the header small", `shell.spec.tsx` size pins, e2e `pre-hydration-forms.e2e.ts` (en only).

## Steps
1. **Refuse cross-site `POST /theme` (security, TDD).** `403`, nothing set, when `Sec-Fetch-Site` is `cross-site` or `same-site` (a sibling host is another
   origin), or when `Origin` is present and is not the public origin (`null` included). `same-origin`, `none` and requests without both headers (old
   browsers without a script, curl) keep working. The route passes `publicOrigin` instead of a `secure` callback; `secure` is derived from it.
2. **No hardcoded English in the `400` bodies.** Status only, empty body (the switch is a form; a shopper never sees these answers from the page).
3. **Dark 404 (investigate).** Fix only if the server can put `data-theme` on the 404 document without a second cookie reader or a Next patch; else report.
4. **`/uk/account/register` without a script.** Extend `pre-hydration-forms.e2e.ts` to uk (must fail first), measure, then the smallest markup change within
   the size pins of `shell.spec.tsx`; if none is clean, report the measurements.
5. **`docs/HANDOFF.md`:** drop stale next steps (design B PR, first green `deploy-smoke` on GitHub, done since PR 224), refresh "Last updated".

## Risks
- Step 1: a storefront reached under another origin than `STOREFRONT_PUBLIC_URL` (misconfiguration) refuses the script-less switch with `403`; the
  scripted switch never posts, so shoppers with JavaScript are unaffected. Documented in the README.
- Step 4: markup changes in the shell can change the visible design; checked against the existing shell specs and e2e.

## Verification
`pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:docs`, `check:env`, the storefront unit tests, and the storefront e2e files touched
(`pre-hydration-forms`, `design-b`) against natively started Postgres, Redis and Meilisearch on free ports.

## Results
- **1 (`7863949`):** failing first: `expected 303 to be 403` for `{"sec-fetch-site":"cross-site"}`; then 7 of 7. Real `next start`: foreign `Origin` 403,
  `Sec-Fetch-Site: cross-site` 403, own origin 303, no headers 303.
- **2 (`70be3d1`):** failing first: `expected 'Unknown theme.' to be ''`; then 7 of 7; real server: `400` with an empty body.
- **3, not fixed (no clean way):** checked on `next start` with `fluxkit_theme=dark`: `/en/p/no-such-product`, `/en/no-such-page` and `/foo` answer 404 with
  `<html id="__next_error__">` (no `lang`, no `data-theme`); `/en` has `data-theme="dark"`. Next 16.4.3 builds that element as a constant in
  `getErrorRSCPayload` (`next/dist/server/app-render/app-render.js`); no layout, `not-found.tsx` or route reaches it. `global-not-found` (experimental flag)
  is for URLs whose root layout cannot render, not for a page's `notFound()`, and would add a second cookie reader. A CSS default would follow the device,
  not the cookie. With a script the page turns dark when the payload renders; without one the page is empty anyway (README "Known gaps").
- **4:** what counts (react-dom 19.3 source, offline check with Next's compiled React): body shell + `<head>` + the loading fallback (even when not sent) +
  the finished section, limit 12 800. Real build, search on: uk register about 13.1 KB (outlined), en 12.3 KB; e2e uk failed first
  (`locator.fill: Timeout 15000ms exceeded`, en passed). Single `.fk-*` classes in header and footer and icon caps in `.fk-icon`: uk header 5 397 -> 4 832 bytes,
  footer 1 408 -> 1 367, uk register about 12.5 KB, inline. Margin about 0.3 KB: longer client category names can outline it again (the e2e test catches it).
- **Checks:** `pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:env` exit 0; storefront unit tests 106 files, 1 802 tests passed; full storefront
  e2e (search on) 144 passed, 4 skipped (the search-off file), against Postgres 16, Redis and Meilisearch 1.55 started natively. Not run: the admin suites
  (admin untouched), `E2E_SEARCH=off`, a real browser look at the header (classes are the same utilities through `@apply`; the generated CSS was checked).
