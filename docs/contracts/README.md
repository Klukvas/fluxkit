# Public contracts

Everything listed here is covered by SemVer. Anything not listed is internal.

Existing:
- `api.md` - public HTTP API (source of truth: `docs/api/openapi.json`).
- `branding.md` - the storefront brand config `apps/storefront/src/config/brand.ts` (fork-owned): logo, icons, theme colour, default social picture.
- `card-registry.md` - storefront product card registry (fork-owned `cards/custom.ts`, `ProductCardModel`) and the `view` URL parameter (draft).
- `config.md` - environment variables and the feature package contract.
- `header-footer.md` - storefront header and footer composition: the fork-owned `config/header.ts` and `config/footer.ts` (blocks, order, controls, category count, link groups with headings, text lines) (draft; the plan `docs/plans/2026-11-08-design-changeability.md` calls it `layout-config.md`).
- `events.md` - domain events (the outbox), the handler metadata key, the delivery rules and the order ports.
- `email-templates.md` - mail templates: the template contract, the registration metadata, the override rule and the built-in keys.
- `personal-data-export.md` - the personal data export document `fluxkit.personal-data-export/v1` (builder only; no route yet).
- `search.md` - catalog search: routes, facet keys, sort names, limits, the public data rule and what is not contract.
- `theme-tokens.md` - design tokens.

Not written yet (add when the first implementation exists): `slots.md` (UI slots), price adjusters (a hook, with the pricing pipeline plan),
`db-extension.md` (tables safe to extend).

Entry format: name, since-version, description, shape, status (stable / deprecated since X).
