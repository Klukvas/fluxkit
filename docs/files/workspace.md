# Workspace files

## Root
- `package.json` - private workspace root; scripts `build`, `typecheck`, `lint`, `format`, `format:check`, `check:boundaries`; pins pnpm and Node range; devDependencies pinned exactly (turbo, typescript 6.0.3, eslint, typescript-eslint, prettier, dependency-cruiser).
- `pnpm-workspace.yaml` - workspace globs: `apps/*`, `packages/*`, `packages/features/*`, `packages/providers/*`.
- `turbo.json` - Turborepo tasks `build` (cached, outputs `dist/**`) and `typecheck`; both depend on upstream `build`.
- `tsconfig.base.json` - strict TypeScript settings shared by all packages (ES2022, Bundler resolution, `noUncheckedIndexedAccess`).
- `.nvmrc` - Node major version (22). `.editorconfig` - editor defaults. `.env.example` - documented env vars (empty for now).
- `pnpm-lock.yaml` - lockfile, always committed.
- `eslint.config.mjs` - ESLint flat config: strict TS rules, bans `any`, `@ts-ignore`/`@ts-expect-error`, empty `catch`, unused disable directives.
- `.prettierrc.json`, `.prettierignore` - Prettier for code and config (Markdown is ignored).
- `.dependency-cruiser.cjs` - module boundary rules (core must not import features, features isolated, packages must not import apps, no deep imports, no cycles).
- `scripts/check-boundaries.mjs` - runs dependency-cruiser; fails on violations or if zero modules were cruised.

## Apps (empty scaffolds)
- `apps/api` (`@fluxkit/api`) - NestJS API. `apps/storefront` (`@fluxkit/storefront`) - Next.js site. `apps/admin` (`@fluxkit/admin`) - Vite React admin.

## Packages (empty scaffolds)
- `packages/core` - domain logic. `packages/ui` - token-based components. `packages/theme` - design tokens and presets.
- `packages/config` - feature flags and settings schema. `packages/api-client` - client generated from OpenAPI.
- `packages/features/` - one package per optional feature (none yet). `packages/providers/` - one package per payment/shipping provider (none yet).

## Per package
- `package.json` (name `@fluxkit/<name>`, scripts `build` and `typecheck`), `tsconfig.json` (extends base, `src` to `dist`), `src/index.ts` (placeholder export), `README.md`.

## Other
- `infra/docker-compose.yml` - local/CI services: PostgreSQL 17, Redis 8, Meilisearch v1.55.0 (healthchecks, ports on 127.0.0.1, required vars via `.env`). `infra/README.md` - how to start. `seeds/` - demo data (no client data).

## CI and scripts
- `.github/workflows/ci.yml` - CI jobs (verify, feature-matrix, policy, docs, compose). `.github/dependabot.yml` - weekly dependency updates.
- `scripts/license-policy.json` + `scripts/check-licenses.mjs` - license policy and its check (production strict, dev extras, explicit exceptions).
- `scripts/third-party-notices.mjs` - writes `third-party/THIRD_PARTY_NOTICES.md` for runtime dependencies (git-ignored, CI artifact).
- `scripts/check-docs.mjs` - docs-with-code rules for PRs. `scripts/feature-matrix.sh` - feature on/off/deleted verification.
