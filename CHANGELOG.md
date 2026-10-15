# Changelog

One line per user-visible or schema change.

## Unreleased
- Add pnpm + Turborepo workspace skeleton with empty apps and packages (`build`, `typecheck`).
- Add dependency license table and Redis 8 (AGPLv3, external service) approval.
- Add Docker Compose stack (Postgres 17, Redis 8, Meilisearch v1.55.0) and `.env.example` variables.
- Add ESLint, Prettier and dependency-cruiser checks (`lint`, `format:check`, `check:boundaries`); pin TypeScript to 6.0.3.
- Add NestJS API spike: `GET /health`, Drizzle migration with down script, OpenAPI export, feature flag loader with example feature, BullMQ spike; `pnpm test` and `pnpm openapi:export`.
- Approve MPL-2.0, Python-2.0, BlueOak-1.0.0 and Apache-2.0 AND MIT for development tooling only.
- Add Meilisearch spike tests and search findings (`docs/adr/0005-search-notes.md`).
- Add storefront (Next.js) and admin (Vite) skeletons on a shared token-based UI library with `uk`/`en` i18n, design tokens (`light`/`dark`) and design-guard tests.
- Approve LGPL-3.0-or-later (unmodified sharp-libvips binaries) and CC-BY-4.0 (caniuse-lite) for specific cases.
- Add GitHub Actions CI (verify, feature matrix, licenses/audit/notices, docs check, compose), Dependabot, and the scripts behind them.
- Rewrite README with a verified quick start; add `pnpm --filter @fluxkit/api start`; refresh docs indexes, AGENTS.md consistency fixes; mark the scaffold plan completed.
- Add the catalog domain plan (`docs/plans/2026-10-14-catalog.md`).
- Add ADR 0006 (catalog schema), verified against real Postgres.
- ADR 0006 accepted: owner decisions on default locale, slug redirects, frozen options, requires_shipping, barcode.
- Add catalog database schema (16 tables, migration `0001_catalog` with down script, constraint tests on real Postgres) and a schema drift check (`pnpm --filter @fluxkit/api db:drift`, CI step).
- Add admin API foundation (default-deny `AdminGuard`, problem+json errors, zod validation, pagination, `DEFAULT_LOCALE`/`LOCALES` config) and `/admin/brands` CRUD as the reference resource.
- Add admin catalog dictionaries: `/admin/attributes` (+options), `/admin/options` (+values), `/admin/product-types` (+attribute and option assignments), with the ADR 0006 change rules.
- Add admin categories: `/admin/categories` CRUD (flat list, `?parentId`) and `POST /admin/categories/:id/move`, with depth limit 5, cycle rejection and a tree-wide advisory lock.
- Add admin products: `/admin/products` CRUD (creates a draft with its default variant), publish/unpublish/archive/restore with the core publish preconditions, and `PUT` of categories (one primary) and media; variants and options routes follow in 4d-2.
- Add admin product options and variants: `PUT /admin/products/:id/options`, `POST /admin/products/:id/options/:optionId/values` and `GET|POST /admin/products/:id/variants`, `POST .../variants/generate`, `GET|PATCH|DELETE .../variants/:variantId` (variants are generated with core rules, exactly one default, SKUs proposed with collision retry); completes the catalog admin write API.
- Add the public store read API (no auth, GET only): `GET /store/categories`, `GET /store/products` (`?category`, `?brand`, `?locale`, pagination), `GET /store/products/:slug`; locale-resolved texts, only active products/variants/categories, and attributes filtered centrally so internal and storefront-hidden ones never leave the API.
- Add `@fluxkit/seeds` (ProductType presets Clothing, Hand tool, Digital product; demo categories, brand and 8 products in `uk`/`en`) and `pnpm seed`, an idempotent runner that creates them through the admin services and refuses `NODE_ENV=production`.
- Add catalog documentation: endpoint reference `docs/api/catalog.md`, public contract notes `docs/contracts/api.md`, core file map `docs/files/core.md`, ADR index with status, and the catalog plan outcome (no code or OpenAPI change).
