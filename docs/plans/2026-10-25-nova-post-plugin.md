# Plan: Nova Post carrier plugin (shipping plan step 7b)

Status: plan of step 7b of `docs/plans/2026-10-24-shipping.md` (ADR 0029, ADR 0030). Written 2026-10-25 before any code, on `feat/shipping-nova-post`. **Built** 2026-10-25 on the same branch (PR not opened; independent review next): see Outcome.
Roles: Developer (Opus 5.5 high) writes the plan and the code; the orchestrator verifies; an independent reviewer (a different agent) reviews the PR.
Design basis: the shipping plan, section 8 (8.3 port mapping, 8.4 settings, 8.5 design), its sections "Spike 7a — production run 2026-10-25" and the rerun below; ADR 0029 decisions 8 to 11 and 14; ADR 0030; review `docs/plans/2026-10-24-shipping-review.md` (M-2 window, m-3 signal rule).

## Goal
A shop that sets `SHIPPING_PROVIDERS_ENABLED=nova_post` and `NOVA_POST_API_KEY` gets a real carrier behind `ShippingProviderPort`: city and branch/parcel-locker lookups for the storefront picker, an informational estimate, waybill creation, find-back after a lost answer (`reconcile`), cancellation, tracking by polling and a best-effort label, all through the new Nova Post REST API (`https://api.novapost.com/v.1.0`, JWT). Nothing in core or `apps/api` imports the plugin; deleting `packages/providers/nova-post` leaves everything green.

## Scope
**In:** `packages/providers/nova-post` (`@fluxkit/provider-nova-post`, code `nova_post`) implementing the whole port; three port changes (below) and every implementer and call site; the plugin's own environment parser; the settings validator wired to the admin settings route; a provider contract check in core shared by the fake and the plugin; the provider matrix; docs.
**Not done (later, own plans):** webhooks (ADR 0030 decision 5), international shipping and customs, cash on delivery and payment control (ADR 0029 decision 1), courier pickups and registers, delivery to an address (`addressParts`, unverified: an `address` destination answers `not_supported`), several parcels, returns, redirects, the offline division dictionary sync, a server-side text search of divisions (see Risks, big cities), the Ukrainian `api.novaposhta.ua/v.1.0` endpoint.

## Existing functionality found
- Port `packages/core/src/shipping/provider-port.ts` (with `findPickupPoint`, `findWaybill(WaybillLookup)` instant window since review M-2); helpers `providerOk`, `providerFailure` (codes must match `CARRIER_CODE_PATTERN`), `SHIPPING_PROVIDER_TIMEOUTS_MS` (lookup 5 s, estimate 5 s, waybill 15 s), `SHIPPING_LIMITS` (100 tracking numbers per call), `CARRIER_REFERENCE_PATTERN` (a uuid and a 14-digit number both fit).
- Reference implementation `packages/providers/_fake` (manifest, `providerModule`, tests); in-repo test carrier `apps/api/src/test/test-shipping-provider.ts`; loader and registry `apps/api/src/shipping/registry` (the registry checks every port method and the six capabilities at startup).
- Shipments service: `cancelWaybill` already gets `shipment.provider_ref` (for Nova Post: the shipment uuid of the create answer, H24, H28: delete by id only), `track` gets `shipment.tracking_number` (the 14-digit number); the label route passes `provider_ref` only (Nova Post prints by NUMBER: port change 1).
- Admin settings: a bounded plain-object check without provider validation (`apps/api/src/shipping/admin/provider-settings.ts`; HANDOFF "Shipping step 5 gaps").
- Spike tool `scripts/spikes/nova-post-verify.mjs`: the verified request shapes (create body, `numbers[]`/`ids[]` built by `URLSearchParams`, raw JWT header, `type=marking`).
- zod `4.6.7` is pinned in `packages/core` and `packages/config`: the plugin uses exactly that version (no new package in the lockfile; a new importer only).

