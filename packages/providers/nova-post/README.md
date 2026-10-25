# @fluxkit/provider-nova-post

Purpose: the Nova Post shipping provider (code `nova_post`) on the new Nova Post REST API `v.1.0` (JWT), ADR 0030. It implements `ShippingProviderPort` for Ukraine: city and branch/parcel-locker lookups for the storefront picker, an informational estimate, waybill creation, find-back after a lost answer (`reconcile`), cancellation, tracking by polling and the marking label. Plan: `docs/plans/2026-10-25-nova-post-plugin.md` (every carrier fact used is cited there: spike 7a on production and its rerun, the official documentation).

- Flag: `SHIPPING_PROVIDERS_ENABLED=nova_post` (comma-separated list of provider codes).
- Manifest: `"fluxkit": { "provider": "nova_post", "kind": "shipping" }` in `package.json`.
- Entry: `src/index.ts` exports `providerModule`, loaded dynamically by `apps/api` only when the code is enabled.
- Dependencies: `@fluxkit/core`, `zod` 4.6.7 (the version the workspace pins); Node 22 `fetch`. No HTTP library.
- Routes, DB tables, migrations: none (settings live in the core table `shipping_provider_setting`).
- Extension points used: the provider loader and registry (`apps/api/src/shipping/registry`), the admin settings route (`validateSettings`).

## Variables (read by this package, never by `loadEnv`)
| Variable | Rule |
|---|---|
| `NOVA_POST_API_KEY` | Required when `nova_post` is enabled; 16 to 512 visible ASCII characters without spaces. Missing or malformed: the API refuses to start, naming the variable, never the value. Never logged, stored or returned; it travels only in the query of `GET /clients/authorization`, whose URL is never logged. Create it in the business cabinet `new.novaposhta.ua`, "Settings - Security" (issued to a natural person). Rotating it needs a restart. |
| `NOVA_POST_ENVIRONMENT` | `sandbox` (default when unset or empty, `https://api-stage.novapost.com/v.1.0`) or `production` (`https://api.novapost.com/v.1.0`); anything else stops the startup. Production must be written explicitly. There is no URL variable. The provider logs its environment once at startup. Note: Nova Post says sandbox keys for Ukrainian accounts are "currently not supported". |

## Settings (the sender profile, `PUT /admin/shipping/providers/nova_post/settings`)
Validated by `validateSettings` (unknown keys refused): `senderName` (1 to 100 characters, at least two words), `senderPhone` (`380` + 9 digits), optional `senderEmail`, optional `senderCompanyTin` (8 to 20 digits) with `senderCompanyName` (both or neither; a legal entity), `senderDivisionId` (the integer division id where parcels are handed in, from `GET /divisions`, never `externalId`), `payerDefault` (`Sender` or `Recipient`, used by the estimate), optional `payerContractNumber` (2 to 20 characters, non-cash payment by the sender), `defaultParcel` (`weightGrams`, `lengthMm`, `widthMm`, `heightMm`, positive integers; used by the estimate). Example: `{"senderName": "Іван Петренко", "senderPhone": "380501234567", "senderDivisionId": 12345, "payerDefault": "Recipient", "defaultParcel": {"weightGrams": 1000, "lengthMm": 300, "widthMm": 200, "heightMm": 100}}` (placeholder values).

## What each operation does
| Port | Nova Post | Notes |
|---|---|---|
| `searchCities` | `GET /settlements?countryCodes[]=UA&textSearch=&limit=` | `Accept-language` `uk` or `en` (without it names are Latin); region = "district, oblast" |
| `listPickupPoints` | `GET /divisions?settlementIds[]=&divisionCategories[]=&limit=100&page=` | `branch` = `PostBranch` + `CargoBranch`, `locker` = `Postomat`; `PUDO` not offered; points that do not issue skipped; branches first, at most 15 pages per call, 4 in flight (see Limits) |
| `findPickupPoint` | `GET /divisions?ids[]=<id>` | undocumented filter (observed); anything but exactly that division throws (never another point) |
| `estimate` | `POST /shipments/calculations` | pickup points only, UAH shops only (the answer names no currency); sum of `services[].cost` in hryvnias; never answered `200` in the spike: unverified |
| `createWaybill` | `POST /shipments` | inline sender (settings) and recipient (order), `clientOrder` = order number, one parcel, declared value in whole hryvnias rounded up; pickup points only (an address is `not_supported`); **never repeated** (no idempotency) |
| `findWaybill` | `GET /shipments?limit=100&page=` | newest first; `clientOrder` + `createdAt` inside the window; at most 10 pages, then a failure (never `null`); two matches: `rejected` |
| `cancelWaybill` | `DELETE /shipments/<uuid>` | a repeat (`422 shipment_was_deleted`) counts as done |
| `track` | `GET /shipments/tracking?numbers[]=` | `phones` ignored; codes mapped by `src/status-map.ts` (only `1` and `2` observed) |
| `fetchLabel` | `GET /shipments/print?numbers[]=<number>&type=marking` | best effort: production answered `422 "Internal Server Error"` (2026-10-25); answered as `unavailable`, never a made-up PDF |
| `checkConnection` | a fresh JWT, then `GET /divisions?countryCodes[]=UA&limit=1` | |

Timeouts: the API's signal plus a per-request ceiling from `SHIPPING_PROVIDER_TIMEOUTS_MS` (5 s lookups and estimates, 15 s waybill calls). The JWT is kept in memory until 5 minutes before its `exp` (50 minutes without one), fetched by one call at a time, and a `401` refreshes it and repeats a read or a delete once (never a create). Failures carry carrier codes only (the HTTP status, short field names, snake_case values such as `shipment_was_deleted`), never a carrier text. Logs: operation, status or kind, codes, duration; never the key, the JWT, a URL with a query, a body, a name or a phone.

## Limits and known gaps
- In the largest cities the picker lists all branches but only part of the lockers (Kyiv: about 8 000 points, 7 400 of them lockers; 15 pages of 100 within the 5 s lookup limit); the cut is logged. A locker not listed still works when its id reaches the checkout.
- Not built: delivery to an address, cash on delivery, webhooks, international shipments, several parcels, courier pickups.
- Unverified: domestic prices and their unit, every status code but `1` and `2`, the label answer, rate-limit numbers, the tracking batch limit, the `ids[]` filter staying available.

## Tests
`pnpm --filter @fluxkit/provider-nova-post test`: a local stub carrier on `127.0.0.1` (`src/test-support/stub-carrier.ts`, invented data only) and a no-network guard (`src/test-support/no-network.ts`) that fails a spec file on any request to another host. Specs cover the verified request shapes, the JWT cache, error and size mapping, `findWaybill` paging, the status table, secrets in logs, the module's startup refusal and the core provider contract check.

How to remove: delete `packages/providers/nova-post`, remove `nova_post` from `SHIPPING_PROVIDERS_ENABLED` and the two variables from the environment. Nothing in core or `apps/api` references it (CI: `scripts/feature-matrix.sh providers-deleted`). Orders and shipments already made keep their snapshot; their shipment actions answer `409 provider_not_enabled`.
