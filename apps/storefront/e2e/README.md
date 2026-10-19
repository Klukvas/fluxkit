# Storefront end-to-end tests (Playwright)

Browser tests of the purchase flow against the real stack: Postgres, Redis, Meilisearch, the built API, the built storefront and a same-origin proxy. Plan: `docs/plans/2026-10-18-storefront.md`, step 8. Chromium only. They are NOT part of `pnpm test` (they are slow and need a browser); run them with `pnpm test:e2e`.

## Run it locally

1. Services up (README quick start: Compose, or native Postgres, Redis and Meilisearch). Node 22, `pnpm install`.
2. Create a database for the suite. Its name MUST end in `_e2e_test`; the suite DROPS everything in it at the start of every run, so do not reuse `fluxkit_test` (`pnpm test`) or a development database:
   ```bash
   createdb -h 127.0.0.1 -U <user> fluxkit_e2e_test          # or: psql ... -c 'create database fluxkit_e2e_test'
   ```
3. Install the browser once: `pnpm --filter @fluxkit/storefront exec playwright install chromium` (add `--with-deps` on a fresh Linux machine). If `PLAYWRIGHT_BROWSERS_PATH` already points at a Chromium of the right revision (1194 for the pinned `@playwright/test` 1.56.1) nothing is downloaded.
4. Run, from the repository root:
   ```bash
   ( export E2E_DATABASE_URL=postgres://<user>:<password>@127.0.0.1:5432/fluxkit_e2e_test \
            REDIS_URL=redis://127.0.0.1:6379 MEILI_URL=http://127.0.0.1:7700 MEILI_MASTER_KEY=<key>
     pnpm test:e2e )
   ```
   `pnpm test:e2e` runs `pnpm build` first, then Playwright. A single scenario: `pnpm --filter @fluxkit/storefront test:e2e guest-purchase` (after a build). Headed/debug: `pnpm --filter @fluxkit/storefront exec playwright test -c e2e/playwright.config.ts --headed --debug`.

Redis and Meilisearch are required by the API at start-up (the same variables as the integration tests; the suite does not use Redis for anything else and needs no Meilisearch index). The root `.env` is never read.

## What a run does

`e2e/playwright.config.ts` starts three web servers (it never reuses a running one) and waits until they answer:

| Server | Port | Command |
|---|---|---|
| API (built, `apps/api/dist/main.js`) | 3100 | `e2e/prepare-database.ts` first, then the API |
| Storefront (built, `next start`) | 3101 | `.next/cache/fetch-cache` is deleted first (see Troubleshooting) |
| Proxy (`e2e/proxy.ts`, the only origin a browser sees) | 3102 | `node --experimental-strip-types e2e/proxy.ts` |

Ports can be changed with `E2E_PORT`, `E2E_API_PORT`, `E2E_STOREFRONT_PORT`.

