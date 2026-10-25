# packages/providers

Payment and shipping provider plugins, one package per provider (`packages/providers/<name>`). Core must never import from here, and neither may `apps/*`: `apps/api` imports only the enabled providers, dynamically (ADR 0029 decision 8).

## Shipping provider convention
- `package.json` declares `"fluxkit": { "provider": "<code>", "kind": "shipping" }`. The code (`SHIPPING_PROVIDER_CODE_PATTERN`, for example `nova_post`) is what `SHIPPING_PROVIDERS_ENABLED` names; the folder name is irrelevant.
- `main` (default `dist/index.js`) exports `providerModule`, a Nest module.
- The module provides one class marked `@SetMetadata(SHIPPING_PROVIDER_METADATA, shippingProviderMetadata("<code>"))` that implements `ShippingProviderPort` from `@fluxkit/core`. The class may be injectable and have dependencies of its own module.
- Variables the provider needs (keys) are read and validated by the provider itself (in its module's factory, so a missing key stops the startup), never logged, and listed in `docs/contracts/config.md` and `.env.example`.
- The provider validates its own non-secret settings (`validateSettings`, synchronous; the admin settings route applies it after its bounded check) and re-checks them when it uses them.
- Its specs run the core contract check (`checkShippingProviderContract`) and never reach the network (see `nova-post`'s no-network guard).
- Own tests live in the package so they disappear with it. Removal = delete the folder and remove the code from `SHIPPING_PROVIDERS_ENABLED`.
- Packages: `_fake` (test-only, code `fake`), `nova-post` (code `nova_post`, Nova Post API v.1.0; variables `NOVA_POST_API_KEY`, `NOVA_POST_ENVIRONMENT`). Details of the contract: `docs/contracts/config.md`.
