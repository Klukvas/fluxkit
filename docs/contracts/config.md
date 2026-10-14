# Contract: configuration and feature flags

Status: draft (first version, introduced in plan step 5). Covered by SemVer (AGENTS.md section 17).

## Environment variables read by `apps/api` (validated by `@fluxkit/config` `loadEnv`)
| Variable | Required | Default | Meaning |
|---|---|---|---|
| `DATABASE_URL` | yes | - | Postgres connection string |
| `REDIS_URL` | no | - | Redis connection string (queues, cache) |
| `PORT` | no | 3000 | HTTP port |
| `FEATURES_ENABLED` | no | empty | Comma-separated optional feature names; unset means none |
| `FEATURES_DIR` | no | `<repo>/packages/features` | Where feature packages are discovered |

Invalid values fail startup with a readable `Invalid environment: ...` error.

## Feature package contract
- A feature is a package under the features directory whose `package.json` has `"fluxkit": { "feature": "<name>" }`. The folder name is irrelevant.
- `main` (default `dist/index.js`) must export `featureModule`, a Nest module. It is imported dynamically and mounted only if `<name>` is in `FEATURES_ENABLED`.
- Core never imports features statically. Enabled but missing or broken feature: startup fails loudly. Disabled or deleted feature: no effect.
