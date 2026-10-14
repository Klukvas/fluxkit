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
| Redis 7.4 - 7.x | RSALv2 / SSPLv1 | Not used (skip straight to 8+ under AGPLv3) |
| Redis 8+ | tri-licensed: RSALv2 / SSPLv1 / AGPLv3 ([news](https://www.phoronix.com/news/Redis-8.0-Goes-AGPLv3)) | APPROVED exception: use under AGPLv3, unmodified, as a separate service (legal OK from owner's lawyer) |
| Valkey | BSD-3-Clause ([COPYING](https://raw.githubusercontent.com/valkey-io/valkey/unstable/COPYING)) | OK; fallback option, protocol-compatible with Redis |

## Decision (resolved 2026-10-14)
Use the **latest Redis (8+) under the AGPLv3 option**. The owner confirmed legal approval from their lawyer.
Conditions: Redis is run unmodified as a separate service (Docker image), never forked or patched; our code talks to it over the network
via ioredis/BullMQ. AGENTS.md section 16 now distinguishes code dependencies (strict allowlist) from external services (explicit decision here).
Valkey (BSD-3) stays a known fallback if legal or client requirements change; no code change is needed to switch.

## Environment findings (this agent container)
- Docker CLI 29.8.2 is installed but the daemon is NOT running (`/var/run/docker.sock` missing). Docker Compose and Testcontainers cannot run here.
- Local binaries exist: PostgreSQL 16.15 client tools (`psql`, `pg_ctlcluster`) and Redis server 7.0.15 (BSD-3 era). Meilisearch is not installed.
- Consequence: integration tests that need services can use locally started Postgres/Redis in this container, but the source of truth is CI
  (GitHub Actions service containers). Meilisearch prototype (step 6) needs the binary downloaded; its availability through the network proxy is untested.
- Node v22.22.0, pnpm 10.28.0, npm 10.9.4.

## Known blocker: TypeScript 7 vs linters (found in plan step 3, 2026-10-14)
- `typescript-eslint` 8.71.2 (also the canary) throws "does not support TS 7.0"; supported range is `>=4.8.4 <6.1.0`.
- `dependency-cruiser` 18.6.0 supports TypeScript `<7.0.0` and, with TS 7, silently cruises 0 modules (false pass).
- Verified in a scratch copy with `typescript@6.0.3`: typecheck/build pass, ESLint and dependency-cruiser rules all fire on deliberate violations.
- Waiting for the owner's decision on the TypeScript pin. Lint config files are committed as WIP; no `lint` / `check:boundaries` scripts exist yet on purpose.
