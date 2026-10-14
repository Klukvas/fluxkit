# 0002. Technology stack

Status: accepted (versions and tooling to be fixed when scaffolding)

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript | One language and shared types/schemas across API, storefront, admin; agent-friendly |
| Backend | NestJS | Modules, DI, events; fits "feature = module with a flag" |
| Public API | REST + OpenAPI | Easy for third-party integrations, typed client generation, contract checks in CI |
| DB / ORM | PostgreSQL + Drizzle | JSONB, row locks for stock, transparent SQL and migrations |
| Search | Meilisearch | Facets, counts, typo tolerance, suggestions; fed from Postgres |
| Queues / cache | Redis + BullMQ | Email, indexing, webhooks, abandoned carts |
| Storefront | Next.js (App Router) + Tailwind, CSS-variable tokens | SSR/SEO, themeable by one tokens file |
| Admin | React SPA (Vite), shared UI library | No SEO need; forms generated from attribute metadata |
| Deploy | Docker Compose | One-command setup for clients and CI |

## To verify before locking
- Licenses: checked in `docs/dependencies.md`. Redis 8+ is used under AGPLv3 as an unmodified external service (legal OK, see AGENTS.md section 16). Transitive dependency licenses are enforced by CI.
- Package manager, test runner, lint tooling, CI provider.
- Meilisearch Ukrainian-language behavior (morphology) on real data.
