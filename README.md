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

Scaffold complete (plan `docs/plans/2026-10-14-monorepo-scaffold.md`). Catalog plan (`docs/plans/2026-10-14-catalog.md`): complete. Admin auth plan (`docs/plans/2026-10-16-auth-and-roles.md`): steps 1 to 4 done, step 5 (independent review) pending. Pricing and inventory plan (`docs/plans/2026-10-16-pricing-and-inventory.md`): steps 1 to 6 done, step 7 (independent review) pending.
**Not built yet**: the storefront login screens, search indexing, checkout and orders. What exists and works:

- API: `GET /health`, Swagger UI at `/docs`, OpenAPI export, feature loader (sample feature `example`), Drizzle migrations (`0000_health_check`, `0001_catalog`, `0002_admin_auth`, `0003_pricing_inventory`, `0004_cart_customers_orders`), BullMQ and Meilisearch spikes.
- Catalog: admin write API under `/admin` (attributes, options, product types, brands, categories, products, variants; protected by sign-in and roles) and public read API under `/store` (categories, product list and detail; locales `uk` and `en`), ProductType presets and demo data (`pnpm seed`). Endpoints and errors: `docs/api/catalog.md`.
- Prices and stock: one price per variant and currency (plus an optional old price), per-variant stock levels with an append-only journal, a reservation service for the future checkout (no HTTP route), and public store fields `price` and `availability` (`in_stock`, `low_stock`, `out_of_stock`; never quantities) plus `GET /store/config`. Settings: `SHOP_CURRENCY` (default `UAH`; an active variant needs a price in it), `PRICES_INCLUDE_TAX` (default `true`, a display flag only, no tax is calculated) and `LOW_STOCK_THRESHOLD` (default `5`), see `.env.example` and `docs/contracts/config.md`. Endpoints: `docs/api/pricing.md` and `docs/api/inventory.md`. `pnpm seed` gives every demo variant a price and a stock level that shows each availability state, but only for products it creates: it never prices or stocks a product that already exists, so on a database seeded before prices existed the store stays empty until the variants are priced (bulk price endpoint). Changing `SHOP_CURRENCY` after data exists hides every live product without a price in the new currency; price them first.
- Admin authentication: cookie sessions, roles `owner`, `manager`, `viewer`, owner-only user management, first owner through `pnpm admin:create` (see Admin sign-in below). Endpoints: `docs/api/auth.md`; contract: `docs/contracts/api.md`.
- Customer accounts (`/store/account/*`: register, login, logout, profile, change password; separate cookie session, CSRF header on every `/store` write, lockout, rate limits) and admin customer management (`/admin/customers`, permissions `customers.read` and `customers.write`); no password reset or email verification yet: `docs/api/customers.md`.
- Cart (`/store/cart/*`: add, change, remove, acknowledge, delete): guest carts by cookie (`fluxkit_cart`, `CART_TTL_DAYS`) and one cart per signed-in customer, always repriced with the current catalog prices and notices (`price_changed`, `unavailable`, `out_of_stock`), no stock held, server-side totals, and the guest cart merged into the customer's at login and registration (`cartNotices`): `docs/api/cart.md`. Checkout and orders are the next steps.
- Storefront (`/uk`, `/en`) and admin: placeholder pages built from the shared UI and tokens (light and dark themes).
- CI on GitHub Actions: lint, types, boundaries, tests on real Postgres 17 / Redis 8 / Meilisearch, feature on/off/deleted matrix, license and audit policy, docs-with-code check, Compose smoke test.

Open decisions and next steps are listed at the end.

## Quick start

Prerequisites: Node 22 (`.nvmrc`), pnpm 10.28 (`corepack enable`), Docker with Compose.

