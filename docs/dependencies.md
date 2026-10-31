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
| react-router | 8.4.0 (pinned, see "Added in admin UI plan step 4b") | MIT | OK, runtime dependency of `apps/admin` only |
| vitest | 5.0.4 | MIT | OK |
| @playwright/test | 1.64.1 (pinned, see "Decision 2026-10-31" under "Added in storefront plan step 8"; was 1.56.1) | Apache-2.0 | OK, devDependency of `apps/storefront` and, at the same exact version, of `apps/admin` (admin UI plan step 11, owner answer 7; no new package in the lockfile) (browser binaries are downloaded separately and are not part of any delivery) |
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

## Added in storefront plan step 8 (end-to-end tests)
Approved by the owner 2026-10-18 (quiz, recommended answers): `@playwright/test` as a devDependency of `apps/storefront`, Chromium only, the root script `pnpm test:e2e` and the CI job `e2e`. NOT approved and not added: `@axe-core/playwright`. Approved by the owner on 2026-10-19 (admin UI plan, owner answer 7) and added in step 11: the same `@playwright/test` 1.56.1 as a devDependency of `apps/admin` for the separate admin suite `apps/admin/e2e`; the root `pnpm test:e2e` and the CI job `e2e` run both suites.

| Item | Fact |
|---|---|
| Package and pin | `@playwright/test` **1.56.1**, exact (no range), lockfile committed. Chosen because its Chromium revision (1194, Chromium 141) is the one installed in the agent sandbox; 1.56.1 includes the fix for GHSA-7mvr-c777-76hp (browser download without TLS verification, fixed in 1.55.1). Dependabot may bump it; the CI job installs the browser that belongs to the version it finds |
| License | Apache-2.0 (`@playwright/test`, `playwright`, `playwright-core`); optional macOS-only `fsevents@2.3.2` is MIT and not installed on Linux |
| Transitive packages | 2 (`playwright`, `playwright-core`) plus the optional `fsevents` |
| Installed size | about 13 MB in `node_modules/.pnpm` (`@playwright/test` 76 KB, `playwright` 4.2 MB, `playwright-core` 8.6 MB) |
| Browser | not an npm package: `playwright install chromium` downloads Chromium and its headless shell (about 0.9 GB unpacked on disk: 597 MB + 323 MB + ffmpeg 5 MB for revision 1194) into the user cache or `PLAYWRIGHT_BROWSERS_PATH`; development and CI only, never shipped. Chromium's own third-party licenses are those of the browser build and are not redistributed by us |
| Policy scripts | `pnpm check:licenses` allows it as a dev dependency on the strict list (Apache-2.0); `pnpm audit:prod` covers production dependencies only and never sees it; the `policy` job's report-only `pnpm audit` does |
| Services | none added: the CI job uses the same Postgres, Redis and Meilisearch containers as `verify` (its own database, `fluxkit_e2e_test`) |

