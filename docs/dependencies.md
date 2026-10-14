# Dependencies and licenses

Checked on 2026-10-14. npm package data comes from `npm view` (registry metadata). Allowlist: MIT, Apache-2.0, BSD-2/3, ISC, 0BSD, CC0
(AGENTS.md section 16). Versions are the registry "latest" at check time; exact pins are set when the lockfile is created (step 2).

## npm packages (direct, planned)

| Package | Latest seen | License | Verdict |
|---|---|---|---|
| @nestjs/core, @nestjs/common | 12.1.3 | MIT | OK |
| @nestjs/swagger | 12.0.2 | MIT | OK |
| drizzle-orm | 0.45.4 | Apache-2.0 | OK |
| drizzle-kit | 0.31.11 | MIT | OK |
| pg | 8.23.1 | MIT | OK (chosen Postgres driver) |
| postgres (postgres.js) | 3.4.9 | Unlicense | NOT on allowlist: do not use; needs approval if wanted |
| next | 16.4.1 | MIT | OK |
| react, react-dom | 19.3.1 | MIT | OK |
| tailwindcss | 4.3.3 | MIT | OK |
| vite | 8.3.4 | MIT | OK |
| @vitejs/plugin-react | 6.1.2 | MIT | OK |
| vitest | 5.0.4 | MIT | OK |
| @playwright/test | 1.64.1 | Apache-2.0 | OK (browser binaries are downloaded separately, licenses to review before bundling) |
| eslint | 10.12.0 | MIT | OK |
| typescript-eslint | 8.71.2 | MIT | OK |
| prettier | 3.9.10 | MIT | OK |
| dependency-cruiser | 18.6.0 | MIT | OK |
| turbo | 2.11.8 | MIT | OK |
| bullmq | 6.3.15 | MIT | OK |
| ioredis | 6.0.0 | MIT | OK |
| meilisearch (JS client) | 0.62.0 | MIT | OK |
| typescript | 7.0.2 | Apache-2.0 | OK |
| zod | 4.6.7 | MIT | OK |
| @swc/core | 1.16.18 | Apache-2.0 | OK |
| unplugin-swc | 2.0.0 | MIT | OK |
| testcontainers, @testcontainers/postgresql | 12.2.1 | MIT | OK (needs a Docker daemon; see environment) |

Transitive dependencies are NOT checked here. CI must run a license check over the full tree (step 8) and fail on anything outside the allowlist.

## Services (run via Docker Compose, not linked into our code)

| Service | License | Verdict |
|---|---|---|
| PostgreSQL | PostgreSQL License (permissive, BSD/MIT-like) | OK |
| Meilisearch Community Edition | MIT ([repo](https://github.com/meilisearch/meilisearch)) | OK. Enterprise Edition features (e.g. sharding) are BUSL/commercial: do not enable or use them in the template |
| Redis 7.0.x and earlier (up to 7.2) | BSD-3 | Allowed but old |
| Redis 7.4+ | RSALv2 / SSPLv1 | NOT on allowlist |
| Redis 8+ | tri-licensed: RSALv2 / SSPLv1 / AGPLv3 ([news](https://www.phoronix.com/news/Redis-8.0-Goes-AGPLv3)) | NOT on allowlist (AGPL) |
| Valkey | BSD-3-Clause ([COPYING](https://raw.githubusercontent.com/valkey-io/valkey/unstable/COPYING)) | OK, protocol-compatible with Redis, works with ioredis and BullMQ |

## Decision needed (red zone)
Redis current releases fail the allowlist. Proposal: use **Valkey** in `infra/docker-compose.yml` instead of Redis. Client code (ioredis, BullMQ) is unchanged.
Not yet verified: BullMQ compatibility with Valkey in practice (to be covered by an integration test in step 5).

## Environment findings (this agent container)
- Docker CLI 29.8.2 is installed but the daemon is NOT running (`/var/run/docker.sock` missing). Docker Compose and Testcontainers cannot run here.
- Local binaries exist: PostgreSQL 16.15 client tools (`psql`, `pg_ctlcluster`) and Redis server 7.0.15 (BSD-3 era). Meilisearch is not installed.
- Consequence: integration tests that need services can use locally started Postgres/Redis in this container, but the source of truth is CI
  (GitHub Actions service containers). Meilisearch prototype (step 6) needs the binary downloaded; its availability through the network proxy is untested.
- Node v22.22.0, pnpm 10.28.0, npm 10.9.4.
