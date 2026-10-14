# 0003. Tooling

Status: accepted (versions to be fixed when scaffolding)

| Area | Choice | Why |
|---|---|---|
| Package manager | pnpm workspaces | Fast, strict dependency isolation that supports module boundaries |
| Task runner | Turborepo | Build/test cache and task graph; speeds up the feature-removal CI matrix |
| Unit/integration | Vitest | One runner for the whole monorepo, native TS/ESM, good for money-logic TDD |
| E2E | Playwright | Cart, checkout, admin flows; fast in CI |
| Lint/format | ESLint + Prettier | Standard, strict TS rules enforce AGENTS.md section 9 (no any, no ts-ignore, no empty catch) |
| Boundaries | dependency-cruiser | Enforces "core must not import features" |
| Repo/CI | GitHub + GitHub Actions | Best agent integration; matrix builds; Dependabot |

## To verify before locking
- Licenses of all tools against the allowlist (AGENTS.md section 16).
- Node LTS version and pinned versions of all tools.
- NestJS works cleanly with Vitest (decorator metadata, SWC/esbuild plugin) - validate in the scaffold spike.

## Update 2026-10-14: TypeScript pinned to 6.0.3
`typescript-eslint` 8.71.2 (also canary) rejects TypeScript 7, and `dependency-cruiser` 18.6.0 supports `<7.0.0` and silently cruises 0 modules on TS 7.
TypeScript is therefore pinned to 6.0.3 in every workspace package. Revisit when both tools support TS 7.
Guard: `scripts/check-boundaries.mjs` fails when no modules were cruised.
