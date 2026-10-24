# packages/providers

Payment and shipping provider plugins, one package per provider (`packages/providers/<name>`). Core must never import from here, and neither may `apps/*`: `apps/api` imports only the enabled providers, dynamically (ADR 0029 decision 8).

## Shipping provider convention
- `package.json` declares `"fluxkit": { "provider": "<code>", "kind": "shipping" }`. The code (`SHIPPING_PROVIDER_CODE_PATTERN`, for example `nova_poshta`) is what `SHIPPING_PROVIDERS_ENABLED` names; the folder name is irrelevant.
- `main` (default `dist/index.js`) exports `providerModule`, a Nest module.
- The module provides one class marked `@SetMetadata(SHIPPING_PROVIDER_METADATA, shippingProviderMetadata("<code>"))` that implements `ShippingProviderPort` from `@fluxkit/core`. The class may be injectable and have dependencies of its own module.
- Variables the provider needs (keys) are read and validated by the provider itself, never logged, and listed in `docs/contracts/config.md` and `.env.example`.
- Own tests live in the package so they disappear with it. Removal = delete the folder and remove the code from `SHIPPING_PROVIDERS_ENABLED`.
- Packages: `_fake` (test-only). Details of the contract: `docs/contracts/config.md`.
