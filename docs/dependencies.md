# Dependencies and licenses

Checked on 2026-10-14. npm package data comes from `npm view` (registry metadata). Allowlist: MIT, Apache-2.0, BSD-2/3, ISC, 0BSD, CC0
(AGENTS.md section 16). Versions are the registry "latest" at check time; exact pins are set when the lockfile is created (step 2).

## npm packages (direct, planned)

| Package | Latest seen | License | Verdict |
|---|---|---|---|
| @nestjs/core, @nestjs/common | 12.1.3 | MIT | OK |
| @nestjs/swagger | 12.0.2 | MIT | OK (runtime; pulls swagger-ui-dist -> @scarf/scarf, see below) |
| @nestjs/platform-express | 12.1.3 | MIT | OK |
| @nestjs/testing | 12.1.3 | MIT | OK (dev) |
| reflect-metadata | 0.2.2 | Apache-2.0 | OK |
| rxjs | 7.8.2 | Apache-2.0 | OK |
| @types/node | 26.6.5 | MIT | OK (dev) |
| @types/pg | 8.23.1 | MIT | OK (dev) |
| @types/express | 5.0.6 | MIT | OK (dev) |
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
| typescript | 6.0.3 (pinned; 7.0.2 is latest but unsupported by linters) | Apache-2.0 | OK |
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

## Resolved: TypeScript 7 vs linters (2026-10-14)
- `typescript-eslint` 8.71.2 (also the canary) throws "does not support TS 7.0"; supported range is `>=4.8.4 <6.1.0`.
- `dependency-cruiser` 18.6.0 supports TypeScript `<7.0.0`; with TS 7 it silently cruised 0 modules (false pass).
- Decision (owner): pin TypeScript to **6.0.3** everywhere. Verified: typecheck, build, lint, boundary check pass, and every rule fails on deliberate violations.
- `scripts/check-boundaries.mjs` additionally fails if zero modules are cruised, so this failure mode cannot pass silently again.
- Revisit TS 7 when both tools support it.

## Transitive licenses (plan step 5, `pnpm licenses list`, 2026-10-14)
Counts across the install tree: MIT 269, Apache-2.0 25, ISC 15, BSD-2-Clause 6, BSD-3-Clause 5, 0BSD 1, plus the exceptions below.

Outside the strict allowlist. DECISION (owner, 2026-10-14): approved for development tooling only (devDependencies); runtime dependencies keep the strict list:
| License | Packages | Where | Note |
|---|---|---|---|
| Apache-2.0 AND MIT | @swc/core-linux-x64-gnu, -musl | devDependency (tests) | both parts are allowed; combined expression only |
| MPL-2.0 | lightningcss (+ platform binaries) | devDependency (vite via vitest) | file-level copyleft, unmodified, build/test tooling only, not shipped |
| Python-2.0 | argparse | devDependency (eslint) | permissive, PSF-style |
| BlueOak-1.0.0 | minimatch | devDependency (eslint tooling) | permissive |

Install scripts: `@scarf/scarf` (analytics/telemetry, pulled in by `@nestjs/swagger` -> `swagger-ui-dist`, a RUNTIME dependency of the API) has its install script
blocked (pnpm blocks dependency scripts by default and `pnpm-workspace.yaml` lists it explicitly). Never approve it. `@swc/core` and `msgpackr-extract` scripts are not needed either.

Plan step 5 added the NestJS packages, Drizzle, pg, BullMQ, ioredis, zod, vitest, unplugin-swc, @swc/core and the types above; all are in the table.

## Added in plan step 7 (frontends)
next 16.4.1, react / react-dom 19.3.1, tailwindcss + @tailwindcss/postcss + @tailwindcss/vite 4.3.3, vite 8.3.4, @vitejs/plugin-react 6.1.2, @types/react(-dom) 19.3.0 (all MIT).
Next telemetry is disabled through `NEXT_TELEMETRY_DISABLED=1` in the app scripts (AGENTS.md: no telemetry).

### New license findings: APPROVED by the owner on 2026-10-14 (each for the specific case below)
| License | Package | Where | Note |
|---|---|---|---|
| LGPL-3.0-or-later | `@img/sharp-libvips-linux-x64` (and musl) | RUNTIME: `next` -> `sharp` (optional) -> prebuilt libvips binaries used for image optimization | dynamically loaded, unmodified; LGPL is outside the strict list |
| CC-BY-4.0 | `caniuse-lite` | build tooling (browserslist data used by Next/PostCSS) | data license, not code; attribution |
Options for sharp: approve LGPL for unmodified, dynamically linked binaries; or avoid sharp (disable Next image optimization with `images.unoptimized` or use a custom loader) and drop it from the runtime.

Decision (owner, 2026-10-14): both approved. `@img/sharp-libvips-*` (LGPL-3.0-or-later) only as unmodified, dynamically loaded prebuilt binaries brought by `next` -> `sharp`;
`caniuse-lite` (CC-BY-4.0) as build-time browser data. Obligations to honor: keep license notices and attribution, never modify those packages, and include
third-party notices with every client delivery (to be generated in CI, plan step 8). Any other LGPL/GPL-family or CC-BY package needs its own approval.

## Decision 2026-10-14: Python-2.0 for `argparse` at runtime
Found by `scripts/check-licenses.mjs` (plan step 8): `argparse` is a RUNTIME transitive dependency (`@nestjs/swagger` -> `js-yaml` -> `argparse`). Approved by the owner for this package only
(permissive PSF-style license; notice goes into `THIRD_PARTY_NOTICES.md`). Machine-readable policy: `scripts/license-policy.json`.

## Audit (2026-10-14)
`pnpm audit`: 1 moderate finding, `esbuild <=0.24.2` (dev server request exposure) via `drizzle-kit` -> `@esbuild-kit/*` (dev tooling only, not shipped). CI fails only on high severity in production dependencies
and reports the rest.
