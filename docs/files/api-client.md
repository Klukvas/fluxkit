# packages/api-client

Typed client for the public store API. No runtime dependency. Details and the generator decision: `packages/api-client/README.md`.

- `src/index.ts` - the public exports (client, errors, `OPERATIONS`, types). Import only from here.
- `src/client.ts` - `createStoreClient({ baseUrl, fetch? })`: one function per store operation, the idempotency key check, network failures thrown as `NetworkError`. Must NOT parse responses itself or build URLs.
- `src/request.ts` - `buildRequest`: URL, path parameter and query encoding, `X-Fluxkit-CSRF: 1` on every non-GET/HEAD request, JSON content type only with a body, same-origin credentials. Pure and unit tested.
- `src/response.ts` - `parseResponse`: documented success to `{ ok: true }`, `application/problem+json` to `{ ok: false, problem, retryAfter }`, everything else thrown. Must NOT log or return a response body in an error.
- `src/errors.ts` - `ApiClientError` (base class), `InvalidRequestError`, `NetworkError`, `InvalidResponseError`.
- `src/operations.ts` - `OPERATIONS`: method, path, success statuses, query parameters and body flag of each store operation; checked against `docs/api/openapi.json`.
- `src/types.ts` - hand-written request and response types (`Cart`, `Order`, `ProblemDetails`, ...). Must stay equal to the OpenAPI schemas (the contract test enforces it).
- `src/testing/shape.ts` - test support (`Shape<T>`, `compareShape`); excluded from the build.
- `src/*.spec.ts` - unit tests (`request`, `response`, `client` with an injected `fetch`) and `contract.spec.ts` (types and operations versus `docs/api/openapi.json`).
- `tsconfig.build.json` - the build config; leaves out specs and `src/testing`.
