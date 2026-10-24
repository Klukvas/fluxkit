# @fluxkit/api-client

Typed clients for the public store API (`/store/*`, `createStoreClient`) and the admin API (`/admin/*`, `createAdminClient`). Thin `fetch` wrappers
with no runtime dependency. The storefront uses the store client (browser: `baseUrl` `""`, same origin; Next server: `API_INTERNAL_URL`); the admin SPA
uses the admin client (`baseUrl` `""`, same origin, ADR 0027). Plans: `docs/plans/2026-10-18-storefront.md` (ADR 0026), `docs/plans/2026-10-19-admin-ui.md` (ADR 0027).

## Use

```ts
import { createStoreClient } from "@fluxkit/api-client";

const store = createStoreClient({ baseUrl: "" }); // browser; on the server pass the API origin (loadStorefrontEnv().apiInternalUrl)

const cart = await store.getCart({ locale: "uk" });
if (cart.ok) cart.data.requiresShipping; // typed
else cart.problem.code; // "cart_changed" | "validation_failed" | ...

const placed = await store.checkout(body, { idempotencyKey: crypto.randomUUID() });
if (!placed.ok && placed.status === 429) placed.retryAfter; // header value in seconds, or null
```

- One function per operation (`OPERATIONS` in `src/operations.ts`); each returns `{ ok: true, status, data }` or `{ ok: false, status, problem, retryAfter }`.
  `problem` is the parsed `application/problem+json` (`code`, `errors[]`, `rule`, and the fresh `cart` of `cart_changed`). `retryAfter` is the raw `Retry-After` header (429, 503), else `null`.
