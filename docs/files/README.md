# File and module map

One file per package/app. Format, one line per significant file or folder:

- `path/to/file.ts` - what it is responsible for; what it must not do.

Update on every add, move, rename, or delete.

## Index
- `workspace.md` - repo root, CI and scripts. `api.md` - apps/api. `storefront.md` - apps/storefront. `admin.md` - apps/admin.
- `ui.md` - packages/ui. `theme.md` - packages/theme. `config.md` - packages/config. `features.md` - packages/features.
- Empty scaffolds with only a README and a placeholder entry point (documented here until they get code): `packages/core` (domain logic),
  `packages/api-client` (client generated from OpenAPI), `packages/providers` (payment and shipping plugins), `seeds/` (demo data).