```bash
pnpm install
cp .env.example .env     # edit values; never commit .env
                         # keep the passwords inside DATABASE_URL and REDIS_URL equal to POSTGRES_PASSWORD and REDIS_PASSWORD
                         # if ports 5432, 6379 or 7700 are taken, change POSTGRES_PORT, REDIS_PORT, MEILI_PORT and the URLs too

# Postgres, Redis, Meilisearch
docker compose --env-file .env -f infra/docker-compose.yml up -d --wait

# Tests drop schema objects, so they need a separate database whose name ends in _test
docker compose --env-file .env -f infra/docker-compose.yml exec postgres createdb -U fluxkit fluxkit_test

pnpm build
pnpm db:migrate                         # applies the pending migrations to DATABASE_URL (forward only, safe to repeat), see Database migrations
pnpm seed                               # optional: demo catalog (needs a migrated database, see seeds/README.md)
pnpm admin:create --email you@example.com   # first owner (needs a migrated database); asks for the password, see Admin sign-in
pnpm --filter @fluxkit/api start        # API on PORT (default 3000); try /health and /docs
pnpm --filter @fluxkit/storefront dev -p 3001   # http://localhost:3001/uk (the API already uses 3000)
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

## Database migrations

```bash
pnpm db:migrate     # = pnpm build && pnpm --filter @fluxkit/api db:migrate (node dist/database/migrate.js)
```

- Applies every pending migration of `apps/api/drizzle/` to `DATABASE_URL` (from `.env`) in journal order, with the Drizzle migrator. It prints the database name (never the user, password or host), then the applied migrations (`0000_health_check`, ...) or `Database is up to date (N migrations)`. Running it again applies nothing.
- It takes no arguments: anything after the script name reaches the command as it is and is rejected (do not add `--`). Exit code 1 means nothing was applied or the failed migration was rolled back by the migrator (all pending migrations run in one transaction); the error is printed in full, with connection strings and passwords removed.
- Forward only: this command never rolls back, drops or deletes. A rollback is manual: run the hand-written `apps/api/drizzle/NNNN_name.down.sql` of the newest migration against the database (see `docs/HANDOFF.md`, schema changes).
- Safe for production and for several instances starting together: a Postgres advisory lock (key `7426002`) lets one instance migrate while the others wait and then find nothing to do. If the database holds a migration newer than every entry of the journal (the code is older than the database), the command refuses with exit code 1 and changes nothing.
- Not for the `_test` database that `pnpm test` uses: the tests migrate it themselves.

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
| `manager` | read, write and publish the catalog |
| `viewer` | read the catalog |

More users: an owner calls `POST /admin/users` with `{email, role, password}` (and `PATCH /admin/users/{id}` to change a role or deactivate, `POST /admin/users/{id}/reset-password` to set a new password). There is no self-service password reset by email yet.
If every owner is locked out or has lost the password, create a new owner with `pnpm admin:create`; the command works against the database directly and needs no existing session.

**An owner is locked** (5 wrong passwords lock an account for 15 minutes, by design; see ADR 0010)? Pick one:

- wait 15 minutes;
- another owner calls `POST /admin/users/{id}/reset-password` (it also clears the lock and ends the user's sessions);
- run `pnpm admin:unlock --email owner@example.com` on the server. It sets the failed-login counter to 0 and removes the lock, nothing else (no password, role, active flag or session is touched), and prints `Unlocked owner@example.com` (or `owner@example.com was not locked`). An unknown email exits with code 1. Like `admin:create` it reads `DATABASE_URL` from `.env` and needs no session.

Enable optional features with `FEATURES_ENABLED=example` (comma-separated) in `.env`; see `docs/contracts/config.md`.

## Scripts (root)

| Script | What it does |
|---|---|
| `pnpm build` / `pnpm typecheck` | Turborepo build and type check of every package |
| `pnpm lint` / `pnpm format:check` (`pnpm format`) | ESLint (bans `any`, `@ts-ignore`, empty `catch`) / Prettier |
| `pnpm check:boundaries` | module boundary rules (core must not import features, etc.); fails if nothing was checked |
| `pnpm test` | builds, then runs Vitest in every package (needs the services above) |
| `pnpm seed` | builds, then seeds the demo catalog through the admin services (idempotent, refuses `NODE_ENV=production`) |
| `pnpm admin:create --email <address> [--role <role>]` | builds, then creates one admin user (default role `owner`); password from `ADMIN_PASSWORD` or a prompt; never updates an existing user |
| `pnpm admin:unlock --email <address>` | builds, then clears the failed-login counter and the lock of one admin user (nothing else changes); see Admin sign-in |
| `pnpm openapi:export` | regenerates `docs/api/openapi.json` (a test fails when it is stale) |
| `pnpm check:licenses` / `pnpm audit:prod` / `pnpm notices` | license policy, production audit, third-party notices file |
| `pnpm check:docs` | docs-with-code rules against `origin/main` |
| `pnpm feature-matrix on\|off\|deleted` | feature enable/disable/delete verification (`deleted` removes files, CI only) |

## Repository layout

```
apps/api            NestJS API (REST + OpenAPI)
apps/storefront     Next.js storefront (App Router, Tailwind, tokens, uk/en)
apps/admin          React + Vite admin
packages/core       catalog domain rules, pure TypeScript (pricing and the rest not yet)
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
- `docs/adr/`: decisions: 0001 own core, 0002 stack, 0003 tooling, 0004 data model, 0005 search notes, 0006 catalog schema, 0007 and 0008 catalog rules, 0009 and 0010 admin authentication, 0011 and 0012 money, stock and the pricing schema (index with status in `docs/adr/README.md`).
- `docs/contracts/`: public contracts under SemVer (config and feature flags, design tokens, API).
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
2. Independent review of the pricing and inventory plan (step 7) and of the auth plan (step 5), then the next domain plans: cart and checkout (it will use the reservation service), orders; the pricing pipeline (discounts, tax) is a later plan (TDD for all money logic). Known follow-ups: rate limiting for `/store/*` (needs a dependency), auth follow-ups (audit log, two-factor, password reset by email, shared login throttle, `trust proxy`) listed in the auth plan outcome.
3. Payment and shipping provider interfaces and the first Ukrainian providers (LiqPay, WayForPay, Monobank, Nova Poshta).
4. Production: API/worker images, gate Swagger UI, Playwright e2e, branch protection on `main` with the CI checks required, pin GitHub Actions by commit SHA.
