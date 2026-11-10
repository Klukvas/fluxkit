# Public contracts

Everything listed here is covered by SemVer. Anything not listed is internal.

Existing:
- `api.md` - public HTTP API (source of truth: `docs/api/openapi.json`).
- `branding.md` - the storefront brand config `apps/storefront/src/config/brand.ts` (fork-owned): logo, icons, theme colour, default social picture.
- `card-registry.md` - storefront product card registry (fork-owned `cards/custom.ts`, `ProductCardModel`) and the `view` URL parameter (draft).
- `config.md` - environment variables and the feature package contract.
- `header-footer.md` - storefront header and footer composition: the fork-owned `config/header.ts` and `config/footer.ts` (blocks, order, controls, category count, link groups with headings, text lines) (draft; the plan `docs/plans/2026-11-08-design-changeability.md` calls it `layout-config.md`).
- `home-sections.md` - storefront home sections: the per-section `width` and the `custom` kind with the fork-owned `config/custom-sections.ts` (draft).
- `events.md` - domain events (the outbox), the handler metadata key, the delivery rules and the order ports.
- `email-templates.md` - mail templates: the template contract, the registration metadata, the override rule and the built-in keys.
- `personal-data-export.md` - the personal data export document `fluxkit.personal-data-export/v1` (builder only; no route yet).
- `search.md` - catalog search: routes, facet keys, sort names, limits, the public data rule and what is not contract.
- `slots.md` - storefront UI slots: the four server-only slots (`header.top`, `product-card.badges`, `product-card.actions`, `footer.columns`), their view-model props and the fork-owned `config/slots.tsx` (draft).
- `theme-tokens.md` - design tokens.

Not written yet (add when the first implementation exists): price adjusters (a hook, with the pricing pipeline plan),
`db-extension.md` (tables safe to extend).

Entry format: name, since-version, description, shape, status (stable / deprecated since X).

## Contract files in the template and in a client fork

`check:docs` (`scripts/check-docs.mjs`, CI job `docs`) fails a PR that changes a storefront contract file without a change under
`docs/contracts/`: `apps/storefront/src/config/{brand,catalog,header,footer,slots,custom-sections,home}.ts(x)`,
`apps/storefront/src/components/cards/{custom,types}.ts(x)` and `apps/storefront/src/lib/{custom-sections,slots}.ts(x)`. The rule is
for the template, where such a change may change a contract.

A client fork fills the config files among them itself (`docs/customization.md`), which changes no contract. It marks itself with
an empty file `.fluxkit-fork` at the repository root (checked in, no environment variable): with the marker, the config files
(`config/*.ts(x)` above and `components/cards/custom.ts`) are left out of the rule; the files that define the contract
(`components/cards/types.ts`, `lib/custom-sections.ts`, `lib/slots.ts`) keep it. The template never contains the marker:
`apps/storefront/src/fork-marker.upstream.spec.ts` (upstream-only, deleted by the fork in the same step) fails if it does.