- **Thrown, never swallowed:** `InvalidRequestError` (bad base URL, missing path parameter, missing or unsafe idempotency key; nothing was sent), `NetworkError` (`fetch` rejected or aborted; `aborted` tells which; the request may have reached the API, so a checkout is retried with the SAME key), `InvalidResponseError` (a proxy's HTML page, a wrong content type, invalid JSON, an undocumented status). There are no retries and no fallback values.
- Every request that is not GET or HEAD carries `X-Fluxkit-CSRF: 1`; `Content-Type: application/json` is sent exactly when there is a body; `credentials: "same-origin"`. `checkout` requires `idempotencyKey` (1 to 255 visible ASCII characters) and sets `Idempotency-Key`.
- The guest order access token goes only in the POST body of `lookupOrder` and `cancelOrder`, never in a URL or header (ADR 0026). The client never logs, and error messages name the operation (`POST /store/checkout`), not bodies, URLs or tokens.
- `fetchOptions` passes extra options to `fetch` (for example Next's `{ next: { revalidate: 60 } }` for cached catalog reads); it cannot change method, headers, body or credentials.

## Admin client

```ts
import { createAdminClient } from "@fluxkit/api-client";

const admin = createAdminClient({ baseUrl: "" }); // the SPA and the API share one origin

const signedIn = await admin.login({ email, password }); // sends X-Fluxkit-CSRF: 1 too, the cookie is HttpOnly
const me = await admin.getMe(); // me.ok && me.data.permissions: ("catalog.read" | ...)[]

const page = await admin.listProducts({ q: "shirt", status: "draft", limit: 20, offset: 0 });
const saved = await admin.updateProduct(id, { slug: "new-slug" }); // PATCH: send changed fields only
if (!saved.ok && saved.problem.code === "validation_failed") saved.problem.errors; // [{ path, code, message? }]
```

- **100 functions, one per `/admin` operation** (`ADMIN_OPERATIONS` in `src/admin-operations.ts`: method, path, success statuses, query parameters, body kind (`none`, `json` or `binary`), response kind (`json`, or `pdf` for the shipment label) and the `permission` from the OpenAPI extension `x-fluxkit-permission`: a permission name, `authenticated`, `public` or `denied`). Arguments: path parameters in URL order, then the body, then the options. Options carry the typed filters of the operation (`AdminListProductsOptions`: `q`, `brandId`, `categoryId`, `status`, `limit`, `offset`; `AdminListOrdersOptions`: `customerId`, `q`, `status`, `placedFrom`, `placedTo`, ...), `signal` and `fetchOptions`; only the query names of the operation are serialized.
- **Same transport as the store client** (`src/transport.ts`, which uses `buildRequest` and `parseResponse` unchanged): `X-Fluxkit-CSRF: 1` on every request that is not GET or HEAD (the sign-in included), `Content-Type: application/json` exactly when there is a JSON body (the upload sends `application/octet-stream` instead, see below), `credentials: "same-origin"`, path parameters encoded (`.`, `..` and empty values refused before sending), the same result union (`AdminResult<T>` is `StoreResult<T>`) and the same thrown errors (`InvalidRequestError`, `NetworkError`, `InvalidResponseError`).
- **Never a retry, never a replay.** One `fetch` per call, whatever the answer: a network failure, a `5xx`, a `401` after the session ended or a `429` is returned or thrown once, and the caller decides (the SPA shows a re-sign-in dialog and does not replay the failed save, ADR 0027 decision 8; a stock adjustment is reloaded, not repeated). The client has no idempotency header: the admin API has none.
- **`uploadMedia(bytes, options?)`** (`POST /admin/media/uploads`, `catalog.write`, ADR 0028) is the one operation with a binary body (`bodyKind: "binary"`). `bytes` is a `Blob` (a `File` included), an `ArrayBuffer` or a `Uint8Array`; anything else throws `InvalidRequestError` before a request is made. The bytes are passed to `fetch` untouched with `Content-Type: application/octet-stream` (never the `File`'s own type: the server decides the type by content), plus the usual `X-Fluxkit-CSRF: 1`; `Content-Length` is left to `fetch`, and a caller header cannot replace the content type, the CSRF header or the length. The transport accepts raw bytes only for an operation whose kind is `binary` and refuses them (and a JSON body on the upload) for every other, so the JSON rules of all other requests are unchanged. It returns `AdminMediaUpload` (`{id, url, contentType, byteSize, width, height, createdAt}`, the stored output) or a problem value: `400 validation_failed` with a reason in `errors[0].code` (`empty_file`, `unsupported_type`, `corrupt_image`, ...), `411`, `413`, `429`, and the new codes `storage_unavailable` and `uploads_disabled` (both `503`). It is never retried: an upload is not idempotent, and a lost answer leaves one unattached file that the server cleans up. Pass `signal` in the options to cancel (`NetworkError.aborted` is then `true`). **There is no upload progress:** `fetch` exposes none for a request body, so the client does not invent one (a progress bar would need `XMLHttpRequest`, which this package does not use); show an indeterminate state and offer cancel.
- **Shipments** (shipping plan step 8, ADR 0029 decision 10; `orders.read` / `orders.write`): `listShipments(id)`, `createShipment(id, body)` (`201 {shipment, failure}` whatever the carrier did: `shipment.status` `created`, `failed` with `failure`, or `unknown` when the carrier's answer was lost; then call `reconcileShipment`, **never `createShipment` again**), `reconcileShipment`, `cancelShipment` and `refreshShipment(id, shipmentId)`. Carrier failures come back as `503 shipping_provider_unavailable` (with `retryAfter`) or `409 rule_violation` `carrier_*`, both with `problem.reason` and `problem.providerCodes`. Like every write, none is retried.
- **`getShipmentLabel(id, shipmentId)`** is the one operation whose success is a file (`responseKind: "pdf"`): it sends `Accept: application/pdf, application/problem+json` and returns the PDF as a `Blob`; a success answer that is not `application/pdf` (a proxy's HTML page) throws `InvalidResponseError`, a problem answer is a problem value as usual. A browser may instead open the route itself as a download (a `GET` with the session cookie, no CSRF header).
- `AdminConfig.media` (`{uploadsEnabled, maxBytes, contentTypes}`) mirrors the server's upload limits so the SPA can check a file's size before sending and hide the controls when uploads are off.
- Types are hand-written in `src/admin-types.ts`, named after the domain with the `Admin` prefix where the store client has a type of the same concept (`AdminProduct`, `AdminVariant`, `AdminOrder`, `AdminConfig` with `supportedCurrencies: {code, exponent}[]`, `AdminReservation`, `AdminPrice`, `AdminVariantInventory`, `AdminProductTypeDetail` with the embedded attribute, ...). Money is an integer in minor units, ids are strings, instants are ISO 8601 strings. `JsonObject` (`attributes`, attribute `validation`) is any JSON; the API validates it against the attribute definition.
- **Bundle:** the entry re-exports the admin client, so `package.json` declares `"sideEffects": false` and no store module imports an admin module (`src/bundle-boundary.spec.ts` checks both). Measured on 2026-10-19 with `next build` of `apps/storefront` (Turbopack), first-load JS before and after this change: `/[locale]/cart` 525526 to 525624 bytes, `/[locale]/catalog` 512370 to 512468, `/[locale]/checkout` 521699 to 521797 (+98 bytes raw, +2 bytes gzip, the shared transport); without the flag the same build grew by 6360 bytes and shipped the operation table. A subpath export (`@fluxkit/api-client/admin`) was not needed and would need a dependency-cruiser rule change.

## Why the types are hand-written

The plan proposed generating types from `docs/api/openapi.json` with `openapi-typescript`. It is not used. Facts checked on 2026-10-18:

| | |
|---|---|
| Version | 7.13.0 (latest; every 7.x release declares the same peer range) |
| Peer range | `typescript: ^5.x`, which excludes the pinned TypeScript 6.0.3 (AGENTS.md section 1: changing the pin is a red-zone decision) |
| License | MIT (its dependency tree: 26 MIT, 3 ISC, 1 Apache-2.0, 1 MIT OR CC0, 1 Python-2.0 (`argparse`)) |
| Size | 858 KB unpacked, 32 packages with transitive dependencies |
| Alternatives | none that remove the TypeScript constraint without a new dependency |

The owner's condition was to stop in that case and use the plan's fallback, which is what this package does: hand-written types in `src/types.ts` and `src/admin-types.ts` plus tests that compare them with the OpenAPI document. No generator, no generated files, no new dependency (only `vitest` and `@types/node` at the versions the other packages already pin, as devDependencies).

## How drift is caught

- `src/contract.spec.ts` (store) and `src/admin-contract.spec.ts` (admin) read `docs/api/openapi.json`. The store test fails when: a store operation is added, removed or renamed without a row in `OPERATIONS`; method, path, success statuses, query parameters, path parameters, required headers (`X-Fluxkit-CSRF`, `Idempotency-Key`) or the request body differ; an error response stops being `application/problem+json`; or any type differs from its schema in keys, required keys, nullability, enums, array and union shape or primitive type (integer versus number included). The same test mutates a copy of the document to prove the comparison fails (type change, removed key, added key, required, nullable, enum, union).
- The admin test fails when an `/admin` operation of the document has no row in `ADMIN_OPERATIONS` or a row has no operation (adding an admin route without the client fails it), or when method, path, success statuses, query parameters, path parameters, the required `X-Fluxkit-CSRF` header (writes only), `x-fluxkit-permission`, the body kind (`none`, `json` or `binary`), the response kind (only the label answers `application/pdf`, checked against its `string`/`binary` schema), the content types or any request or response type differ. Request shapes are typed by the body parameter of the client function itself (`JsonBodyOf<N>`; the binary upload is checked against the `string`/`binary` schema), response shapes by what the function returns, so a type and its shape cannot drift apart. `JsonValue` fields are the shape `"any"`, which also requires the schema to be unconstrained.
- `pnpm typecheck` is part of the guard: the shapes are typed, so changing a type without its shape fails the compile step, not the Vitest run (Vitest does not type-check).
- The shapes in that test are typed `Shape<T>` (`src/testing/shape.ts`), so changing a type in `src/types.ts` stops the test from compiling until its shape follows; the client's return types feed `Shape` too (`pnpm typecheck` covers the spec files).
- When the API changes: change `docs/api/openapi.json` (`pnpm openapi:export`), `src/types.ts` and the shape in `contract.spec.ts` in the same commit; add the operation to `src/operations.ts` and `src/client.ts` (store) or `src/admin-operations.ts` and `src/admin-client.ts` (admin) if it is new, with its types in `src/types.ts` or `src/admin-types.ts`.
- Weaker than a generator in one respect: a field the document gains but the types lack fails the test, but nothing derives the type for you. The first run of the test found four mistakes in the first draft of the types (nullable `unitPrice` and `lineTotal` on unavailable cart lines, nullable order addresses, nullable product `brand`, numeric `status` in the problem body).

## Layout

See `docs/files/api-client.md`. Tests: `pnpm --filter @fluxkit/api-client test`.
