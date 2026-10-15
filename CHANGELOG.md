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
