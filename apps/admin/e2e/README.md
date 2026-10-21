# Admin end-to-end tests (Playwright)

Browser tests of the admin SPA against the real stack: Postgres, Redis, Meilisearch, the built API, the built SPA (`apps/admin/dist`) and a same-origin proxy. Plan: `docs/plans/2026-10-19-admin-ui.md`, step 11 (owner answer 7: a separate suite next to the storefront's). Chromium only. They are NOT part of `pnpm test` (they are slow and need a browser); `pnpm test:e2e` runs the storefront suite first and this one after it.

## Run it locally

1. Services up (README quick start: Compose, or native Postgres, Redis and Meilisearch). Node 22, `pnpm install`.
2. A database for the suites. Its name MUST end in `_e2e_test`; each suite DROPS everything in it at the start of its run, so do not reuse `fluxkit_test` (`pnpm test`) or a development database. The storefront suite uses the same database (`E2E_DATABASE_URL`):
   ```bash
   createdb -h 127.0.0.1 -U <user> fluxkit_e2e_test
   ```
3. Chromium once: `pnpm --filter @fluxkit/admin exec playwright install chromium` (add `--with-deps` on a fresh Linux machine). The admin suite pins the same `@playwright/test` (1.56.1, Chromium revision 1194) as the storefront, so one installed browser serves both; with `PLAYWRIGHT_BROWSERS_PATH` pointing at it nothing is downloaded.
4. Run, from the repository root:
   ```bash
   ( export E2E_DATABASE_URL=postgres://<user>:<password>@127.0.0.1:5432/fluxkit_e2e_test \
            REDIS_URL=redis://127.0.0.1:6379 MEILI_URL=http://127.0.0.1:7700 MEILI_MASTER_KEY=<key>
     pnpm test:e2e )                                   # build, storefront suite, then this suite
   ```
   Only this suite (after `pnpm build`): `pnpm --filter @fluxkit/admin test:e2e`; one file: `pnpm --filter @fluxkit/admin test:e2e product`; headed: `pnpm --filter @fluxkit/admin exec playwright test -c e2e/playwright.config.ts --headed --debug`.

The root `.env` is never read. Redis and Meilisearch are needed by the API at start-up only.

## What a run does

`e2e/playwright.config.ts` starts two web servers (it never reuses a running one) and waits until they answer, then `global-setup.ts` runs:

| Server                                                     | Port | Command                                                     |
| ---------------------------------------------------------- | ---- | ----------------------------------------------------------- |
| API (built, `apps/api/dist/main.js`)                       | 3110 | `e2e/prepare-database.ts` first, then the API               |
| Proxy (`e2e/proxy.ts`, the only origin the browser talks to) | 3112 | `node --experimental-strip-types e2e/proxy.ts` (needs `dist`) |

Ports can be changed with `ADMIN_E2E_PORT` and `ADMIN_E2E_API_PORT` (the storefront suite uses 3100 to 3102, so both can never collide).

- **Database.** `prepare-database.ts` refuses a name that does not end in `_e2e_test` (and checks `select current_database()`), drops the `drizzle` and `public` schemas, then runs the API's built `database/migrate.js`, `seed/seed.js` (the demo catalog) and `auth/create-admin.js` (the owner `e2e-owner@example.com`, a throwaway password in `support/env.ts`). It is part of the API's `webServer` command because Playwright starts web servers BEFORE `globalSetup`.
- **Admins.** `global-setup.ts` signs in as the owner through the proxy and creates the manager and the viewer through `POST /admin/users`, as an owner would (the API must be running for that, so it is not part of `prepare-database.ts`).
- **API environment.** `apiEnvironment()` in `support/env.ts` SETS every variable that decides behaviour (`TRUST_PROXY=1`, `ADMIN_COOKIE_SECURE=false`, `STORE_COOKIE_SECURE=false`, `SCHEDULER_ENABLED=false`, `FEATURES_ENABLED=`, locales, currency, ...), so a variable exported in your shell cannot change a run.
- **Topology (ADR 0027).** As on the storefront origin in production: `/admin-ui` and `/admin-ui/*` are the built SPA, served by `proxy.ts` from `apps/admin/dist` with the `index.html` fallback for every SPA path that is not a file (a missing `/admin-ui/assets/*` file is a 404, never the HTML), `ADMIN_SECURITY_HEADERS` on every `/admin-ui` answer and `ADMIN_CACHE_CONTROL` (`no-cache` for the HTML, `immutable` for the assets) from `security-headers.ts`; `/admin/*` and `/store/*` go to the API; anything else is a 404 (the storefront is not started; its suite tests it). The proxy SETS `X-Forwarded-For` itself, like the production edge proxy (the API trusts exactly this one hop). Store-side setup (registering a customer, placing an order) uses Playwright's request context through the same proxy with the CSRF header, its own cookies and a fresh `Idempotency-Key` UUID per order (`support/api.ts`); the SPA itself never calls `/store`.
- **Rate limits.** The admin and store login limits (20 per 10 minutes per address), registration (10 per hour) and checkout (10 per 10 minutes) are in memory per client address. Every browser and API context of a test sends `x-e2e-client: <number>` (`support/fixtures.ts`, a hash of the test id, the retry and a role name); only the proxy reads it, turns it into `10.a.b.c`, uses it as `X-Forwarded-For` and removes it. No production code knows about the header.
- **The guard** (`support/fixtures.ts`, `Guard`, on every browser context of every test, checked when the test ends):
  - every request goes to the proxy origin and only to `/admin-ui` (the SPA's files) or `/admin/*`; requests to other hosts are aborted in the browser before they leave it;
  - every `POST`, `PUT`, `PATCH` and `DELETE` to `/admin/*` carries `X-Fluxkit-CSRF: 1`;
  - no Content-Security-Policy violation (a `securitypolicyviolation` event or a "Refused to" console line). One exception, checked exactly: the seed's media and brand logo live on `example.com`, which the admin's CSP does not allow (`img-src 'self' data:`); the SPA shows a text instead of the preview (`apps/admin/README.md`). Such an image is accepted only when the CSP refused that very address;
  - no uncaught page error and no console error, except Chromium's "Failed to load resource: the server responded with a status of NNN" line, which every `fetch` with an HTTP error status logs and which the scenarios cause on purpose (401, 403, 409). Decision: fail on every other console error rather than none (a React error or a CSP line must fail) or all (the expected refusals would fail every negative scenario). One scenario names the console errors it causes on purpose (`guard.expectConsoleErrors`: the `serving` scenario that breaks an area chunk) and counts them; any other console error still fails;
  - the English `detail` of every `application/problem+json` answer the browser received never appears in a text node of the page, unless that node is one of the SPA's own messages (`src/messages/*/*.json` are read as data: a few messages start with the API's English sentence).
- **Workers and independence.** One worker, files in alphabetical order, tests in file order. Every test creates what it changes under its own suffix (`unique(testInfo)`: codes, slugs, emails, SKUs), uses the seed read-only (product types, the screwdriver for orders) and does not depend on another test's data, so any single file runs alone.
- **Retries and artifacts.** No retry locally; one in CI (`CI` set). Trace on the first retry, screenshot and video only on failure, in `apps/admin/test-results/`; CI also writes the HTML report to `apps/admin/playwright-report/` and uploads both (with the storefront's) when the job fails. **The artifacts contain session material** (the admin cookies of the three e2e admins, the store cookies of throwaway customers) of a database that is wiped at every run and an ephemeral API; never put real secrets or data into the e2e environment. Retention is 7 days.
- **No sleeps.** Tests wait with Playwright's auto-waiting and web-first assertions (`expect(...).toBeVisible()`, `expect.poll`); requests are awaited with `waitForRequest`/`waitForResponse`.

## Scenarios (`e2e/tests/*.e2e.ts`)

| File           | What it proves |
| -------------- | -------------- |
| `sign-in`      | a failed sign-in shows ONE generic message, clears the password and focuses it, an unknown email gives the same message, no session; a locked-out admin (5 failures) gets the identical message also with the right password; sign-in through the form from a deep link (`next`) and sign-out (the session is gone, `me` is `401`); the uk switch (heading, `lang`, remembered, the generic message translated) |
| `roles`        | viewer: catalog navigation only, products list without "New product", the product editor read-only on all eight tabs (no save, add, remove, generate, record, lifecycle buttons), dictionaries without create, edit, delete or subcategory controls, "Not allowed" on `/orders`, `/catalog/attributes/new` and `/users`, no write and no read of orders, customers or users; manager: no users navigation, "Not allowed" on `/users` and `/users/new`, no users request |
| `serving`      | `/admin-ui/` and `/admin-ui` (no slash) serve the SPA with every header of `ADMIN_SECURITY_HEADERS` (`script-src 'self'`, no `unsafe-inline`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`) and `Cache-Control: no-cache`; the hashed assets with the same headers and `immutable`; a deep link and its reload through the `index.html` fallback; an unknown SPA path is the SPA's not-found view; `/admin/*` stays JSON; an injected inline script is refused by the CSP (`script-src-elem`) and does not run; the orders area chunk (found in the build manifest) aborted on an in-app navigation and answered 404 on a deep link: the translated error view with "Reload the page" inside the shell (header and navigation usable), the import error logged once each time, and the reload works once the chunk is back |
| `dictionaries` | as the manager: an option with two values, a one-choice attribute with two options, a product type with the attribute (required) and the option, a brand, two root categories, a child created under one and moved under the other (confirmed), visible in the tree |
| `product`      | create a draft of the seeded "Clothing" type; the attribute form generated from the type (Material, Care notes per language, the internal Supplier reference) saved; options replaced on a draft (the rebuild warning and its confirmation); a variant deleted and generated again; a decimal price `1234.50` stored as `123450` minor units; a receipt of 7 units (level, journal, state); publish refused with `price_missing`, the problem listed with "Go to Prices", the empty cell focused and marked invalid; the price added, publish succeeds; `GET /store/products/{slug}` through the proxy has both exact amounts; every write had the CSRF header; two `requestSubmit()` of the create form in one task send ONE create |
| `orders`       | two guest orders placed through the store API; the list filtered by status and an exact number (in the URL), the same number with another status gives "No order matches", by email; detail; mark paid with the total read-only (no amount field), a reference and the confirmation: the request carries exactly `{reference, amount}`; while its answer is held back the dialog's buttons are disabled and Escape does not close it; history; mark fulfilled (confirmed); the other order cancelled with a reason (history shows it); the list agrees |
| `customers`    | a registered customer locked by five failed store sign-ins; found by the email prefix; the lock shown; unlock (the customer can sign in); deactivate (confirmed, the safe choice focused): both store sessions end at once and sign-in is refused; activate: sign-in works again |
| `users`        | the owner creates a manager: live policy feedback, a too-short password refused before sending (focused, nothing sent), the email as password marked "not met"; the create request carries exactly email, role and password; the password appears nowhere after the create; the new manager signs in with it; the same email (upper case) is refused on the email field and the password cleared |
| `session`      | the browser's session is logged out from another client (its cookie copied); the next save opens the re-sign-in dialog (Escape does not close it), the typed input stays, nothing was stored; after signing in again the save is not replayed, a second save stores it; with unsaved input, sign-out from the header and from the re-sign-in dialog asks "Leave this page?" (Stay keeps the session and the input; Leave signs out) |
| `keyboard`     | keyboard only on a product editor: the skip link, the focus order (back link, publish, delete, then the tab list as one tab stop), arrow keys, Home and End move and select tabs (automatic activation, wrapping, the tab in the URL), the title edited and saved with Tab and Enter, a confirmation dialog opened with Enter with the focus on Cancel, the page behind it never focused, closed with Escape with the focus back on its opener, nothing deleted; two arrow keys sent in one task (faster than the editor's query-string navigation) leave the focus and the selected tab on the same tab (regression test of the `Tabs` fix of this step); after a keyboard sign-in from a deep link the requested page's `h1` has the focus, after Enter on a side navigation link the new area's `h1`, and the language buttons keep the focus while and after the switch |

## Troubleshooting

- `E2E_DATABASE_URL must be set` / `Refusing to wipe database ...`: see step 2; the name rule is deliberate.
- `.../apps/admin/dist/index.html cannot be read`: run `pnpm build` (the proxy serves the build, not the dev server).
- `Executable doesn't exist ...`: Chromium for Playwright 1.56.1 (revision 1194) is not installed (step 3).
- A web server "timed out": run its command from the table by hand to see the error (the API needs `pnpm build`, Redis and Meilisearch).
- Port in use: another run holds 3110 or 3112 (`reuseExistingServer` is off on purpose): stop it or set the `ADMIN_E2E_*` ports.
- One Playwright run at a time per database (each suite wipes it at its start).

## Not covered

Automated accessibility checks (`@axe-core/playwright`, MPL-2.0, not approved), screen readers, other browsers and viewports, the dev server (`vite dev`), media upload (plan step 2b, not built), the stock reservations list with real orders, the lost-answer paths of every write (the Vitest specs and the steps' smoke runs cover them; a test that drops an answer needs request interception per write), the owner's password reset and role change screens, the category delete and the attribute flag rules, the product list filters, the storefront itself (its own suite).
