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
(filled in after the work)
