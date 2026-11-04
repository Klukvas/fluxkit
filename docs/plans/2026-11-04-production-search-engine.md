# Production Compose: add Meilisearch (2026-11-04)

## Goal
`infra/docker-compose.prod.yml` runs the search engine so a live shop has catalog search (ADR 0034), and `docs/deployment.md` stops saying Redis and Meilisearch are absent. Without the engine the storefront falls back to SQL listing and the search box is off.

## Found (existing functionality)
- Dev stack `infra/docker-compose.yml` already has `meilisearch:v1.55.0` and `redis:8-alpine`; README "Catalog search" documents the scoped key (`POST /keys`), `MEILI_ENV=production`, master key >= 16 bytes, `MEILI_URL` https or private (a single label such as `meilisearch` counts as private).
- `SEARCH_ENABLED` is false in code; true needs `MEILI_URL` and `MEILI_API_KEY` at API start (config validation), so the key must exist before search is switched on.
- Redis: `REDIS_URL` is only parsed (`packages/config/src/env.ts`); no running code reads `redisUrl`, `ioredis` or `bullmq` outside spikes/specs (grep, 2026-11-04). Same finding as `docs/plans/2026-10-29-production-deploy.md`.

## Decision (flagged to the owner)
- Add **Meilisearch**. Do **not** add Redis: nothing uses it, it would be an unused AGPL service (legal exception exists, but no reason to run it) and extra memory and attack surface. Add it with the queue / shared-rate-limit plan.

## Changes
- `infra/docker-compose.prod.yml`: `meilisearch` service (pinned v1.55.0, `MEILI_ENV=production`, master key from the env file, no analytics, named volume `meili-data`, no published port, healthcheck, hardening); `api` waits for it to be healthy; `MEILI_URL=http://meilisearch:7700` fixed by the topology.
- `infra/production.env.example`: `MEILI_MASTER_KEY`, `SEARCH_ENABLED`, `MEILI_API_KEY`, optional `MEILI_INDEX_PREFIX`.
- `docs/deployment.md`: topology, first-start order (engine up, create scoped key, enable search), backups (the index is rebuilt from Postgres), checklist, honest "not verified" list.
- `scripts/deploy-smoke.sh`: start the engine, create the scoped key, enable search, check `/store/config` and `/store/search`.
- CHANGELOG, HANDOFF, `docs/files` if infra is listed.

## Risks
- No Docker daemon in the agent sandbox: the compose file is checked with `docker compose config` only; the real start (read-only root, caps dropped for Meilisearch) is verified by the CI job `deploy-smoke`. Not yet run on a real host.
- The API container receives the whole env file, including `MEILI_MASTER_KEY` (same as `POSTGRES_PASSWORD` today); the API never reads it.

## Verification
`docker compose config` (syntax), `pnpm check:env`, `pnpm check:docs`, prettier, CI `deploy-smoke`.
