# @fluxkit/provider-fake

Purpose: a TEST-ONLY shipping provider with code `fake` (ADR 0029, shipping plan step 4). It implements `ShippingProviderPort` deterministically and in memory (three fixed cities, a branch and a locker in each, a fixed estimate, numbered waybills and a tiny PDF label), with no network and no randomness; its only clock is the `now` test hook, which dates the waybills it creates. It is the fixture for the provider enable / disable / delete CI matrix and for the tests and e2e suites of the shipping module. Never enable it in a real shop: its data is made up. `loadEnv` refuses `SHIPPING_PROVIDERS_ENABLED=fake` when `NODE_ENV=production` (the API does not start).

- Flag: `SHIPPING_PROVIDERS_ENABLED=fake` (comma-separated list of provider codes).
- Manifest: `"fluxkit": { "provider": "fake", "kind": "shipping" }` in `package.json`.
- Entry: `src/index.ts` exports `providerModule`, loaded dynamically by `apps/api` only when the code is enabled.
- Variables: none.
- Routes, DB tables, migrations: none.
- Extension points used: the provider loader and registry (`apps/api/src/shipping/registry`).

## Test hook
`FakeShippingProvider` has methods beyond the port. A test reaches the instance with `app.get(FakeShippingProvider)` (from this package) or by casting the registry's answer; the hooks work inside one process only.
- `failNext(operation, { reason?, providerCodes?, times?, afterEffect?, hang? })`: the next `times` (default 1) calls of `operation` (`searchCities`, `listPickupPoints`, `findPickupPoint`, `estimate`, `createWaybill`, `findWaybill`, `cancelWaybill`, `track`, `fetchLabel`, `checkConnection`) fail. Result operations answer `providerFailure(reason ?? "unavailable", providerCodes ?? [])`; the three lookups throw, as the port says they do. `afterEffect: true` (`createWaybill`) creates the waybill but loses the answer, so `findWaybill` can settle the `unknown` shipment. `hang: true` never answers until the abort signal fires, then rejects with its reason.
- `now` (default `() => new Date()`): the fake carrier's clock. `findWaybill` honours its window by instant: a waybill whose creation time is outside `[createdAfter, createdBefore]` is not found, and a window that is not two ordered instants is `rejected` with `INVALID_WINDOW` (review M-2).
- `setTrackingStatus(trackingNumber, status, carrierStatusCode)`: what `track` answers next for that waybill (default `created` / `FAKE_CREATED`).
- `reset()` forgets waybills and planned failures, restores `now` and restarts the numbering (`FAKE000001`); `waybillCount()` counts waybills.

Settings: none of its own; `validateSettings` accepts any object (the API's bounded check still applies). `fetchLabel` answers only when the tracking number belongs to the ref. Its spec runs the core contract check `checkShippingProviderContract`.

Fixed data: cities `fake-city-kyiv`, `fake-city-lviv`, `fake-city-odesa`; points `<city ref>-point-1` (branch) and `-point-2` (locker), all in `UA`, also found one by one with `findPickupPoint`; estimate `FAKE_ESTIMATE_MINOR_UNITS` (7500) in the currency of the declared value; waybills `fake-waybill-NNNNNN` with tracking number `FAKENNNNNN`.

How to remove: delete `packages/providers/_fake` and remove `fake` from `SHIPPING_PROVIDERS_ENABLED`. Nothing in core or `apps/api` references it (CI: `scripts/feature-matrix.sh providers-deleted`).
