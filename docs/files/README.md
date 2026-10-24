# File and module map

One file per package/app. Format, one line per significant file or folder:

- `path/to/file.ts` - what it is responsible for; what it must not do.

Update on every add, move, rename, or delete.

## Index
- `workspace.md` - repo root, CI and scripts. `api.md` - apps/api. `storefront.md` - apps/storefront. `admin.md` - apps/admin.
- `core.md` - packages/core (catalog domain rules, pure TypeScript). `seeds.md` - seeds (`@fluxkit/seeds`, demo data and ProductType presets). `ui.md` - packages/ui. `theme.md` - packages/theme. `config.md` - packages/config. `features.md` - packages/features.
- `providers.md` - packages/providers (shipping provider plugins; only the test-only `_fake` so far). `features.md` - packages/features.
- Scaffolds without real code yet: `packages/api-client` (placeholder `src/index.ts`). It is documented here until it gets code.
