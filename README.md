# Fluxkit

White-label e-commerce template: a solid catalog/cart/checkout core, replaceable design, and feature modules you can switch on or off per client.
Sold as a template plus a team that adapts design and features for each client.

**Powered by [FluxLab](https://flux-lab.dev/en)**

## Principles

- **Niche-agnostic catalog**: Product + Variant (SKU), data-driven attributes via ProductType (admin write API and public store read API built; ADR 0004 and ADR 0006).
- **Replaceable design**: design tokens (`packages/theme`) and a token-based UI library (`packages/ui`); redesign = change tokens, not components.
- **Modular features**: every optional feature is its own package behind one flag; core never imports features (enforced in CI).
- **Honest checks**: no stubbed scripts, no skipped integration tests, no cached test passes.

## Status

Scaffold complete (plan `docs/plans/2026-10-14-monorepo-scaffold.md`). Catalog plan (`docs/plans/2026-10-14-catalog.md`): complete. Admin auth plan (`docs/plans/2026-10-16-auth-and-roles.md`): complete. Pricing and inventory plan (`docs/plans/2026-10-16-pricing-and-inventory.md`): complete. Cart, customers and orders plan (`docs/plans/2026-10-17-cart-and-orders.md`): steps 1 to 7 done (the API, the scheduler and the docs), step 8 (independent review) pending.
**Not built yet**: payment and shipping providers (an admin marks an order paid by hand), email delivery (no password reset or email verification), search indexing, and the admin screens for orders and customers (the placeholder pages only). The storefront takes NO payment: v1 is not for live sales until the payment plan (an unpaid order expires after `ORDER_PAYMENT_TTL_MINUTES`, 30 by default, unless an admin marks it paid). What exists and works:

- API: `GET /health`, Swagger UI at `/docs`, OpenAPI export, feature loader (sample feature `example`), Drizzle migrations (`0000_health_check`, `0001_catalog`, `0002_admin_auth`, `0003_pricing_inventory`, `0004_cart_customers_orders`), BullMQ and Meilisearch spikes.
- Catalog: admin write API under `/admin` (attributes, options, product types, brands, categories, products, variants; protected by sign-in and roles) and public read API under `/store` (categories, product list and detail; locales `uk` and `en`), ProductType presets and demo data (`pnpm seed`). Endpoints and errors: `docs/api/catalog.md`.
- Prices and stock: one price per variant and currency (plus an optional old price), per-variant stock levels with an append-only journal, a reservation service used by the checkout, the order service and the scheduler (no HTTP route), and public store fields `price` and `availability` (`in_stock`, `low_stock`, `out_of_stock`; never quantities) plus `GET /store/config`. Settings: `SHOP_CURRENCY` (default `UAH`; an active variant needs a price in it), `PRICES_INCLUDE_TAX` (default `true`, a display flag only, no tax is calculated) and `LOW_STOCK_THRESHOLD` (default `5`), see `.env.example` and `docs/contracts/config.md`. Endpoints: `docs/api/pricing.md` and `docs/api/inventory.md`. `pnpm seed` gives every demo variant a price and a stock level that shows each availability state, but only for products it creates: it never prices or stocks a product that already exists, so on a database seeded before prices existed the store stays empty until the variants are priced (bulk price endpoint). Changing `SHOP_CURRENCY` after data exists hides every live product without a price in the new currency; price them first.
- Admin authentication: cookie sessions, roles `owner`, `manager`, `viewer`, owner-only user management, first owner through `pnpm admin:create` (see Admin sign-in below). Endpoints: `docs/api/auth.md`; contract: `docs/contracts/api.md`.
- Customer accounts (`/store/account/*`: register, login, logout, profile, change password; separate cookie session, CSRF header on every `/store` write, lockout, rate limits) and admin customer management (`/admin/customers`, permissions `customers.read` and `customers.write`); no password reset or email verification yet: `docs/api/customers.md`.
- Cart (`/store/cart/*`: add, change, remove, acknowledge, delete): guest carts by cookie (`fluxkit_cart`, `CART_TTL_DAYS`) and one cart per signed-in customer, always repriced with the current catalog prices and notices (`price_changed`, `unavailable`, `out_of_stock`), no stock held, server-side totals, and the guest cart merged into the customer's at login and registration (`cartNotices`): `docs/api/cart.md`.
- Checkout and orders (`POST /store/checkout`, `/store/orders/lookup|cancel`, `/store/account/orders`): one transaction reserves the stock of every line (all or nothing, 30 minutes by default: `ORDER_PAYMENT_TTL_MINUTES`), stores an immutable snapshot with server-side totals and empties the cart; an `Idempotency-Key` makes a retry safe; guests get an access token (`ORDER_GUEST_ACCESS_DAYS`; derived from the order and the idempotency key with `ORDER_TOKEN_SECRET`, so a double submit returns the same token; at most `MAX_OPEN_ORDERS` unpaid orders per email or customer), customers see their history; unpaid orders can be cancelled by their owner. Admins list, read, cancel, mark paid and mark fulfilled orders (`/admin/orders`, permissions `orders.read` and `orders.write`; not the viewer), and plugins read an order through the `OrderReadPort`. Payment and shipping providers are the next steps: `docs/api/orders.md`, `docs/contracts/events.md`. Unpaid orders expire by themselves: the scheduler (see Scheduler and jobs below).
- Storefront (`/uk`, `/en`; plan `docs/plans/2026-10-18-storefront.md`, steps 1 to 8): home, catalog and category pages, product page with variants, cart, guest and customer checkout, the guest order page (private link) and the customer's order history, sign-in, registration and profile; see `apps/storefront/README.md` and the Storefront walkthrough below; Playwright end-to-end tests of the purchase flow (`pnpm test:e2e`, `apps/storefront/e2e/README.md`). Admin: placeholder pages built from the shared UI and tokens (light and dark themes).
- CI on GitHub Actions: lint, types, boundaries, tests on real Postgres 17 / Redis 8 / Meilisearch, feature on/off/deleted matrix, license and audit policy, docs-with-code check, Compose smoke test.

Open decisions and next steps are listed at the end.

## Quick start

Prerequisites: Node 22 (`.nvmrc`), pnpm 10.28 (`corepack enable`), Docker with Compose.

```bash
pnpm install
cp .env.example .env     # edit values; never commit .env
                         # keep the passwords inside DATABASE_URL and REDIS_URL equal to POSTGRES_PASSWORD and REDIS_PASSWORD
                         # if ports 5432, 6379 or 7700 are taken, change POSTGRES_PORT, REDIS_PORT, MEILI_PORT and the URLs too
                         # ORDER_TOKEN_SECRET (at least 32 characters) is required: the API will not start without it; put your own
                         # (`openssl rand -base64 48`) in .env, the placeholder is for local development only

# Postgres, Redis, Meilisearch
docker compose --env-file .env -f infra/docker-compose.yml up -d --wait

# Tests drop schema objects, so they need a separate database whose name ends in _test
docker compose --env-file .env -f infra/docker-compose.yml exec postgres createdb -U fluxkit fluxkit_test

pnpm build
pnpm db:migrate                         # applies the pending migrations to DATABASE_URL (forward only, safe to repeat), see Database migrations
pnpm seed                               # optional: demo catalog (needs a migrated database, see seeds/README.md)
pnpm admin:create --email you@example.com   # first owner (needs a migrated database); asks for the password, see Admin sign-in
pnpm --filter @fluxkit/api start        # API on PORT (default 3000); try /health and /docs
pnpm --filter @fluxkit/storefront dev -p 3001   # http://localhost:3001/uk (the API already uses 3000); reads API_INTERNAL_URL from .env and proxies /store/* to the API (development only)
pnpm --filter @fluxkit/admin dev                # Vite prints the URL (default http://localhost:5173)
```

Run the full test suite (integration tests need real services and fail, not skip, without these variables; use the values from your `.env`).
Use a subshell so the test variables do not leak into your terminal: Node's `--env-file` never overrides variables that are already set, so a leaked
`DATABASE_URL` would make `pnpm --filter @fluxkit/api start` silently use the test database.

```bash
(
  export DATABASE_URL=postgres://fluxkit:<POSTGRES_PASSWORD>@127.0.0.1:5432/fluxkit_test
  export REDIS_URL=redis://:<REDIS_PASSWORD>@127.0.0.1:6379
  export MEILI_URL=http://127.0.0.1:7700 MEILI_MASTER_KEY=<MEILI_MASTER_KEY>
  pnpm test
)
```

The browser tests of the storefront (Playwright, Chromium) are separate and slower: `pnpm test:e2e` builds, starts the API, the storefront and a same-origin proxy on a throwaway database of its own and drives the purchase flow in a browser. It needs one more database whose name ends in `_e2e_test` (it is wiped at every run) and the Chromium download; the step-by-step is in `apps/storefront/e2e/README.md`.

## Database migrations

```bash
pnpm db:migrate     # = pnpm build && pnpm --filter @fluxkit/api db:migrate (node dist/database/migrate.js)
```

- Applies every pending migration of `apps/api/drizzle/` to `DATABASE_URL` (from `.env`) in journal order, with the Drizzle migrator. It prints the database name (never the user, password or host), then the applied migrations (`0000_health_check`, ...) or `Database is up to date (N migrations)`. Running it again applies nothing.
- It takes no arguments: anything after the script name reaches the command as it is and is rejected (do not add `--`). Exit code 1 means nothing was applied or the failed migration was rolled back by the migrator (all pending migrations run in one transaction); the error is printed in full, with connection strings and passwords removed.
- Forward only: this command never rolls back, drops or deletes. A rollback is manual: run the hand-written `apps/api/drizzle/NNNN_name.down.sql` of the newest migration against the database (see `docs/HANDOFF.md`, schema changes).
- Safe for production and for several instances starting together: a Postgres advisory lock (key `7426002`) lets one instance migrate while the others wait and then find nothing to do. If the database holds a migration newer than every entry of the journal (the code is older than the database), the command refuses with exit code 1 and changes nothing.
- Not for the `_test` database that `pnpm test` uses: the tests migrate it themselves.

## Scheduler and jobs

The API runs its background work itself: every `SCHEDULER_INTERVAL_SECONDS` (default 60) it expires unpaid orders (and gives their stock back), sweeps stale stock reservations, delivers domain events to plugins, and deletes expired carts, customer sessions and old delivered events. With several API instances only one works per tick (a Postgres advisory lock, key `7426003`); a crashed instance releases it by itself. Nothing is needed beyond the database.

```bash
pnpm jobs:run-once     # = pnpm build && pnpm --filter @fluxkit/api jobs:run-once (node dist/jobs/run-once.js)
```

- Runs every job once now and prints one line of counts per job. Use it from a system cron when you set `SCHEDULER_ENABLED=false`, or to run the jobs by hand. Reads `DATABASE_URL` and the other settings from `.env`; takes no arguments.
- Exit code `0`: all jobs ran. `1`: a job failed (the full error is printed, the connection string removed) or the settings are wrong. `2`: a running scheduler holds the lock, so nothing was run (it is doing this work; try again later).
- If the scheduler is off everywhere and no cron runs this command, unpaid orders keep their stock reserved. `GET /health` does not show the scheduler yet.
- Jobs, retry rules and the handler contract: `docs/api/jobs.md`, `docs/contracts/events.md`.

## Deployment notes: reverse proxy and rate limits

The store rate limits (checkout, registration, login, order lookup, guest cancel) and the admin login limit count requests per client address (`request.ip`). The API trusts no proxy by default (`TRUST_PROXY=0`), so the address is the one that connects to it. Behind a reverse proxy, a CDN or the Next.js server calling the API from the server side, that address is the proxy's, and every shopper then shares ONE window: the whole shop would get, for example, 10 checkouts per 10 minutes.

- Set `TRUST_PROXY` to the **exact number of proxies** between the internet and the API (`1` for one nginx or one Next.js server, `2` for a CDN plus nginx, and so on; 0 to 10). Each of them must append the address it saw to `X-Forwarded-For` (nginx `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`; a Next.js server must forward the visitor's address the same way).
- **Too high is a security hole:** the extra hops are read from the part of `X-Forwarded-For` the client controls, so a client can invent its address and dodge every limit. **Too low** keeps the shop-wide window. Check it after a deployment: from two different networks, a request to a limited route must be counted separately.
- Keep the API reachable only through the proxy when `TRUST_PROXY` is above 0; otherwise anyone who can reach it directly can send the header themselves.
- IPv6 clients are counted per /64 prefix after this step too. The counters are in memory per API process (ADR 0009, ADR 0016).

`MAX_OPEN_ORDERS` (default 3) separately caps the unpaid orders per guest email and per customer (ADR 0024); it does not depend on addresses.

## Admin sign-in

Every `/admin` route needs a signed-in user. There is no sign-up and no default account: the first owner is created with the command line, then signs in with `POST /admin/auth/login` (`docs/api/auth.md`).

```bash
pnpm admin:create --email you@example.com                  # in a terminal: asks for the password twice, nothing is echoed
ADMIN_PASSWORD='a long password' pnpm admin:create --email you@example.com --role manager   # scripts: from the environment
```

- Options: `--email` (required) and `--role` (`owner`, `manager` or `viewer`; default `owner`). Arguments after the script name reach the command as they are; do not add `--` (it is rejected as an unknown argument).
- The password comes from `ADMIN_PASSWORD` or the prompt, 12 to 128 characters. A `--password` argument is refused on purpose: command-line arguments leak through the process list and shell history. Without `ADMIN_PASSWORD` and without a terminal the command fails.
- The command only creates. An email that already exists is refused and left untouched; it never changes a password or a role. It prints `Created owner you@example.com (id ...)` and never the password. The database must be migrated first with `pnpm db:migrate` (same as `pnpm seed`) and `DATABASE_URL` comes from `.env`.
- For plain-HTTP local development set `ADMIN_COOKIE_SECURE=false`; the default is a `Secure` cookie, which is meant for HTTPS. Every state-changing request must carry the header `X-Fluxkit-CSRF: 1`.

| Role | Can do |
|---|---|
| `owner` | everything, including managing users |
| `manager` | read, write and publish the catalog; read and manage orders and customers |
| `viewer` | read the catalog (no orders and no customers: they hold personal data) |

More users: an owner calls `POST /admin/users` with `{email, role, password}` (and `PATCH /admin/users/{id}` to change a role or deactivate, `POST /admin/users/{id}/reset-password` to set a new password). There is no self-service password reset by email yet.
If every owner is locked out or has lost the password, create a new owner with `pnpm admin:create`; the command works against the database directly and needs no existing session.

**An owner is locked** (5 wrong passwords lock an account for 15 minutes, by design; see ADR 0010)? Pick one:

- wait 15 minutes;
- another owner calls `POST /admin/users/{id}/reset-password` (it also clears the lock and ends the user's sessions);
- run `pnpm admin:unlock --email owner@example.com` on the server. It sets the failed-login counter to 0 and removes the lock, nothing else (no password, role, active flag or session is touched), and prints `Unlocked owner@example.com` (or `owner@example.com was not locked`). An unknown email exits with code 1. Like `admin:create` it reads `DATABASE_URL` from `.env` and needs no session.

Enable optional features with `FEATURES_ENABLED=example` (comma-separated) in `.env`; see `docs/contracts/config.md`.

## Checkout walkthrough

A copy-pasteable run of the whole flow with `curl` and `jq` against a local API: browse, fill a cart, register, place an order, pay and fulfil it as an admin, cancel another one, run the jobs. It uses only documented routes (`docs/api/cart.md`, `customers.md`, `orders.md`, `auth.md`) and was run against a freshly migrated and seeded database.

Prerequisites:

- Quick start done: migrated database (`pnpm db:migrate`), `pnpm seed` (the database name must end in `_test`, `_dev`, `_demo` or `_local`; the default `fluxkit_dev` does), an owner (`pnpm admin:create --email owner@example.com`), the API running (`pnpm --filter @fluxkit/api start`).
- Plain HTTP on localhost: put `ADMIN_COOKIE_SECURE=false` and `STORE_COOKIE_SECURE=false` into `.env` before starting the API, otherwise the cookies carry `Secure` and `curl` does not send them back over `http://`.
- The seed creates no customers and no orders (see `seeds/README.md`); the flow below creates them.
- Every state-changing request carries `X-Fluxkit-CSRF: 1` and, with a body, a JSON content type (`403 forbidden` otherwise). Cookies live in two jars: `shop.jar` (cart and customer session, `Path=/store`) and `admin.jar` (admin session, `Path=/admin`).

```bash
API=http://localhost:3000                      # PORT from .env
H=(-H 'X-Fluxkit-CSRF: 1' -H 'Content-Type: application/json')

# 1. Read the shop settings and the catalog (public, no cookie)
curl -s $API/store/config
curl -s "$API/store/products?limit=20" | jq -r '.items[] | "\(.slug)  \(.price.from) \(.price.currency)  \(.availability)"'
VARIANT_ID=$(curl -s $API/store/products/demo-e-book | jq -r '.variants[0].id')   # a digital product: no shipping address needed

# 2. Add to the cart as a guest (the first write creates the cart and sets the fluxkit_cart cookie), then read it
curl -s -c shop.jar -b shop.jar "${H[@]}" -X POST $API/store/cart/items \
  -d "{\"variantId\":\"$VARIANT_ID\",\"quantity\":2}" | jq -c '{itemCount, total, purchasable}'
curl -s -b shop.jar $API/store/cart | jq '.lines[0], .total'

# 3. Register a customer: signs in with a new session and merges the guest cart into the account's cart
#    (a taken email is 409: use another address when you repeat the run)
curl -s -c shop.jar -b shop.jar "${H[@]}" -X POST $API/store/account/register \
  -d '{"email":"shopper@example.com","password":"a long demo password","firstName":"Demo","lastName":"Shopper","phone":"+380501234567"}' | jq -c .
curl -s -b shop.jar $API/store/cart | jq -c '{itemCount, total}'          # still 2 items

# 4. Check out. The Idempotency-Key makes a retry safe; expectedTotal is the total the shopper saw (a consent check, never a price)
TOTAL=$(curl -s -b shop.jar $API/store/cart | jq -c '.total')
KEY=$(cat /proc/sys/kernel/random/uuid)                                    # any new UUID per attempt
curl -s -c shop.jar -b shop.jar "${H[@]}" -H "Idempotency-Key: $KEY" -X POST $API/store/checkout \
  -d "{\"phone\":\"+380501234567\",\"firstName\":\"Demo\",\"lastName\":\"Shopper\",\"expectedTotal\":$TOTAL}" \
  -w '\nHTTP %{http_code}\n' | tee order.json
NUMBER=$(head -1 order.json | jq -r '.order.number')
# the same request with the same key answers 200 with the same order, nothing is reserved twice (rerun the curl above to see it)

# 5. Read the order as its owner (status awaiting_payment, 30 minutes to pay by default)
curl -s -b shop.jar "$API/store/account/orders/$NUMBER" | jq -c '{number, status, total, expiresAt}'
curl -s -b shop.jar "$API/store/account/orders" | jq -c '.items'

# 6. Admin: sign in, find the order, mark it paid (no payment provider exists yet), fulfil it
curl -s -c admin.jar "${H[@]}" -X POST $API/admin/auth/login \
  -d '{"email":"owner@example.com","password":"<the owner password>"}' | jq -c .user
ORDER_ID=$(curl -s -b admin.jar "$API/admin/orders?q=$NUMBER" | jq -r '.items[0].id')
AMOUNT=$(echo "$TOTAL" | jq '.amount'); CURRENCY=$(echo "$TOTAL" | jq -r '.currency')
curl -s -b admin.jar "${H[@]}" -X POST $API/admin/orders/$ORDER_ID/mark-paid \
  -d "{\"reference\":\"demo-payment-1\",\"amount\":{\"amount\":$AMOUNT,\"currency\":\"$CURRENCY\"}}" | jq -c '{number, status, paymentReference, paidAt}'
curl -s -b admin.jar "${H[@]}" -X POST $API/admin/orders/$ORDER_ID/mark-fulfilled | jq -c '{number, status, fulfilledAt}'
curl -s -b shop.jar "$API/store/account/orders/$NUMBER" | jq -c '{status, history}'   # the customer sees the same history

# 7. A second order, cancelled by its owner while it is unpaid (its stock reservations are released)
curl -s -b shop.jar "${H[@]}" -X POST $API/store/cart/items -d "{\"variantId\":\"$VARIANT_ID\",\"quantity\":1}" > /dev/null
TOTAL=$(curl -s -b shop.jar $API/store/cart | jq -c '.total')
NUMBER2=$(curl -s -b shop.jar "${H[@]}" -H "Idempotency-Key: $(cat /proc/sys/kernel/random/uuid)" -X POST $API/store/checkout \
  -d "{\"phone\":\"+380501234567\",\"firstName\":\"Demo\",\"lastName\":\"Shopper\",\"expectedTotal\":$TOTAL}" | jq -r '.order.number')
curl -s -b shop.jar "${H[@]}" -X POST "$API/store/account/orders/$NUMBER2/cancel" | jq -c '{number, status}'
```

Guest variant (no account): send `email` in the checkout body instead of a session. A guest checkout answers `201 {order, accessToken}`; the token is shown once and opens that one order:

```bash
# a fresh cookie jar (not shop.jar): add to the cart as in step 2, then run step 4 with "email":"guest@example.com" in the body
# and a new Idempotency-Key; NUMBER is .order.number and TOKEN is .accessToken of that 201 response
BODY="{\"number\":\"$NUMBER\",\"accessToken\":\"$TOKEN\"}"
curl -s "${H[@]}" -X POST $API/store/orders/lookup -d "$BODY" | jq -c '{number, status}'
curl -s "${H[@]}" -X POST $API/store/orders/cancel -d "$BODY" | jq -c '{number, status}'    # only while awaiting_payment
```

Unpaid orders expire by themselves: the scheduler (see Scheduler and jobs) releases their stock after `ORDER_PAYMENT_TTL_MINUTES`. A customer or a guest email can hold at most `MAX_OPEN_ORDERS` (3) unpaid orders at once; the next checkout answers `409 too_many_open_orders` until one is paid, cancelled or expired. To run the jobs once by hand (also what a system cron does when `SCHEDULER_ENABLED=false`):

```bash
pnpm jobs:run-once      # prints one line per job (expire-orders, sweep-reservations, dispatch-events, ...); exit 0 ran, 2 a running scheduler holds the lock
```

## Storefront walkthrough

Click through cart -> checkout -> order page in a browser against a local API (development setup; deployed environments use an edge reverse proxy, see Deployment notes and ADR 0026).

1. Quick start done (Compose services, `pnpm db:migrate`, `pnpm seed`), then `pnpm build` once.
2. Root `.env`: `STORE_COOKIE_SECURE=false` (plain HTTP on localhost), `ORDER_TOKEN_SECRET` (32+ characters), `TRUST_PROXY=0`, `API_INTERNAL_URL=http://127.0.0.1:3000`, `STOREFRONT_PUBLIC_URL=http://localhost:3001`.
3. Start the API: `pnpm --filter @fluxkit/api start` (port 3000).
4. Start the storefront in development: `pnpm --filter @fluxkit/storefront dev -p 3001`. Its `next.config.ts` rewrites `/store/*` to `API_INTERNAL_URL` in `next dev` only, so the browser talks to ONE origin (the cookies have `Path=/store`, writes need `X-Fluxkit-CSRF`, the API sends no CORS headers). For `next start` (`pnpm --filter @fluxkit/storefront start -p 3001` after `pnpm build`) there is no rewrite: put a reverse proxy in front that sends `/store/*` to the API and everything else to Next, and that SETS `X-Forwarded-For` (Deployment notes).
5. Open `http://localhost:3001/uk`, open a product, add it to the cart, open the cart, then "Checkout". Fill in the contact fields (and the address: the demo hand tools and clothes need shipping, the demo e-book does not), then "Place the order".
6. A guest lands on `/uk/order/<number>#t=<token>`: the token is in the URL fragment, which the browser never sends to a server. Save that link (it is the only way back; the page has a copy button); the order can be cancelled there while it awaits payment. A signed-in customer lands on `/uk/account/orders/<number>`; the history is under "My orders" on the account page.
7. Nothing is paid online: the order waits as `awaiting_payment` until an admin marks it paid (`POST /admin/orders/{id}/mark-paid`, Checkout walkthrough above) or it expires.

Notes:

- **Use `localhost` or HTTPS.** The checkout needs a secure context for `crypto.randomUUID` and `crypto.subtle` (its idempotency key); on `http://<LAN address>` it refuses to place the order and says why. To test from a phone, put HTTPS in front (a tunnel or a local certificate).
- The checkout keeps one attempt (an idempotency key and a hash of the request, no personal data) in `sessionStorage`: pressing the button twice, retrying after a network error or reloading the tab sends the SAME key, so at most one order is created and the guest gets the same link back.
- A price changed in the admin between the cart and the checkout answers `409 cart_changed`: the page shows the new prices and total and asks to confirm them first.
- The same flow, and the cases that are hard to click through by hand (a price change, the last unit sold to someone else, keyboard-only use, the order link's token staying out of every request), run unattended as `pnpm test:e2e` (`apps/storefront/e2e/README.md`).

## Scripts (root)

| Script | What it does |
|---|---|
| `pnpm build` / `pnpm typecheck` | Turborepo build and type check of every package |
| `pnpm lint` / `pnpm format:check` (`pnpm format`) | ESLint (bans `any`, `@ts-ignore`, empty `catch`) / Prettier |
| `pnpm check:boundaries` | module boundary rules (core must not import features, etc.); fails if nothing was checked |
| `pnpm test` | builds, then runs Vitest in every package (needs the services above) |
| `pnpm test:e2e` | builds, then runs the Playwright browser tests of the storefront (Chromium; needs the services above, a `*_e2e_test` database in `E2E_DATABASE_URL` that is wiped at every run, and `playwright install chromium` once); not part of `pnpm test`, see `apps/storefront/e2e/README.md` |
| `pnpm seed` | builds, then seeds the demo catalog through the admin services (idempotent, refuses `NODE_ENV=production`) |
| `pnpm admin:create --email <address> [--role <role>]` | builds, then creates one admin user (default role `owner`); password from `ADMIN_PASSWORD` or a prompt; never updates an existing user |
| `pnpm admin:unlock --email <address>` | builds, then clears the failed-login counter and the lock of one admin user (nothing else changes); see Admin sign-in |
| `pnpm jobs:run-once` | builds, then runs every scheduler job once under the scheduler lock (exit 0 ran, 1 failed, 2 lock held); see Scheduler and jobs |
| `pnpm openapi:export` | regenerates `docs/api/openapi.json` (a test fails when it is stale) |
| `pnpm check:licenses` / `pnpm audit:prod` / `pnpm notices` | license policy, production audit, third-party notices file |
| `pnpm check:docs` | docs-with-code rules against `origin/main` |
| `pnpm feature-matrix on\|off\|deleted` | feature enable/disable/delete verification (`deleted` removes files, CI only) |

## Repository layout

```
apps/api            NestJS API (REST + OpenAPI)
apps/storefront     Next.js storefront (App Router, Tailwind, tokens, uk/en)
apps/admin          React + Vite admin
packages/core       domain rules, pure TypeScript: catalog, money, pricing, stock, auth, cart and orders (shipping, discounts and tax not yet)
packages/features   optional feature modules (sample: _example)
packages/providers  payment and shipping provider plugins (none yet)
packages/ui         token-based components and i18n helpers
packages/theme      design tokens and their guard tests
packages/config     env and feature flag parsing
packages/api-client typed API client (empty scaffold)
seeds/              demo data and ProductType presets (pure data)
infra/              Docker Compose for Postgres, Redis, Meilisearch
scripts/            CI and policy scripts
docs/               architecture decisions, contracts, API and file maps, plans
```

## Documentation map

- `AGENTS.md`: rules for all contributors and AI agents (architecture, workflow, security, CI). `CLAUDE.md` imports it.
- `docs/HANDOFF.md`: current state, next steps and working agreements; read it first when you pick up the project.
- `docs/adr/`: decisions: 0001 own core, 0002 stack, 0003 tooling, 0004 data model, 0005 search notes, 0006 catalog schema, 0007 and 0008 catalog rules, 0009 and 0010 admin authentication, 0011 and 0012 money, stock and the pricing schema, 0013 and 0014 stock history, 0015 to 0022 cart, customers, orders, the scheduler and the order schema (index with status in `docs/adr/README.md`).
- `docs/contracts/`: public contracts under SemVer (config and feature flags, design tokens, API, domain events and order ports).
- `docs/api/`: endpoint notes and `openapi.json`. `docs/files/`: what each file and package is responsible for.
- `docs/dependencies.md`: licenses and decisions. `docs/plans/`: task plans. `docs/AGENT_WORKFLOW.md`: roles, models and decisions log.

## Working with AI agents

Rules and roles are in `AGENTS.md` and `docs/AGENT_WORKFLOW.md`: plan first, check for existing functionality, never mask failures, stop and ask in the red zones
(dependencies, migrations, public contracts, payments/auth, destructive actions), and have a different agent review every change.

## Licenses

Code dependencies follow the policy in `AGENTS.md` section 16 (`scripts/license-policy.json`). Redis 8 (AGPLv3) runs as an unmodified external service with legal sign-off.
Generate the third-party notices to ship with a delivery with `pnpm notices` (also produced by CI).

## Open decisions and next steps

1. Ukrainian search morphology and variant-level facet counts (`docs/adr/0005-search-notes.md`).
2. Independent review of the cart, customers and orders plan (step 8 of `docs/plans/2026-10-17-cart-and-orders.md`, by a different agent than the author), then its follow-ups (listed in the plan Outcome and `docs/HANDOFF.md`).
3. Next domain plans, each with its own plan file and approval: payment and shipping provider interfaces and the first Ukrainian providers (LiqPay, WayForPay, Monobank, Nova Poshta; orders are marked paid by hand until then), email delivery (password reset, email verification, order mails), the pricing pipeline (discounts, shipping cost, tax; TDD for all money logic), the storefront and admin screens for cart, checkout, accounts and orders. Known follow-ups: rate limiting for the catalog routes of `/store/*` (needs a dependency), auth follow-ups (audit log, two-factor, shared login throttle, `trust proxy`) listed in the auth plan outcome.
4. Production: API/worker images, gate Swagger UI, Playwright e2e, branch protection on `main` with the CI checks required, pin GitHub Actions by commit SHA.