## Evidence used (besides the shipping plan's section 8 and its production run)
**Rerun on production, 2026-10-25 21:50 UTC** (run by the orchestrator; findings files kept outside the repository, facts copied here and into the shipping plan, section "Rerun 2026-10-25 21:50 UTC"):
| H | Result |
|---|---|
| H12 | `GET /divisions?settlementIds[]=` works: Kyiv (settlement `118064` in the run) has 8 031 working divisions: `Postomat` 7 387, `PostBranch` 393, `CargoBranch` 35, `PUDO` 211; pages do not overlap |
| H13 | `id` integer, `number` a string such as `"11/298"`, `externalId` uuid, `maxWeightPlaceRecipient` a number; also `name`, `shortName`, `address`, `fullAddress`, `settlement`, `countryCode`, `status`, `prohibitedIssuance` |
| H14 | DIFFERENT: division `name` and `address` are Cyrillic with `Accept-language: en` too; only the nested settlement name follows the language |
| H15 | divisions: `limit` up to 101 (`500` is `422`); settlements: up to 100; use 100 everywhere |
| H16 | DIFFERENT: an undocumented `ids[]=<id>` filter answers exactly that division (`total 1`); `id=` is ignored (whole country) |
| H18 | `POST /shipments/calculations` answered `422 "Contact Sender contains less than 2 words"` (the spike sent no sender name): domestic pricing still never answered `200` |
| H25 | `GET /shipments/tracking?numbers[]=` answers `{items: [{currentStatus: {number, statusCode: 1 (a JSON number), statusDate (ISO UTC), ...}, detailsTracking: [{code: "1" (a string)}], ...}]}`; the documented shape is `{currentStatus: [...]}` |
| H27 | DIFFERENT: the label request in the documented form (`numbers[]=<number>&type=marking`, also with `&format=pdf`) answers `422 {"errors": {"errorMessage": "Internal Server Error"}}`; no PDF seen yet |
| other | An invented number: tracking `404 "Shipments not found"`, history `404 "not_found"`, print `404 "shipments not found"`; 10 calls in a row all `200`, no rate-limit header |

## Port changes (internal contract; justification)
1. **`fetchLabel` input gains `trackingNumber`** (`{providerRef, trackingNumber, format: "pdf"}`): Nova Post prints by the waybill NUMBER (`GET /shipments/print?numbers[]=`), and a lookup by id first would add a call to every print. The API passes `shipment.tracking_number` (a label is offered only for a shipment with one). The fake and the test carrier check that the number belongs to the ref.
2. **`track` may ignore `phones`** (type unchanged, documented): Nova Post's tracking takes numbers only; the API keeps passing the recipients' phones for carriers that use them.
3. **New member `validateSettings(settings): readonly ProviderSettingsIssue[]`** (`{path, code}`; empty = acceptable), synchronous and pure: the admin route `PUT /admin/shipping/providers/{code}/settings` runs the generic bounded check first, then the provider's, and answers `400 validation_failed` with `settings.<path>` and the provider's code (closes the step 5 gap "no settings validator"). The API checks the answer's shape (an array of at most 50 issues, paths of letters, digits, `_` and `.`, codes by `CARRIER_CODE_PATTERN`); a malformed answer or a throw is a provider bug (`500`, logged by class name). The fake accepts every object; the plugin also re-validates when it uses the settings (stored settings may predate the plugin).
4. **No "key configured" probe:** the plugin refuses to start enabled without its key, so an enabled `nova_post` always has one; "Test connection" checks that it works.
5. **`findPickupPoint` unchanged:** the plugin uses `GET /divisions?ids[]=<id>` (H16, undocumented but observed). It accepts the answer only when it holds exactly one division with that id, else it throws (unavailable) and never picks another point; `total 0` is `null`. A refs-only alternative (a composite `<settlementId>-<divisionId>` ref) was rejected: the order snapshot and the waybill would carry a ref the carrier does not know, and resolving it means paging a whole city (Kyiv: 81 pages).
6. **Contract check in core** (`checkShippingProviderContract`, pure, no test framework): runs a scenario against any provider and returns the violations; the fake's and the plugin's specs run it (ADR 0029 decision 9, "a reusable contract test suite").

