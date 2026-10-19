# packages/api-client

Typed clients for the public store API (`createStoreClient`) and the admin API (`createAdminClient`). No runtime dependency. Details and the generator decision: `packages/api-client/README.md`.

- `src/index.ts` - the public exports (both clients, errors, `OPERATIONS`, `ADMIN_OPERATIONS`, types). Import only from here.
- `src/client.ts` - `createStoreClient({ baseUrl, fetch? })`: one function per store operation and the idempotency key check. Must NOT parse responses, build URLs or import an admin module.
- `src/transport.ts` - `createTransport`: builds the request (`buildRequest`), sends it with exactly one `fetch` call, throws a rejected `fetch` as `NetworkError`, hands the answer to `parseResponse`; also `FetchLike` and `CallOptions`. Shared by both clients. Must NOT retry, replay or log.
- `src/admin-client.ts` - `createAdminClient({ baseUrl, fetch? })`: one function per `/admin` operation (85), typed filter options (`AdminListProductsOptions`, ...), `AdminResult<T>`. Must NOT parse responses, build URLs or import the store client.
- `src/admin-operations.ts` - `ADMIN_OPERATIONS`: method, path, success statuses, query parameters, body flag and `x-fluxkit-permission` of each admin operation; checked against `docs/api/openapi.json`.
- `src/admin-types.ts` - hand-written admin request and response types (`AdminProduct`, `AdminVariant`, `AdminOrder`, `AdminConfig`, ...). Must stay equal to the OpenAPI schemas (the admin contract test enforces it).
- `src/request.ts` - `buildRequest`: URL, path parameter and query encoding, `X-Fluxkit-CSRF: 1` on every non-GET/HEAD request, JSON content type only with a body, same-origin credentials. Pure and unit tested.
- `src/response.ts` - `parseResponse`: documented success to `{ ok: true }`, `application/problem+json` to `{ ok: false, problem, retryAfter }`, everything else thrown. Must NOT log or return a response body in an error.
- `src/errors.ts` - `ApiClientError` (base class), `InvalidRequestError`, `NetworkError`, `InvalidResponseError`.
- `src/operations.ts` - `OPERATIONS`: method, path, success statuses, query parameters and body flag of each store operation; checked against `docs/api/openapi.json`.
- `src/types.ts` - hand-written store request and response types (`Cart`, `Order`, `ProblemDetails`, ...); `Money`, `Address`, `OrderStatus`, `OrderContact` and `ProblemDetails` are shared with the admin types. Must stay equal to the OpenAPI schemas (the contract test enforces it).
- `src/testing/shape.ts` - test support (`Shape<T>`, `compareShape`; `JsonValue` is the shape `"any"`); excluded from the build.
- `src/*.spec.ts` - unit tests (`request`, `response`, `client` and `admin-client` with an injected `fetch`), `contract.spec.ts` and `admin-contract.spec.ts` (types and operations versus `docs/api/openapi.json`), and `bundle-boundary.spec.ts` (the admin modules stay out of the store client's import graph; `sideEffects: false`).
- `tsconfig.build.json` - the build config; leaves out specs and `src/testing`.
