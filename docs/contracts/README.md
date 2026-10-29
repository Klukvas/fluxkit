# Public contracts

Everything listed here is covered by SemVer. Anything not listed is internal.

Existing:
- `api.md` - public HTTP API (source of truth: `docs/api/openapi.json`).
- `config.md` - environment variables and the feature package contract.
- `events.md` - domain events (the outbox), the handler metadata key, the delivery rules and the order ports.
- `email-templates.md` - mail templates: the template contract, the registration metadata, the override rule and the built-in keys.
- `personal-data-export.md` - the personal data export document `fluxkit.personal-data-export/v1` (builder only; no route yet).
- `theme-tokens.md` - design tokens.

Not written yet (add when the first implementation exists): `slots.md` (UI slots), price adjusters (a hook, with the pricing pipeline plan),
`db-extension.md` (tables safe to extend).

Entry format: name, since-version, description, shape, status (stable / deprecated since X).
