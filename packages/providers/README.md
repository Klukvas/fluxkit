# packages/providers

Payment, shipping and email provider plugins, one package per provider (`packages/providers/<name>`). Core must never import from here, and neither may `apps/*`: `apps/api` imports only the enabled providers, dynamically (ADR 0029 decision 8).

## Shipping provider convention
- `package.json` declares `"fluxkit": { "provider": "<code>", "kind": "shipping" }`. The code (`SHIPPING_PROVIDER_CODE_PATTERN`, for example `nova_post`) is what `SHIPPING_PROVIDERS_ENABLED` names; the folder name is irrelevant.
- `main` (default `dist/index.js`) exports `providerModule`, a Nest module.
- The module provides one class marked `@SetMetadata(SHIPPING_PROVIDER_METADATA, shippingProviderMetadata("<code>"))` that implements `ShippingProviderPort` from `@fluxkit/core`. The class may be injectable and have dependencies of its own module.
- Variables the provider needs (keys) are read and validated by the provider itself (in its module's factory, so a missing key stops the startup), never logged, and listed in `docs/contracts/config.md` and `.env.example`.
- The provider validates its own non-secret settings (`validateSettings`, synchronous; the admin settings route applies it after its bounded check) and re-checks them when it uses them.
- Its specs run the core contract check (`checkShippingProviderContract`) and never reach the network (see `nova-post`'s no-network guard).
- Own tests live in the package so they disappear with it. Removal = delete the folder and remove the code from `SHIPPING_PROVIDERS_ENABLED`.
- Packages: `_fake` (test-only, code `fake`), `nova-post` (code `nova_post`, Nova Post API v.1.0; variables `NOVA_POST_API_KEY`, `NOVA_POST_ENVIRONMENT`). Details of the contract: `docs/contracts/config.md`.

## Email provider convention
Added by email plan step 4 (ADR 0031 decision 4).
- `package.json` declares `"fluxkit": { "provider": "<code>", "kind": "email" }`. Codes are unique per kind, so `fake` exists once for shipping (`_fake`) and once for email (`_fake-email`). Exactly one email provider is active: the code `EMAIL_PROVIDER` names (`none` loads nothing).
- `main` (default `dist/index.js`) exports `providerModule`, a Nest module; the module provides one class marked `@SetMetadata(EMAIL_PROVIDER_METADATA, emailProviderMetadata("<code>"))` that implements `EmailProviderPort` from `@fluxkit/core` (`code`, `capabilities`, `send`). It answers typed results with codes only (never a provider's message text), passes the idempotency key through and honours the abort signal; the API decides timeout, logging and retries.
- Its key (for example `RESEND_API_KEY`) is read by the provider's own parser, never logged, stored or returned. Its specs run `checkEmailProviderContract` and never reach the network.
- Removal = delete the folder and set `EMAIL_PROVIDER=none` (CI: `scripts/feature-matrix.sh providers-deleted`).
- Packages: `_fake-email` (test-only, code `fake`; variable `FAKE_EMAIL_CAPTURE_FILE`), `resend` (code `resend`, Resend `POST /emails`; variable `RESEND_API_KEY`; tested against a local stub only until the live check S1). Details of the contract: `docs/contracts/config.md`.
