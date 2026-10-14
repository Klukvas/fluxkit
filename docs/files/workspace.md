# Workspace files

## Root
- `package.json` - private workspace root; scripts `build` and `typecheck`; pins pnpm and Node range; devDependencies turbo and typescript (exact versions).
- `pnpm-workspace.yaml` - workspace globs: `apps/*`, `packages/*`, `packages/features/*`, `packages/providers/*`.
- `turbo.json` - Turborepo tasks `build` (cached, outputs `dist/**`) and `typecheck`; both depend on upstream `build`.
- `tsconfig.base.json` - strict TypeScript settings shared by all packages (ES2022, Bundler resolution, `noUncheckedIndexedAccess`).
- `.nvmrc` - Node major version (22). `.editorconfig` - editor defaults. `.env.example` - documented env vars (empty for now).
- `pnpm-lock.yaml` - lockfile, always committed.

## Apps (empty scaffolds)
- `apps/api` (`@fluxkit/api`) - NestJS API. `apps/storefront` (`@fluxkit/storefront`) - Next.js site. `apps/admin` (`@fluxkit/admin`) - Vite React admin.

## Packages (empty scaffolds)
- `packages/core` - domain logic. `packages/ui` - token-based components. `packages/theme` - design tokens and presets.
- `packages/config` - feature flags and settings schema. `packages/api-client` - client generated from OpenAPI.
- `packages/features/` - one package per optional feature (none yet). `packages/providers/` - one package per payment/shipping provider (none yet).

## Per package
- `package.json` (name `@fluxkit/<name>`, scripts `build` and `typecheck`), `tsconfig.json` (extends base, `src` to `dist`), `src/index.ts` (placeholder export), `README.md`.

## Other
- `infra/` - Docker Compose and deployment (plan step 4). `seeds/` - demo data (no client data).
