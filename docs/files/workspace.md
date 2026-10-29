# Workspace files

## Root
- `package.json` - private workspace root; scripts `build`, `typecheck`, `lint`, `format`, `format:check`, `check:boundaries`; pins pnpm and Node range; devDependencies pinned exactly (turbo, typescript 6.0.3, eslint, typescript-eslint, prettier, dependency-cruiser).
- `pnpm-workspace.yaml` - workspace globs: `apps/*`, `packages/*`, `packages/features/*`, `packages/providers/*`, `seeds`.
- `turbo.json` - Turborepo tasks `build` (cached, outputs `dist/**`) and `typecheck`; both depend on upstream `build`.
- `tsconfig.base.json` - strict TypeScript settings shared by all packages (ES2022, Bundler resolution, `noUncheckedIndexedAccess`).
- `.nvmrc` - Node major version (22). `.editorconfig` - editor defaults. `.env.example` - every documented env var with its default (the API's, the storefront's and the optional `E2E_*` ones, commented out).
- `pnpm-lock.yaml` - lockfile, always committed.
- `eslint.config.mjs` - ESLint flat config: strict TS rules, bans `any`, `@ts-ignore`/`@ts-expect-error`, empty `catch`, unused disable directives.
- `.prettierrc.json`, `.prettierignore` - Prettier for code and config (Markdown is ignored).
- `.dependency-cruiser.cjs` - module boundary rules (core must not import features, infrastructure clients, Node built-ins (`core-must-not-import-node-builtins`, email plan step 2) or provider packages of any kind, email included (`packages/providers/*`, `@fluxkit/provider-*`), apps must not import provider packages either, features isolated, packages must not import apps, no deep imports, no cycles).
- `scripts/check-boundaries.mjs` - runs dependency-cruiser; fails on violations or if zero modules were cruised.

## Apps
- `apps/api` (`@fluxkit/api`) - NestJS API. `apps/storefront` (`@fluxkit/storefront`) - Next.js site. `apps/admin` (`@fluxkit/admin`) - Vite React admin.

## Packages
- `packages/core` - catalog domain rules (not a scaffold any more; see `core.md`). `packages/ui` - token-based components. `packages/theme` - design tokens and presets.
- `packages/config` - feature flags and settings schema. `packages/api-client` - typed client for the store API (hand-written types checked against `docs/api/openapi.json`, `docs/files/api-client.md`).
- `packages/features/` - one package per optional feature (none yet). `packages/providers/` - one package per payment, shipping and email provider (`docs/files/providers.md`).

## Per package
- `package.json` (name `@fluxkit/<name>`, scripts `build` and `typecheck`), `tsconfig.json` (extends base, `src` to `dist`), `src/index.ts` (placeholder export), `README.md`.

## Other
- `infra/docker-compose.yml` - local/CI services: PostgreSQL 17, Redis 8, Meilisearch v1.55.0 (healthchecks, ports on 127.0.0.1, required vars via `.env`). `infra/README.md` - how to start. `seeds/` - demo data and ProductType presets (`@fluxkit/seeds`, no client data; see `seeds.md`).

## CI and scripts
- `.github/workflows/ci.yml` - CI jobs (verify, feature-matrix, policy, docs, compose). `.github/dependabot.yml` - weekly dependency updates.
- `scripts/license-policy.json` + `scripts/check-licenses.mjs` - license policy and its check (production strict, dev extras, explicit exceptions).
- `scripts/third-party-notices.mjs` - writes `third-party/THIRD_PARTY_NOTICES.md` for runtime dependencies (git-ignored, CI artifact).
- `scripts/spikes/` - one-off verification scripts a human runs by hand (README there); not part of any build or CI job. `nova-post-verify.mjs`: the shipping plan step 7a check of the new Nova Post API (ADR 0030; stages `keyless`, `readonly`, `write --confirm`, `--env sandbox|production`, `--self-test`; the write stage refuses production without `--allow-production-write`). `nova-poshta-verify.mjs`: the deprecated check of the legacy Nova Poshta API, kept for history. `resend-verify.mjs`: the email plan step 6 check S1 of Resend (stages `keyless` and `send --confirm`, one real mail to the owner's own address, `--self-test`). `monobank-verify.mjs`: the payments plan check S1 of Monobank acquiring with a TEST token (stages `readonly`, `invoice --confirm`, `pay --confirm`, `webhook`, `--self-test`). None may print or write a key, a token, a JWT or personal data.
- `scripts/check-docs.mjs` - docs-with-code rules for PRs. `scripts/feature-matrix.sh` - feature on/off/deleted, shipping provider providers-on/providers-off/providers-deleted/providers-nova-post and email provider providers-email-fake/providers-email-none/providers-email-resend and payment provider providers-payment-fake/providers-payment-none/providers-payment-monobank verification (the provider modes read the registry's startup log line; the email modes also read `emailDelivery` and the payment modes `onlinePayment` of `GET /store/config`; `providers-email-resend` also checks the refusal without `RESEND_API_KEY` and, with a preloaded `fetch` wrapper, that no request goes to a Resend host at startup; `providers-payment-monobank` checks the refusal without `MONOBANK_TOKEN` and, with a preloaded `fetch` wrapper, that no request goes to a Monobank host at startup; `providers-deleted` also removes `_fake-email`, `_fake-payment`, `resend` and `monobank` and checks that `EMAIL_PROVIDER=fake`, `EMAIL_PROVIDER=resend`, `PAYMENT_PROVIDERS_ENABLED=fake` and `PAYMENT_PROVIDERS_ENABLED=monobank` then refuse to start).