Decision 2026-10-31: the pin moved from 1.56.1 to 1.64.1 in both `apps/storefront` and `apps/admin` (PR #158). Its Chromium revision is 1248 (`browsers.json` of `playwright-core` 1.64.1; the 1194 above is the history of the first approval). The license stays Apache-2.0 for `@playwright/test`, `playwright` and `playwright-core` (checked in the npm registry metadata; the local `node_modules` still holds 1.56.1).

## Added in admin UI plan step 4b (admin shell)
Approved by the owner in principle on 2026-10-19 (admin UI plan, owner answer 4: `react-router` for routing; data hook, forms, validation, permission table and i18n stay hand-written; no `@tanstack/react-query`). Runtime dependency of `apps/admin` only; the storefront does not use it.

| Item | Fact |
|---|---|
| Package and pin | `react-router` **8.4.0**, exact, lockfile committed. Published 2026-09-15 (more than two weeks before 2026-10-19); 8.5.0 (published 2026-10-19) was not taken. Peer `react` and `react-dom` `>=19.2.7` (installed 19.3.1); `engines.node >=22.22.0` (the sandbox runs 22.22.0; CI's Node 22 is the latest 22.x) |
| Use | data-router mode only: `createBrowserRouter` with `basename: "/admin-ui"`, `RouterProvider` from `react-router/dom`, lazy route objects (one chunk per area), `useBlocker` (unsaved changes), `Link`, `Navigate`, `useMatches`, `useNavigation`, `useRouteError`, `useSearchParams`. No framework mode, no server features, no `ScrollRestoration` (it would need an inline script under the strict CSP) |
| License | MIT (`react-router`, `@remix-run/route-pattern`, `cookie-es`); `pnpm check:licenses` exit 0 (366 packages, 164 runtime) |
| Transitive packages | 2: `@remix-run/route-pattern` 0.22.1 (2026-06-05, MIT) and `cookie-es` 3.1.1 (2026-03-27, MIT) |
| Installed size | about 3.2 MB on disk (`react-router` 2.6 MB with development and production builds, `@remix-run/route-pattern` 536 KB, `cookie-es` 48 KB); npm unpacked size of `react-router` 2 856 262 bytes |
| Bundle cost (measured) | the APIs used add 95 107 bytes raw, 30 809 gzip to a React + React DOM bundle (a probe build: 218 436 to 313 543 raw, 67 385 to 98 194 gzip). The admin's initial JavaScript is 392 050 bytes raw, 120 027 gzip (budget 440 000 / 135 000 in `apps/admin/build-output.spec.ts`); before step 4b the placeholder app was 222 338 raw, 68 976 gzip |
| Storage | the router reads one `sessionStorage` key of its own (applied view transitions) on start and writes it only after a view transition; the admin uses none, so nothing is written |
| Audit | `pnpm audit:prod` exit 0 (no known vulnerabilities) on 2026-10-19 |
| Alternatives considered | a hand-written router (the plan's recommendation, about 200 lines; rejected by the owner's answer); TanStack Router (MIT; typed routes, larger, brings its own conventions) |

Also added to `apps/admin`, no new external package: `vitest` 5.0.4 (dev, same pin as the other packages), `@fluxkit/api-client` (workspace, runtime) and `@fluxkit/core` (workspace, devDependency used by tests only to compare copied constants; a test checks that the bundle contains no zod).

## Decision 2026-10-14: Python-2.0 for `argparse` at runtime
Found by `scripts/check-licenses.mjs` (plan step 8): `argparse` is a RUNTIME transitive dependency (`@nestjs/swagger` -> `js-yaml` -> `argparse`). Approved by the owner for this package only
(permissive PSF-style license; notice goes into `THIRD_PARTY_NOTICES.md`). Machine-readable policy: `scripts/license-policy.json`.

## Decision 2026-10-30: PSF-2.0 for `argparse` 3.x at runtime
`@nestjs/swagger` 12.0.4 resolves `argparse@3.0.4` (still `@nestjs/swagger` -> `js-yaml` -> `argparse`, runtime), published under the SPDX id `PSF-2.0` (Python Software Foundation License 2.0) instead of the `Python-2.0` approved on 2026-10-14.
Approved by the owner on 2026-10-30 for this package only (permissive; the notice goes into `THIRD_PARTY_NOTICES.md`). Machine-readable policy: `scripts/license-policy.json`. The `Python-2.0` exception stays for argparse 2.x (devDependency of eslint).
`AGENTS.md` section 16 should get the matching line (owner edit): "PSF-2.0 for `argparse` (runtime transitive of `@nestjs/swagger` -> `js-yaml`), approved 2026-10-30".

## Audit (2026-10-14)
`pnpm audit`: 1 moderate finding, `esbuild <=0.24.2` (dev server request exposure) via `drizzle-kit` -> `@esbuild-kit/*` (dev tooling only, not shipped). CI fails only on high severity in production dependencies
and reports the rest.

## Added in media upload plan step 2 (`sharp` in the API)
Approved by the owner on 2026-10-23 (media upload plan `docs/plans/2026-10-23-media-upload.md`, quiz answer 2, and the owner's "yes" to using the library; ADR 0028): `sharp` 0.35.5, exact pin, a runtime dependency of `apps/api` for re-encoding uploaded images (orientation applied, metadata dropped, output fitted to 4 096 px). It is already in the lockfile through `next` (image optimization); the API now uses it directly.
- Licenses: `sharp` and `@img/sharp-linux-x64` are Apache-2.0; the prebuilt `@img/sharp-libvips-*` binaries are LGPL-3.0-or-later. The existing exception (unmodified, dynamically loaded binaries; never copy or modify their code; keep the notices) now also covers the API's use. `scripts/license-policy.json` records it in the `reason` of the two existing entries; `scripts/check-licenses.mjs` matches by package name and license, so it cannot tell who uses a package: the scope is a policy decision, not a technical check. The AGENTS.md section 16 sentence is the owner's file and is updated by the owner. Packages for other platforms (for example `darwin-arm64`, `linux-arm64`) are not in the exceptions list: add them only if the check fails on a machine that installs them.
- Alternatives considered (plan open question 2): a pure JS/WASM codec (slower, more of our own code, licences unchecked), a separate image service (a new service in Compose). Third-party notices (`pnpm notices`) must be shipped with a client delivery, as before.
- It decodes SVG, AVIF/HEIF, TIFF and GIF as well: our own magic-byte gate runs before `sharp` sees a file (ADR 0028).


## Notices gap found by the media step 9 review (L-5, owner and legal item, not fixed)
- `pnpm notices` (`scripts/third-party-notices.mjs`) already writes, for every runtime package, its name, version, the licence expression `pnpm licenses list --prod` reports and the homepage (164 packages on 2026-10-24, `sharp` and the `@img/sharp-*` packages included). It carries **no licence texts**: no LGPL-3.0, GPL-3.0 (which LGPL-3.0 incorporates) or Apache-2.0 text. It cannot be extended to copy them safely: `@img/sharp-libvips-linux-x64@1.3.4` (and the musl package) ship no LICENSE file at all (only `README.md`, `lib/`, `package.json`, `versions.json`), and the full GNU texts are not in the dependency tree. LGPL-3.0 section 4 and Apache-2.0 section 4(a) expect the texts to go with object code that is delivered.
- The libvips bundle is one package to `check:licenses` (`LGPL-3.0-or-later`), but its README lists the libraries inside it under other terms too: LGPLv3 (libvips, glib, pango, librsvg, libheif, libexif, fribidi, proxy-libintl), **cairo under MPL-1.1**, **aom under BSD-2-Clause plus the Alliance for Open Media Patent License 1.0**, and MIT, BSD, zlib, IJG, libpng, libtiff, fontconfig and freetype licences for the rest. AGENTS.md section 16 and `scripts/license-policy.json` name neither MPL-1.1 nor the AOM patent licence; since ADR 0028 they are in the API runtime, not only in Next's image optimizer.
- Owner and legal decide: whether a client delivery must add the full LGPL-3.0, GPL-3.0 and Apache-2.0 texts and the libvips README table to `THIRD_PARTY_NOTICES.md` (by hand or by a script change), and whether MPL-1.1 and the AOM patent licence inside libvips need an entry in the policy reasons. No licence was changed here.

## Added in email plan step 6 (Resend, an external HTTP API)
- **Resend** (`https://api.resend.com`, ADR 0031 decision 17): an external service called over HTTPS by `packages/providers/resend` with Node's built-in `fetch`; no npm package is installed (the plugin uses `zod` 4.6.7, already pinned). Nothing of Resend runs in or ships with our code, so no licence applies to the template.
- It is a **data processor**: it receives the recipient address, the sender and reply-to addresses and the rendered subject and bodies of every transactional mail. Its data location and processor terms (DPA) are UNKNOWN (plan R18): the owner obtains them before production and names Resend in the shop's privacy notice (input to the privacy plan). Open and click tracking stay off (ADR 0031 decision 1).
- Only when `EMAIL_PROVIDER=resend`; with `none` or another provider nothing is sent to Resend.

## Added in payments plan step 7 (Monobank acquiring, an external HTTP API)
- **Monobank acquiring "Plata by mono"** (`https://api.monobank.ua`, ADR 0032 decision 15): an external service called over HTTPS by `packages/providers/monobank` with Node's built-in `fetch` and `node:crypto` (webhook signatures); no npm package is installed (the plugin uses `zod` 4.6.7, already pinned). Nothing of Monobank runs in or ships with our code, so no licence applies to the template. Commercial terms (commission 1.3 %, 2 % for foreign cards, M24) are the merchant contract's.
- It is a **data processor** of payment data: it receives the order amount and currency, our payment attempt id (`reference`), the payment description ("Order <number>"), the basket lines (product titles, quantities, prices, SKUs, the shipping line) and the shop's return and webhook URLs; the shopper enters card data on Monobank's own page (the shop never sees it). It sends back the payment status, the card system and masked card number (the plugin keeps the system and the last four digits only) and refund records. No shopper name, email or address is sent (`customerEmails` is not used). Its data location, processor terms and settlement terms are UNKNOWN (M25): the owner obtains them with the merchant contract before production and names Monobank in the shop's privacy notice (input to the privacy plan).
- Only when `PAYMENT_PROVIDERS_ENABLED` names `monobank`; otherwise nothing is sent to Monobank. The live check S1 (test token) has not been run.

## Recorded in privacy plan step 11 (Nova Post, an external HTTP API)
- **Nova Post** (`https://api.novapost.com/v.1.0`, sandbox `https://api-stage.novapost.com/v.1.0`, ADR 0030): an external service called over HTTPS by `packages/providers/nova-post` with Node's built-in `fetch`; no npm package is installed (the plugin uses `zod` 4.6.7, already pinned). Nothing of Nova Post runs in or ships with our code, so no licence applies to the template. The plugin existed before this record; it is added here because it receives personal data.
- It receives the recipient's first and last name and phone, the pickup point, the order number as client reference, tracking numbers for status calls and the sender profile of the shop (name, phone, email, company); the plugin sends no recipient email. Whether it is a processor or an independent controller, its data location and its terms are UNKNOWN (privacy plan task O2): `TODO(fluxkit): legal review`, listed in `docs/privacy/processors.md`.
- Only when `SHIPPING_PROVIDERS_ENABLED` names `nova_post`; otherwise nothing is sent to Nova Post.

## Added in search plan step 3 (Snowball stemmers, vendored third-party code)
- **Snowball** 3.2.0 (`snowballstem/snowball` commit `6389c79f91cd67ed2de3ebdcf84ec8c2d2d23c11`, 2026-10-17), **BSD-3-Clause** (allowed by AGENTS.md section 16). Not an npm package: the algorithm files `ukrainian.sbl` (added upstream on 2026-10-15) and `english.sbl` are kept in `packages/core/src/search/stemmers/snowball/` with their `COPYING`, and `scripts/snowball/generate.mjs` turns them into TypeScript (ADR 0034 decision 7, `packages/core/src/search/stemmers/README.md`). No code of the Snowball project is executed that we did not generate ourselves from the algorithm files; the generated stemmers reproduce the reference stems of all 58 021 Ukrainian and all 42 649 English words of `snowball-data` (0 mismatches).
- Why: Meilisearch has no stemming; on a synthetic Ukrainian corpus the stems lift recall from 76.7% to 96.7% (plan `docs/plans/2026-10-29-search.md`, "Spike S1 results"). Alternatives considered: synonym lists only (partial coverage), a different engine with a Ukrainian analyzer (OpenSearch; replaces the decided stack), the npm package `snowball-stemmers` 0.6.0 (ISC; no Ukrainian).
- Notice: the BSD-3 text is kept in the source tree and `pnpm notices` appends a "Vendored code" section to `THIRD_PARTY_NOTICES.md`; ship it with every client delivery. The vocabulary samples in `*-sample.ts` come from `snowball-data` (BSD-3-Clause; word frequency lists, no running text).
- Owner decision needed (ADR 0034, marked CONFIRM): the vendoring itself. If it is refused, delete `packages/core/src/search/stemmers/` and `scripts/snowball/` and the `stems` fields of the search document; the rest of the search works on the original text.
- Owner confirmation 2026-10-31: the owner personally confirmed the vendored Snowball code (first approved by the orchestrator on 2026-10-29 under the standing autonomy grant). The CONFIRM mark above is resolved for the vendoring.
