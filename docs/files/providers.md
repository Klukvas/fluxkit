# packages/providers

Payment and shipping provider plugins, one package per provider. A shipping provider declares `"fluxkit": {"provider": "<code>", "kind": "shipping"}`, exports `providerModule` and is loaded by `apps/api` only when its code is in `SHIPPING_PROVIDERS_ENABLED` (`docs/contracts/config.md`, "Shipping provider package contract"). Core and apps never import a provider (`core-must-not-import-providers`, `apps-must-not-import-providers`).

- `README.md` - rules for provider packages.
- `_fake/` - `@fluxkit/provider-fake`, shipping provider `fake`. TEST-ONLY: deterministic, in-memory, no network; never enable it in a real shop. Fixture for the provider matrix (`scripts/feature-matrix.sh providers-*`) and for tests of the shipping module; safe to delete.
  - `README.md` - purpose, variables (none), the failure hook, how to remove it.
  - `package.json` - the manifest (`fluxkit.provider` = `fake`, `fluxkit.kind` = `shipping`); depends on `@fluxkit/core` for the port, never on `apps/api`.
  - `src/fake-shipping-provider.ts` - `FakeShippingProvider`: implements `ShippingProviderPort` with fixed cities and pickup points (all in `UA`, also found by ref with `findPickupPoint`), a fixed estimate, numbered waybills kept in memory, and the test hooks `failNext`, `setTrackingStatus`, `reset`, `waybillCount`. Must NOT read the environment, the clock, a random source or the network.
  - `src/index.ts` - `FakeShippingProviderModule` and the entry export `providerModule`.
  - `src/fake-shipping-provider.spec.ts` - unit tests of the provider and the hooks (they disappear with the package).
