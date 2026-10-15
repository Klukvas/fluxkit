# File and module map

One file per package/app. Format, one line per significant file or folder:

- `path/to/file.ts` - what it is responsible for; what it must not do.

Update on every add, move, rename, or delete.

## Index
- `workspace.md` - repo root, CI and scripts. `api.md` - apps/api. `storefront.md` - apps/storefront. `admin.md` - apps/admin.
- `seeds.md` - seeds (`@fluxkit/seeds`, demo data and ProductType presets). `ui.md` - packages/ui. `theme.md` - packages/theme. `config.md` - packages/config. `features.md` - packages/features.
- Scaffolds without real code yet: `packages/core` and `packages/api-client` (placeholder `src/index.ts`), `packages/providers` (only a README, no package).
  They are documented here until they get code.