## Mapping (per operation)
| Port | Route | Rules |
|---|---|---|
| `checkConnection` | fresh `GET /clients/authorization?apiKey=` (cache bypassed), then `GET /divisions?countryCodes[]=UA&limit=1` | `422`/`401` on authorization and `401` after a fresh token: `invalid_credentials`; else the common mapping |
| `searchCities` | `GET /settlements?countryCodes[]=UA&textSearch=<q>&limit=<min(limit,100)>` with `Accept-language` `uk` or `en` (H11: without it names are Latin; `uk*` -> `uk`, else `en`) | `ref` = `String(id)`; `region` = `"<region>, <parent region>"` (district, oblast; the many same-named villages need both) or the one that exists |
| `listPickupPoints` | `GET /divisions?countryCodes[]=UA&settlementIds[]=<id>&divisionCategories[]=...&limit=100&page=n`, `Accept-language: uk` | `branch` = `PostBranch` + `CargoBranch`; `locker` = `Postomat`; `PUDO` (partner points) not offered in v1 (whether a domestic waybill may name one is unverified); `prohibitedIssuance: true` skipped; branches are read first, then lockers; at most 15 pages per call (1 500 points), 4 pages in flight; a cut list is logged (counts only); `maxWeightGrams` = `maxWeightPlaceRecipient`; `description` = `name, address` cut to 200 code points; a ref that is not digits answers `[]` without a call |
| `findPickupPoint` | `GET /divisions?ids[]=<id>` | port change 5; a `PUDO` point or one with `prohibitedIssuance` is `null` (not offered) |
| `estimate` | `POST /shipments/calculations` (payer from settings, one parcel from the request or the settings' default, sender name, phone and division from the settings, recipient division = the pickup point) | only a `pickup_point` destination (a city or an address is `not_supported`); only when the declared value is `UAH` (the answer names no currency: H18; anything else `not_supported`); sum of `services[].cost` read as hryvnias with `parseDecimalString` (more than 2 decimals or a non-finite number: `rejected`); UNVERIFIED end to end (never answered `200`); any failure becomes `estimate: null` in the store |
| `createWaybill` | `POST /shipments` | body as the verified spike body: `status: "ReadyToShip"`, `clientOrder` = our order number, `note` = description, `payerType` `Sender`/`Recipient`, one parcel (`cargoCategory: "parcel"`, `parcelDescription`, `insuranceCost` = declared value in whole hryvnias rounded UP (integers verified, H35), `rowNumber: 1`, mm, grams), inline `sender` from the settings and `recipient` (`"<first> <last>"`, phone normalized to `380XXXXXXXXX`, `divisionId` = the point), `payerContractNumber` when set and the payer is the sender; `pickup_point` only (an address is `not_supported`); answer `id` -> `providerRef`, `number` -> `trackingNumber`, `cost` -> `carrierCost` (hryvnias, `UAH` only), `scheduledDeliveryDate` -> the Kyiv calendar date |
| `findWaybill` | `GET /shipments?limit=100&page=n` | newest first (H23): match `clientOrder` and `createdAt` inside `[createdAfter, createdBefore]`; stop early only when a page is sorted newest first and its oldest row is older than `createdAfter`, or at `last_page`; at most 10 pages, then `unavailable` (`scan_limit`), never `null`; two matches: `rejected` (`ambiguous_reference`); a window that is not two ordered instants: `rejected` (`invalid_window`); a deleted shipment is not listed (spike) and so not found |
| `cancelWaybill` | `DELETE /shipments/<uuid>` | `200` and `422 shipment_was_deleted`: done; `404 shipment_not_found`: `rejected`; other `422`/`403`: `rejected`; a ref that is not a uuid: `rejected` without a call |
| `track` | `GET /shipments/tracking?numbers[]=...` (at most 100 per call, `SHIPPING_LIMITS`) | reads `items[].currentStatus` as an object or a one-element array (and the documented top-level `currentStatus[]`); `statusCode` number or digit string -> string; `statusDate` -> `carrierStatusAt`; `404` (no number known) -> `[]`; `phones` ignored |
| `fetchLabel` | `GET /shipments/print?numbers[]=<number>&type=marking` (`Accept: application/pdf, application/json`) | `200` + `application/pdf` + `%PDF-` + at most 10 MiB: ok; `404`: `rejected`; `422` (production's "Internal Server Error"), `429`, `5xx`, network: `unavailable`; never a made-up PDF |

**Status mapping** (TDD; the docs' table, [tracking](https://api-portal.novapost.com/methods/methods/shipments/tracking-shipment.md); only `1` and `2` were observed, H25; every other code is UNVERIFIED):
| Codes | Normalized |
|---|---|
| `1` Ready to send | `created` |
| `2` Deleted | `cancelled` |
| `4`, `5`, `6`, `13`, `16`, `17`, `19`, `30`, `31`, `80`, `81`, `101`, `104`, `110`, `111`, `112`, `114` to `116`, `119` to `128`, `133` to `135`, `138`, `197` to `199` (accepted, moving, at sorting or customs, with the courier, redirecting, delayed) | `in_transit` |
| `7` at the division, `8` at the postomat | `arrived` |
| `9` closed, `10`, `11` closed with money transfer | `delivered` |
| `102` return ordered, `103` refusal, `131` return of uncleared cargo, `132` preparing for return | `returning` |
| everything else (`99`, `105`, `106`, `113`, `117`, `118`, `130`, `141`, `144`, `149`, `155`, `999`, unknown codes) | `null` (the shipment keeps its status; the raw code is stored) |
`returned` has no code: never reported. A carrier move the status machine refuses (`in_transit` -> `cancelled`) is logged and ignored by the API, as today.

## Configuration (plugin-owned; red zone: config schema)
- `NOVA_POST_API_KEY`: required when `nova_post` is enabled; 16 to 512 visible ASCII characters without spaces (the real format is not documented). Missing or malformed: the module factory throws at startup with a message that names the variable, never the value. Never logged, never stored, never in an answer; it travels only in the query of `GET /clients/authorization`, whose URL is never logged.
- `NOVA_POST_ENVIRONMENT`: `sandbox` (default when unset or empty) or `production`; anything else stops the startup. Selects one of two base-URL constants (`https://api-stage.novapost.com/v.1.0`, `https://api.novapost.com/v.1.0`); no URL variable (no SSRF). Production must be written explicitly. The provider logs its environment once at startup.
- Both are parsed by the plugin (`parseNovaPostEnv`), not by `loadEnv` (ADR 0029 decision 8: each plugin parses its own variables); listed in `.env.example`, `docs/contracts/config.md`, `packages/providers/README.md`, the plugin README; the owner adds them to AGENTS.md section 1.

## Settings (the sender profile, validated by the plugin)
`senderName` (1 to 100 characters, at least two words: H18 "Contact Sender contains less than 2 words"), `senderPhone` (`380` + 9 digits), optional `senderEmail` (max 100), optional `senderCompanyTin` (8 to 20 digits) and `senderCompanyName` (1 to 100; both or neither), `senderDivisionId` (positive integer: the division where parcels are handed in, from `GET /divisions`, never `externalId`), `payerDefault` (`Sender` or `Recipient`, used by the estimate; a waybill uses the admin's choice), optional `payerContractNumber` (2 to 20 characters, non-cash payment by the sender), `defaultParcel` (`weightGrams`, `lengthMm`, `widthMm`, `heightMm`: positive integers; used by the estimate). Unknown keys are refused. No secret: the API's generic guard still refuses credential-like keys.

## Network rules
- Node 22 `fetch`, `redirect: "error"`, no cookies; `Authorization: <jwt>` raw (H04: `Bearer` is `401`); `Accept: application/json` (labels `application/pdf, application/json`); query strings built by `URLSearchParams` with `name[]` (verified on production).
- **Timeouts:** the API's `AbortSignal`, combined with a per-request ceiling equal to the core constant of the operation (`SHIPPING_PROVIDER_TIMEOUTS_MS`: lookups and estimates 5 s, waybill calls 15 s), so a missing signal cannot hang a call.
- **JWT:** in memory per process; valid until `exp` minus 5 minutes (H03: `exp - iat` = 3 600 s), 50 minutes when the token has no readable `exp`; one authorization in flight at a time (single flight; callers wait with their own signal; the authorization request has its own 5 s limit, so one caller's abort does not fail the others); a `401` on a read or a delete invalidates that token and retries the call ONCE with a fresh one; a second `401` is `invalid_credentials`. **A create is never retried** (no idempotency, H22): its `401` clears the token and answers `invalid_credentials` (the token is checked before the body, 8.6), so the shipment is `failed` and the admin may create again.
- **Size caps** before parsing (`content-length` first, then counted while reading): settlements 1 MiB, divisions 2 MiB per page (390 KB seen for 100), shipments list 4 MiB per page, tracking 1 MiB, label 10 MiB (the API's cap), authorization and the rest 256 KiB. Over the cap: `unavailable` (`too_large`).
- **Errors:** status first. `401` -> refresh once, then `invalid_credentials`; `422` on authorization -> `invalid_credentials`; `429` -> `unavailable` (`429`; `Retry-After` is not passed on: the API decides retries; job 8 backs off); `5xx`, timeout, network, a too large or malformed answer -> `unavailable`; other `4xx` -> `rejected`; route-specific exceptions in the mapping table. `providerCodes` = the HTTP status, then the error KEYS that fit `CARRIER_CODE_PATTERN` (`parcels.0.actualWeight`), then `errorMessage` values only when they are snake_case codes (`shipment_was_deleted`); never free text; at most 10.
- **Malformed answers** (zod schemas per answer, objects loose, the fields used strict): lookups throw a typed `NovaPostCallError` (message without carrier text); result operations answer `unavailable` (`malformed_answer`) so a create with an unreadable `201` becomes `unknown` and is reconciled, never `failed`.
- **Rate limits:** unknown numbers (H08); the API's gate (4 calls in flight per provider and process) plus the plugin's 4 pages in flight inside one list call; `429` is `unavailable`.

## Idempotency stance
None exists (H22: a repeat create makes a second shipment). The plugin never repeats `POST /shipments` (no retry on `401`, timeout, `5xx` or a malformed answer); a lost answer is the API's `unknown` + `reconcile` through `findWaybill`. The order number goes into `clientOrder` (9 characters, max 50).

## Logging and secrets
- The plugin logs (Nest `Logger`, context `NovaPost`): the operation, the HTTP status or the failure kind, the codes and the duration; the environment once at startup; a cut point list (counts). Never the key, the JWT, a URL with a query, a request or response body, a name, a phone, an email or a carrier text.
- Errors thrown by lookups carry a fixed message (operation and reason) and no cause with carrier text.
- Tests capture the log and every thrown message and assert that the key, the JWT and the personal values of the fixtures never appear.

## Test strategy (no network)
- **No-network guard:** a Vitest setup file replaces `globalThis.fetch` with a wrapper that refuses (and records) any URL whose host is not `127.0.0.1`; an `afterAll` fails the suite when anything was refused; a static spec asserts the plugin's sources import no `node:http`, `node:https`, `node:net` or `node:tls` and name no host except the two constants.
- **Local stub HTTP server** on `127.0.0.1` (Node `http`, tests only) serving hand-written fixtures with invented ids, numbers, uuids and placeholder names (shapes from the findings above; no copied carrier data); it records method, path, query, headers and body of every request.
- **Units:** env parsing; settings validator; status mapping table (TDD); JWT cache (expiry from `exp`, margin, single flight, one retry on `401`, no retry on create); error mapping per status (401, 403, 404, 422, 429, 5xx, timeout, network, too large, malformed); each operation's request shape equals the verified spike shape (paths, `numbers[]`, `ids[]`, `type=marking` not `type[]`, raw JWT, no `Bearer`, the create body); `findWaybill` paging (found on page 2, window honoured on both sides, early stop, max pages -> failure, ambiguous, invalid window); label typed failures; log capture.
- **Contract:** `checkShippingProviderContract` (core) run against the fake and against the plugin on the stub.
- **Mutation checks** (one at a time, reverted): `Bearer` header; the `findWaybill` window ignored; an automatic retry of the create on `401`; one row of the status table changed.
- **API side:** the existing shipment and settings specs stay green; new specs for the label route passing the number and the settings route using a provider's validator (the in-repo test carrier gets a settings hook).
- **Matrix:** `providers-deleted` removes `_fake` AND `nova-post`; new mode `providers-nova-post`: enabled without a key refuses to start (message names `NOVA_POST_API_KEY`), with an invented key it starts, logs `Shipping providers loaded: nova_post` and makes no network call at startup (the JWT is fetched on first use).

## Docs
`packages/providers/nova-post/README.md` (purpose, flag, variables, settings, mapping, limits, removal), `packages/providers/README.md`, `docs/files/providers.md`, `docs/files/core.md` (contract check), `docs/files/api.md` if a file changes role, `docs/api/shipping.md` (provider codes, settings validation, label by number), `docs/contracts/config.md`, `.env.example`, `CHANGELOG.md`, `docs/HANDOFF.md`, the shipping plan (step 7b row, status line, the rerun facts), `scripts/feature-matrix.sh` header and the CI matrix list, `docs/api/openapi.json` if the settings route description changes.

## Risks
- **Big cities:** Kyiv has 8 031 points (mostly 7 387 lockers); a city list is read within the 5 s lookup limit, so the plugin reads branches first and at most 15 pages: all branches but only part of the lockers of the largest cities appear in the picker (the cut is logged). A locker that is not listed can still be used if its id reaches the checkout (`findPickupPoint`). Better: a server-side text search or the offline dictionary (own plan).
- **Undocumented `ids[]`** (H16) may change; the plugin then fails closed (never another point) and the checkout answers `503` for points not in the cache.
- **Labels:** production answers `422 "Internal Server Error"` for the documented request; the label route answers `503` until Nova Post fixes it or the owner learns the right request (a rerun with the owner's go).
- **Estimate** never answered `200`; amounts are read as hryvnias (the create answer's integer `cost` suggests whole hryvnias; unverified).
- Status codes other than `1` and `2` are unverified; a wrong mapping can only move a shipment within the status machine (the order never changes).
- No rate-limit numbers; the tracking job sends up to 100 numbers per call (H26 unknown).
- Billing of production shipments (H33) and a UA sandbox key (H34) are open owner questions.

## Verification
`pnpm install --frozen-lockfile`, `lint`, `format:check`, `typecheck`, `check:boundaries` (plus a deliberate static import of the plugin from `apps/api` shown failing), `check:licenses`, `check:docs`, `audit:prod`, `build`, full `pnpm test` on a scratch `*_test` database, `openapi:export` freshness, `feature-matrix.sh` `on`, `off`, `providers-on`, `providers-off`, `providers-nova-post` locally and `providers-deleted` with `CI=true` on a throwaway clone, `pnpm test:e2e` on a `*_e2e_test` database. Never a call to the real Nova Post API; the key is never asked for or stored.

## Red-zone items and approvals
| Item | Approval |
|---|---|
| New package `packages/providers/nova-post` (no new third-party dependency; zod `4.6.7` as already pinned) | Shipping plan owner answers (quiz 2026-10-24) 1 (the carrier plugin is in v1) and 13 (provider loader); "Needs approval" items 6 (zod for the provider package) and 9; ADR 0030 decisions 1 to 3 (package and code names) |
| New variables `NOVA_POST_API_KEY`, `NOVA_POST_ENVIRONMENT` | Owner answer 6 (secrets in the environment only); "Needs approval" item 4 (the ADR 0030 names, "added in step 7b with approval"); ADR 0030 decision 2 |
| Port changes 1 to 3 and the contract check | ADR 0030 Consequences ("Port changes proposed for 7b (internal contract, approval with 7b)"): the orchestrator's 7b assignment of 2026-10-25 names exactly these; the port is internal (not in `docs/contracts/`) |
| CI matrix mode `providers-nova-post` | "Needs approval" item 7 (the provider matrix job) |
| AGENTS.md | Not touched; the owner adds the lines listed in HANDOFF (section 1: the variables, the plugin) |

## Outcome (2026-10-25)
- Built as planned: the package, port changes 1 to 3 with every implementer (core spec, fake, the in-repo test carrier, the registry, the label call site, the admin settings route), the core contract check run by the fake and the plugin, the matrix mode, the docs. No deviation from the mapping above.
- TDD: the status table spec ran red first (46 of 64 failing against an empty table), then green.
- Mutation checks (one at a time, restored): `Bearer` header (30 specs fail), `findWaybill` ignoring the window (1 fails), the create retried on `401` (1 fails), code `8` mapped to `in_transit` (2 fail). A deliberate static import of the plugin from `apps/api` and from `packages/core` fails `check:boundaries` (3 violations).
- Verified locally: install (frozen lockfile), lint, format, typecheck, boundaries, licenses, docs check, production audit, build, full `pnpm test` (the plugin 128 tests; a first run had one storefront spec time out at 5 s under load, unrelated and green alone and on the rerun), `openapi:export` (the settings route description), matrix `on`, `off`, `providers-on`, `providers-off`, `providers-nova-post`, and `providers-deleted` on a throwaway clone, `pnpm test:e2e`.
- Not verified: anything against the real Nova Post API (no call was made; the key was never asked for). Open for the owner: a live run with a real order (label, estimate, status codes), a Ukrainian sandbox key, billing of production shipments.
