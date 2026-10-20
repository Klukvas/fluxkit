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

Complete: the scaffold (`docs/plans/2026-10-14-monorepo-scaffold.md`), the catalog (`docs/plans/2026-10-14-catalog.md`), admin authentication (`docs/plans/2026-10-16-auth-and-roles.md`), pricing and inventory (`docs/plans/2026-10-16-pricing-and-inventory.md`), and the cart, customers and orders (`docs/plans/2026-10-17-cart-and-orders.md`, with its review fixes in `docs/plans/2026-10-18-cart-orders-review-fixes.md`, PRs #61 to #63).
Storefront v1 (`docs/plans/2026-10-18-storefront.md`): steps 1 to 10 merged (PRs #66 to #79; #78 is the step 9 docs sweep, #79 the step 10 review fixes).
Admin UI v1 (`docs/plans/2026-10-19-admin-ui.md`, ADR 0027): steps 1 to 11 merged (PRs #81 to #94); complete except the independent review (step 13) and the media upload (step 2b, own plan and ADR, not started). Step 12, the docs sweep, is pending.

**Not built yet**: payment and shipping providers (an admin marks an order paid by hand), email delivery (no password reset or email verification), search (no search index; the storefront has no search and no sort), image upload (the admin takes product and brand images as http(s) addresses only; the upload is the media plan, step 2b, not started), and a production deployment (no API or storefront image; the admin is static files that the edge proxy serves, see Deployment notes). The storefront takes NO payment: v1 is not for live sales until the payment plan (an unpaid order expires after `ORDER_PAYMENT_TTL_MINUTES`, 30 by default, unless an admin marks it paid). What exists and works:

- API: `GET /health`, Swagger UI at `/docs`, OpenAPI export, feature loader (sample feature `example`), Drizzle migrations (`0000_health_check`, `0001_catalog`, `0002_admin_auth`, `0003_pricing_inventory`, `0004_cart_customers_orders`), BullMQ and Meilisearch spikes.
- Catalog: admin write API under `/admin` (attributes, options, product types, brands, categories, products, variants; protected by sign-in and roles) and public read API under `/store` (categories, product list and detail; locales `uk` and `en`), ProductType presets and demo data (`pnpm seed`). Endpoints and errors: `docs/api/catalog.md`.
- Prices and stock: one price per variant and currency (plus an optional old price), per-variant stock levels with an append-only journal, a reservation service used by the checkout, the order service and the scheduler (no HTTP route), and public store fields `price` and `availability` (`in_stock`, `low_stock`, `out_of_stock`; never quantities) plus `GET /store/config`. Settings: `SHOP_CURRENCY` (default `UAH`; an active variant needs a price in it), `PRICES_INCLUDE_TAX` (default `true`, a display flag only, no tax is calculated) and `LOW_STOCK_THRESHOLD` (default `5`), see `.env.example` and `docs/contracts/config.md`. Endpoints: `docs/api/pricing.md` and `docs/api/inventory.md`. `pnpm seed` gives every demo variant a price and a stock level that shows each availability state, but only for products it creates: it never prices or stocks a product that already exists, so on a database seeded before prices existed the store stays empty until the variants are priced (bulk price endpoint). Changing `SHOP_CURRENCY` after data exists hides every live product without a price in the new currency; price them first.
- Admin authentication: cookie sessions, roles `owner`, `manager`, `viewer`, owner-only user management, first owner through `pnpm admin:create` (see Admin sign-in below). Endpoints: `docs/api/auth.md`; contract: `docs/contracts/api.md`.
- Customer accounts (`/store/account/*`: register, login, logout, profile, change password; separate cookie session, CSRF header on every `/store` write, lockout, rate limits) and admin customer management (`/admin/customers`, permissions `customers.read` and `customers.write`); no password reset or email verification yet: `docs/api/customers.md`.
- Cart (`/store/cart/*`: add, change, remove, acknowledge, delete): guest carts by cookie (`fluxkit_cart`, `CART_TTL_DAYS`) and one cart per signed-in customer, always repriced with the current catalog prices and notices (`price_changed`, `unavailable`, `out_of_stock`), no stock held, server-side totals, and the guest cart merged into the customer's at login and registration (`cartNotices`): `docs/api/cart.md`.
- Checkout and orders (`POST /store/checkout`, `/store/orders/lookup|cancel`, `/store/account/orders`): one transaction reserves the stock of every line (all or nothing, 30 minutes by default: `ORDER_PAYMENT_TTL_MINUTES`), stores an immutable snapshot with server-side totals and empties the cart; an `Idempotency-Key` makes a retry safe; guests get an access token (`ORDER_GUEST_ACCESS_DAYS`; derived from the order and the idempotency key with `ORDER_TOKEN_SECRET`, so a double submit returns the same token; at most `MAX_OPEN_ORDERS` unpaid orders per email or customer), customers see their history; unpaid orders can be cancelled by their owner. Admins list, read, cancel, mark paid and mark fulfilled orders (`/admin/orders`, permissions `orders.read` and `orders.write`; not the viewer), and plugins read an order through the `OrderReadPort`. Payment and shipping providers are the next steps: `docs/api/orders.md`, `docs/contracts/events.md`. Unpaid orders expire by themselves: the scheduler (see Scheduler and jobs below).
- Storefront (`/uk`, `/en`; plan `docs/plans/2026-10-18-storefront.md`, steps 1 to 8 merged): home, catalog and category pages (brand filter, paging), product page with variants, cart, guest and customer checkout, the guest order page (private link) and the customer's order history, sign-in, registration and profile. Rendering and the same-origin rule: ADR 0026 and `apps/storefront/README.md`; the walkthrough is below. Playwright tests of the purchase flow (`pnpm test:e2e`, 23 tests in 12 files; `apps/storefront/e2e/README.md`).
- Admin: the SPA under `/admin-ui/` (plan `docs/plans/2026-10-19-admin-ui.md`, steps 1 to 11 merged; images are http(s) addresses until the media upload, step 2b): sign-in, re-sign-in dialog, navigation by role, own account, uk/en; the catalog dictionaries (attributes, options, product types, brands, category tree); products (list, create, the editor with general fields, generated attributes, categories, media, options, variants, prices, stock and the lifecycle); orders (list, detail, mark paid, mark fulfilled, cancel); customers (deactivate, activate, unlock); admin users (owner only). Details in `apps/admin/README.md`. Playwright tests of the admin flows (`pnpm test:e2e` runs them after the storefront's, 17 tests in 10 files; `apps/admin/e2e/README.md`).
- CI on GitHub Actions: lint, types, boundaries, tests on real Postgres 17 / Redis 8 / Meilisearch, feature on/off/deleted matrix, license and audit policy, docs-with-code check, Compose smoke test, and the Playwright `e2e` job (the storefront suite, then the admin suite).

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
pnpm --filter @fluxkit/admin dev                # the admin SPA: http://localhost:5173/admin-ui/ (apps/admin/README.md)
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

The browser tests (Playwright, Chromium) are separate and slower: `pnpm test:e2e` builds once, then runs the storefront suite (the API, the storefront and a same-origin proxy; the purchase flow) and after it the admin suite (the API and a proxy that serves the built admin SPA under `/admin-ui`; sign-in, roles, catalog, products, orders, customers, users, headers and CSP, keyboard use); the first failing suite stops the run. They need one more database whose name ends in `_e2e_test` (each suite wipes it at its start) and the Chromium download; the step-by-step is in `apps/storefront/e2e/README.md` and `apps/admin/e2e/README.md`.

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

The store rate limits (checkout, registration, login, order lookup, guest cancel, cart writes) and the admin login limit count requests per client address (`request.ip`). The API trusts no proxy by default (`TRUST_PROXY=0`), so the address is the one that connects to it. Behind a reverse proxy or a CDN that address is the proxy's, and every shopper then shares ONE window: the whole shop would get, for example, 10 checkouts per 10 minutes. The catalog reads (`GET /store/products`, categories, config) are not rate limited, so the Next.js server's own catalog reads (through `API_INTERNAL_URL`) do not count against any window.

- Set `TRUST_PROXY` to the **exact number of proxies** between the internet and the API (`1` for one edge proxy such as Caddy or nginx, `2` for a CDN plus nginx, and so on; 0 to 10). Each of them must set `X-Forwarded-For` to the address it saw, or append that address to the value it received (the examples below set it, which is the stricter choice). The Next.js server is not one of these hops for `/store/*`: in a deployment the edge proxy routes `/store/*` straight to the API, and the Next.js rewrite of development forwards the browser's own header unchanged (ADR 0026).
- **Too high is a security hole:** the extra hops are read from the part of `X-Forwarded-For` the client controls, so a client can invent its address and dodge every limit. **Too low** keeps the shop-wide window. Check it after a deployment: from two different networks, a request to a limited route must be counted separately.
- Keep the API reachable only through the proxy when `TRUST_PROXY` is above 0; otherwise anyone who can reach it directly can send the header themselves.
- IPv6 clients are counted per /64 prefix after this step too. The counters are in memory per API process (ADR 0009, ADR 0016).

### Example edge proxy: the API, the admin SPA and the storefront

These examples are **not tested in this repository**: neither Caddy nor nginx is installed in the build sandbox, and no Docker daemon was running. The routing that the suites test is in the two e2e proxies: `apps/storefront/e2e/proxy.ts` (`/store/*` and `/admin/*` to the API, everything else to the storefront, `X-Forwarded-For` set the same way) and `apps/admin/e2e/proxy.ts` (`/admin-ui` and `/admin-ui/*` from the built SPA with the `index.html` fallback and the headers of `apps/admin/security-headers.ts`; `/admin/*` and `/store/*` to the API). The `/admin-ui` blocks below follow the rules of `apps/admin/e2e/proxy.ts`. They are **untested** here: check the directives against your proxy's version before you rely on them.

Matching settings: the API runs with `TRUST_PROXY=1`; `ADMIN_COOKIE_SECURE` and `STORE_COOKIE_SECURE` stay `true` (HTTPS); the storefront has `API_INTERNAL_URL=http://127.0.0.1:3000` and `STOREFRONT_PUBLIC_URL=https://shop.example.com`; `STOREFRONT_IMAGE_HOSTS` has the same value for `next build` and `next start`, and the same hosts go into the admin's `img-src` (a static SPA reads no runtime configuration, so the proxy header carries them; see `apps/admin/README.md`). The API (port 3000) and the storefront (port 3001) listen on loopback or a private network, so only the proxy is public.

The admin SPA is static (ADR 0027): `pnpm --filter @fluxkit/admin build` writes `apps/admin/dist`, which the proxy serves under `/admin-ui` on the same host. The API never serves it, and the build never calls the API. The proxy must:

- serve both `/admin-ui` and `/admin-ui/*` (the router writes the start page without a trailing slash);
- answer a SPA path that is no file with `index.html` (deep links and reloads);
- send the headers below on every `/admin-ui` response, `Cache-Control: no-cache` on `index.html` and `public, max-age=31536000, immutable` on `/admin-ui/assets/*`.

Headers, from `apps/admin/security-headers.ts` (the CSP shown has no image hosts; add `https://<host>` to `img-src` for each `STOREFRONT_IMAGE_HOSTS` entry):

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |

HSTS is set by the TLS proxy, as for the storefront.

Caddy 2 (`Caddyfile`):

```
(admin_security) {
	header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
	header X-Frame-Options DENY
	header X-Content-Type-Options nosniff
	header Referrer-Policy no-referrer
	header Permissions-Policy "camera=(), microphone=(), geolocation=()"
	header Cross-Origin-Opener-Policy same-origin
}

shop.example.com {
	@api path /store/* /admin/*
	handle @api {
		# Caddy sets X-Forwarded-For to the address it saw. Since Caddy 2.5 a value sent by an untrusted client is replaced,
		# not extended. Do NOT configure `trusted_proxies` for this site and do NOT delete the header with `header_up`:
		# removing it would leave the API with no client address and bring back the shop-wide window.
		reverse_proxy 127.0.0.1:3000
	}

	# The admin SPA (apps/admin/dist). The start page is /admin-ui without a slash: it is served like /admin-ui/.
	@adminStart path /admin-ui
	rewrite @adminStart /admin-ui/

	# Hashed assets: a missing file is a 404, never the HTML.
	@adminAssets path /admin-ui/assets/*
	handle @adminAssets {
		import admin_security
		header Cache-Control "public, max-age=31536000, immutable"
		uri strip_prefix /admin-ui
		root * /srv/fluxkit/apps/admin/dist
		file_server
	}

	# Every other SPA path: index.html (deep links and reloads).
	@adminPages path /admin-ui /admin-ui/*
	handle @adminPages {
		import admin_security
		header Cache-Control no-cache
		uri strip_prefix /admin-ui
		root * /srv/fluxkit/apps/admin/dist
		try_files {path} /index.html
		file_server
	}

	handle {
		reverse_proxy 127.0.0.1:3001
	}
}
```

nginx (`server` block; the TLS directives are not shown):

```
server {
    listen 443 ssl;
    server_name shop.example.com;
    # ssl_certificate and ssl_certificate_key: your certificate

    # The API: /store/* (shop) and /admin/* (admin API). proxy_set_header replaces any value the client sent.
    location ~ ^/(store|admin)/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # The admin SPA (apps/admin/dist). Hashed assets first: a missing file is a 404, never the HTML.
    location ~ ^/admin-ui/assets/ {
        rewrite ^/admin-ui/(.*)$ /$1 break;
        root /srv/fluxkit/apps/admin/dist;
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
        add_header Cross-Origin-Opener-Policy "same-origin" always;
    }

    # Every other /admin-ui path (the start page too): index.html for SPA paths, the file when there is one.
    location ~ ^/admin-ui(/|$) {
        rewrite ^/admin-ui/?(.*)$ /$1 break;
        root /srv/fluxkit/apps/admin/dist;
        try_files $uri /index.html;
        add_header Cache-Control "no-cache" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
        add_header Cross-Origin-Opener-Policy "same-origin" always;
    }

    # Everything else: the storefront (next start).
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

The `/admin-ui` blocks neither set nor change `X-Forwarded-For`; the API block is unchanged. The examples match `/store/*` and `/admin/*` only with a path after the prefix, so a bare `/admin` or `/store` reaches the storefront: the e2e proxies match them, the examples do not yet.

`MAX_OPEN_ORDERS` (default 3) separately caps the unpaid orders per guest email and per customer (ADR 0024); it does not depend on addresses.

## Admin sign-in

Every `/admin` route needs a signed-in user; the admin screens are the SPA under `/admin-ui/` on the same origin (`apps/admin/README.md`, ADR 0027). There is no sign-up and no default account: the first owner is created with the command line, then signs in with `POST /admin/auth/login` (`docs/api/auth.md`).

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
4. Start the storefront in development: `pnpm --filter @fluxkit/storefront dev -p 3001`. Its `next.config.ts` rewrites `/store/*` to `API_INTERNAL_URL` in `next dev` only, so the browser talks to ONE origin (the cookies have `Path=/store`, writes need `X-Fluxkit-CSRF`, the API sends no CORS headers). For `next start` (`pnpm --filter @fluxkit/storefront start -p 3001` after `pnpm build`) there is no rewrite: put a reverse proxy in front that sends `/store/*` to the API and everything else to Next, and that SETS `X-Forwarded-For` (Deployment notes, with example configurations). `next start` needs `API_INTERNAL_URL` and `STOREFRONT_PUBLIC_URL` (it runs with `NODE_ENV=production` unless that is set).
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
| `pnpm test:e2e` | builds, then runs the Playwright browser tests of the storefront and then of the admin (Chromium; needs the services above, a `*_e2e_test` database in `E2E_DATABASE_URL` that each suite wipes, and `playwright install chromium` once); not part of `pnpm test`, see `apps/storefront/e2e/README.md` and `apps/admin/e2e/README.md` |
| `pnpm db:migrate` | builds, then applies the pending migrations to `DATABASE_URL` (forward only, safe to repeat); see Database migrations |
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
apps/admin          React + Vite admin SPA, static, served under `/admin-ui` (ADR 0027)
packages/core       domain rules, pure TypeScript: catalog, money, pricing, stock, auth, cart and orders (shipping, discounts and tax not yet)
packages/features   optional feature modules (sample: _example)
packages/providers  payment and shipping provider plugins (none yet)
packages/ui         token-based components and i18n helpers
packages/theme      design tokens and their guard tests
packages/config     env parsing (API and storefront) and feature flags
packages/api-client typed store and admin API clients (hand-written types, checked against docs/api/openapi.json)
seeds/              demo data and ProductType presets (pure data)
infra/              Docker Compose for Postgres, Redis, Meilisearch
scripts/            CI and policy scripts
docs/               architecture decisions, contracts, API and file maps, plans
```

## Documentation map

- `AGENTS.md`: rules for all contributors and AI agents (architecture, workflow, security, CI). `CLAUDE.md` imports it.
- `docs/HANDOFF.md`: current state, next steps and working agreements; read it first when you pick up the project.
- `docs/adr/`: decisions: 0001 own core, 0002 stack, 0003 tooling, 0004 data model, 0005 search notes, 0006 catalog schema, 0007 and 0008 catalog rules, 0009 and 0010 admin authentication, 0011 and 0012 money, stock and the pricing schema, 0013 and 0014 stock history, 0015 to 0026: cart, customers, orders, the scheduler, the order schema, guest order tokens, the open-order limit and `TRUST_PROXY`, the outbox and bounded jobs, the storefront architecture; 0027: the admin UI architecture (index with status in `docs/adr/README.md`).
- `docs/contracts/`: public contracts under SemVer (config and feature flags, design tokens, API, domain events and order ports).
- `docs/api/`: endpoint notes and `openapi.json`. `docs/files/`: what each file and package is responsible for.
- `apps/storefront/README.md` (rendering, configuration, checks) and `apps/storefront/e2e/README.md` (browser tests): the storefront.
- `apps/admin/README.md` (run, headers, conventions) and `apps/admin/e2e/README.md` (browser tests): the admin SPA.
- `docs/dependencies.md`: licenses and decisions. `docs/plans/`: task plans. `docs/AGENT_WORKFLOW.md`: roles, models and decisions log.

## Working with AI agents

Rules and roles are in `AGENTS.md` and `docs/AGENT_WORKFLOW.md`: plan first, check for existing functionality, never mask failures, stop and ask in the red zones
(dependencies, migrations, public contracts, payments/auth, destructive actions), and have a different agent review every change.

## Licenses

Code dependencies follow the policy in `AGENTS.md` section 16 (`scripts/license-policy.json`). Redis 8 (AGPLv3) runs as an unmodified external service with legal sign-off.
Generate the third-party notices to ship with a delivery with `pnpm notices` (also produced by CI).

## Open decisions and next steps

1. Ukrainian search morphology and variant-level facet counts (`docs/adr/0005-search-notes.md`).
2. Admin UI step 13: an independent review by a different agent than the authors (permission gating against the API, XSS, CSRF and same-origin assumptions, the CSP of the build, open redirect in `next`, money and stock flows, the re-sign-in state, i18n, accessibility, the bundle split, mutation checks). Its findings are fixed before the admin plan closes (`docs/plans/2026-10-19-admin-ui.md`). The known gaps are in `docs/HANDOFF.md`.
3. Next plans, each with its own plan file and owner approval: payment providers and the first Ukrainian providers (LiqPay, WayForPay, Monobank, Nova Poshta; orders are marked paid by hand until then), shipping providers, email delivery (password reset, email verification, order mails), search indexing (blocked by item 1), the pricing pipeline (discounts, shipping cost, tax; TDD for all money logic), the admin media upload (step 2b: storage, upload endpoint, its own ADR), and a privacy plan before the EU launch. Known follow-ups without a plan yet: rate limiting for the catalog routes of `/store/*` (needs a dependency), the auth follow-ups in the auth plan outcome, and the cart, customers and orders follow-ups in `docs/HANDOFF.md`.
4. Production: API and storefront images (the admin is static files, no image in v1); the edge proxy in front of the API, the admin SPA and the storefront (the examples in Deployment notes are not tested here); gate Swagger UI; branch protection on `main` with the CI checks required; pin GitHub Actions by commit SHA. The browser tests exist for the storefront and the admin (`pnpm test:e2e`, CI job `e2e`); `@axe-core/playwright` is not approved.
5. `AGENTS.md` (the owner's file) does not yet list `pnpm test:e2e` (which now runs the storefront and the admin suites), `pnpm jobs:run-once`, the CI job `e2e` (both suites) or the scheduler variables; the owner adds them (`docs/HANDOFF.md`).
