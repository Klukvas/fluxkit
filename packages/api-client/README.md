# @fluxkit/api-client

Typed client for the public store API (`/store/*`). A thin `fetch` wrapper with no runtime dependency, used by the storefront
(browser: `baseUrl` `""`, same origin; Next server: `API_INTERNAL_URL`). No admin routes. Plan: `docs/plans/2026-10-18-storefront.md`, ADR 0026.

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

## Why the types are hand-written

The plan proposed generating types from `docs/api/openapi.json` with `openapi-typescript`. It is not used. Facts checked on 2026-10-18:

| | |
|---|---|
| Version | 7.13.0 (latest; every 7.x release declares the same peer range) |
| Peer range | `typescript: ^5.x`, which excludes the pinned TypeScript 6.0.3 (AGENTS.md section 1: changing the pin is a red-zone decision) |
| License | MIT (its dependency tree: 26 MIT, 3 ISC, 1 Apache-2.0, 1 MIT OR CC0, 1 Python-2.0 (`argparse`)) |
| Size | 858 KB unpacked, 32 packages with transitive dependencies |
| Alternatives | none that remove the TypeScript constraint without a new dependency |

The owner's condition was to stop in that case and use the plan's fallback, which is what this package does: hand-written types in `src/types.ts` plus a test that compares them with the OpenAPI document. No generator, no generated files, no new dependency (only `vitest` and `@types/node` at the versions the other packages already pin, as devDependencies).

## How drift is caught

- `src/contract.spec.ts` reads `docs/api/openapi.json` and fails when: a store operation is added, removed or renamed without a row in `OPERATIONS`; method, path, success statuses, query parameters, path parameters, required headers (`X-Fluxkit-CSRF`, `Idempotency-Key`) or the request body differ; an error response stops being `application/problem+json`; or any type differs from its schema in keys, required keys, nullability, enums, array and union shape or primitive type (integer versus number included). The same test mutates a copy of the document to prove the comparison fails (type change, removed key, added key, required, nullable, enum, union).
- The shapes in that test are typed `Shape<T>` (`src/testing/shape.ts`), so changing a type in `src/types.ts` stops the test from compiling until its shape follows; the client's return types feed `Shape` too (`pnpm typecheck` covers the spec files).
- When the API changes: change `docs/api/openapi.json` (`pnpm openapi:export`), `src/types.ts` and the shape in `contract.spec.ts` in the same commit; add the operation to `src/operations.ts` and `src/client.ts` if it is new.
- Weaker than a generator in one respect: a field the document gains but the types lack fails the test, but nothing derives the type for you. The first run of the test found four mistakes in the first draft of the types (nullable `unitPrice` and `lineTotal` on unavailable cart lines, nullable order addresses, nullable product `brand`, numeric `status` in the problem body).

## Layout

See `docs/files/api-client.md`. Tests: `pnpm --filter @fluxkit/api-client test`.