- **Database.** `e2e/prepare-database.ts` refuses a name that does not end in `_e2e_test` (and checks `select current_database()`), drops the `drizzle` and `public` schemas, then runs the API's own built commands: `database/migrate.js`, `seed/seed.js` (the demo catalog) and `auth/create-admin.js` (one owner, `e2e-owner@example.com`, a throwaway password in `support/env.ts`). It is part of the API's `webServer` command and not a `globalSetup` because Playwright starts web servers BEFORE `globalSetup`. `pg` is resolved from `apps/api` (no dependency of its own).
- **API environment.** `apiEnvironment()` in `support/env.ts` SETS every variable that decides behaviour (`TRUST_PROXY=1`, `STORE_COOKIE_SECURE=false`, `ADMIN_COOKIE_SECURE=false`, `ORDER_TOKEN_SECRET`, `SCHEDULER_ENABLED=false`, `FEATURES_ENABLED=`, `MAX_OPEN_ORDERS=3`, ...), so a variable exported in your shell cannot change a run. The processes are started with plain `node`, not with the package scripts that need a root `.env`.
- **Same origin (ADR 0026).** The cookies have `Path=/store`, writes need `X-Fluxkit-CSRF` and the API sends no CORS headers, so the browser must reach `/store/*` and the pages on one origin. `proxy.ts` routes `/store/*` and `/admin/*` to the API and everything else to the storefront, and SETS `X-Forwarded-For` itself, like the production edge proxy (the API trusts exactly this one hop).
- **Rate limits.** The `checkout` limit is 10 per 10 minutes per client address, in memory. Every test sends a header `x-e2e-client: <number>` (Playwright `extraHTTPHeaders`, see `support/fixtures.ts`); only the proxy reads it, turns it into `10.a.b.c`, uses that as `X-Forwarded-For` and removes it. So each test, retry and "other shopper" has its own address and window. No production code knows about the header. `MAX_OPEN_ORDERS` (3 unpaid orders per email) is avoided with a unique email per test (`uniqueEmail`).
- **Workers.** One worker, tests in file order. The scenarios change shared catalog data (a price, the last unit of a product) and each test uses a product no other test changes, so they are deterministic; they do not depend on each other's orders.
- **Retries and artifacts.** No retry locally; one in CI (`CI` set). Trace on the first retry, screenshot and video only on failure, in `apps/storefront/test-results/`; CI also writes the HTML report to `apps/storefront/playwright-report/` and uploads both when the job fails (both are git-ignored). Open a trace: `pnpm --filter @fluxkit/storefront exec playwright show-trace test-results/<test>/trace.zip`.
- **No sleeps.** Tests wait with Playwright's auto-waiting and web-first assertions. The one synchronisation helper, `waitForHydration` (`support/flows.ts`), waits for the cart badge to show a count, which only happens after the page's islands run in the browser.

## Scenarios (`e2e/tests/*.e2e.ts`)

| File | What it proves |
|---|---|
| `guest-purchase` | home -> product -> options -> cart -> checkout (address) -> order page with the token in the fragment (after the client-side navigation), the attempt removed from `sessionStorage`, the copy button, reload of the link, cancel with confirmation |
| `customer-account` | register with a guest cart (kept, no notice needed), customer checkout of a digital product (no address, prefilled contact), account order list and detail, cancel; sign-in merge of 600 + 600 units: the notice is shown once and dismissed for good |
| `cart-changes` | price changed through the admin API between cart and checkout: `cart_changed`, banner, blocked submit, OK, new total, order at the new total; last unit bought by another session: `checkout_refused` on the line, the attempt (key + hash only) survives a reload, the same body reuses the key, a changed body gets a new one |
| `locale-switch` | the switcher keeps the page, the query and the order link's fragment (both directions); the copy button's fallback message when the Clipboard API is missing |
| `keyboard-checkout` | the whole purchase and the order cancel with Tab, Enter, Space and typing only; focus order of the checkout form; focus follows the cancel steps |
| `token-hygiene` | the order token is in no URL, request or response header, request body (except the lookup/cancel POST bodies, asserted to contain it), server HTML, title, cookie, storage or console message; `Referrer-Policy: no-referrer` on the order page |
| `double-submit` | a double click on "Place the order" gives exactly one order (counted through the admin API) |
| `failed-sign-in` | one message, no field marked, focus on the summary, password cleared |
| `not-found` | unknown product, category, page and out-of-range page answer HTTP 404 with the not-found page, in both locales |

## Troubleshooting

- `E2E_DATABASE_URL must be set` / `Refusing to wipe database ...`: see step 2; the name rule is deliberate.
- `Executable doesn't exist ...`: the browser for this Playwright version is not installed (step 3). Playwright 1.56.1 needs Chromium revision 1194.
- A web server "timed out": run the three commands of the table by hand to see the error. The API needs `pnpm build` (the suite uses `dist/`), Redis and Meilisearch.
- Product pages answer "Nothing was found" on add to cart: the storefront rendered ids of a previous seed from its on-disk data cache (`.next/cache/fetch-cache`, 60 s). The suite deletes that directory before it starts the storefront; if you start the storefront yourself against a re-seeded database, delete it too.
- Port in use: another run or server holds 3100 to 3102 (`reuseExistingServer` is off on purpose): stop it or set the `E2E_*` ports.
- One Playwright run at a time per database (the schema is wiped at the start).

## Not covered

Automated accessibility checks (`@axe-core/playwright`, MPL-2.0, not approved yet), other browsers and viewports, payments (none in v1), email (none), the admin app, `next dev`.
