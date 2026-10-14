# @fluxkit/feature-example

Purpose: sample optional feature. It shows the structure every feature follows and is the intended fixture for the enable / disable / delete CI matrix (planned, plan step 8; no workflow exists yet).
Remove it from a real project by deleting this folder; nothing in core references it.

- Flag: `FEATURES_ENABLED=example` (comma-separated list of enabled features).
- Manifest: `"fluxkit": { "feature": "example" }` in `package.json`; the folder name is irrelevant.
- Entry: `src/index.ts` exports `featureModule` (a Nest module), loaded dynamically by `apps/api` only when the flag is on.
- Routes: `GET /example/ping`.
- DB tables / migrations: none.
- Extension points used: none.
- How to remove: delete `packages/features/_example` and remove `example` from `FEATURES_ENABLED`.
