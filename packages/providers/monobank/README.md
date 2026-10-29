# @fluxkit/provider-monobank

Monobank acquiring ("Plata by mono") payment provider, code `monobank`, kind `payment` (ADR 0032 decision 15; payments plan `docs/plans/2026-10-26-payments-monobank.md`, step 7). It implements `PaymentProviderPort` from `@fluxkit/core` over Monobank's merchant API with the shop's `X-Token`.

**Status: built and tested against a local stub only.** No request has ever reached Monobank (no token was available). Every Monobank behaviour below comes from the documentation; what it does not state is marked UNKNOWN or UNVERIFIED and is checked by the owner's live test S1 (below).

## Purpose, flag, extension points
- Enabled by putting `monobank` in `PAYMENT_PROVIDERS_ENABLED` (no other flag). It then needs `MONOBANK_TOKEN`.
- Extension point: the payment provider package contract (`docs/contracts/config.md`, "Payment provider package contract"): the manifest `"fluxkit": {"provider": "monobank", "kind": "payment"}`, the export `providerModule`, the class `MonobankPaymentProvider` marked `fluxkit:payment-provider`.
- No database table, no migration, no route of its own (the webhook route `POST /webhooks/payments/monobank` belongs to the core payments module, plan step 5).
- Removal: delete this folder and take `monobank` out of `PAYMENT_PROVIDERS_ENABLED` (CI `scripts/feature-matrix.sh providers-deleted` proves an API told to load it then refuses to start, and that everything else still builds and passes).

## Configuration

| Variable | Required | Rule |
|---|---|---|
| `MONOBANK_TOKEN` | when `monobank` is enabled | 20 to 256 visible ASCII characters, trimmed (Monobank documents no format: UNKNOWN, S1 may widen it). Read once by the module factory (`parseMonobankEnv`); a missing or malformed token stops the startup with a message that names the variable and never the value. Never logged, stored, returned or put in a URL. The token decides test or production (same host, M1, M2). |

There is no URL variable: the origin `https://api.monobank.ua` is a constant (`MONOBANK_API_ORIGIN`). `SHOP_CURRENCY` must be `UAH` (the registry refuses the startup otherwise: `capabilities.currencies` is `["UAH"]`). Nothing is sent to Monobank at startup; the webhook key is fetched on the first webhook.

## What it calls

| Port operation | Request | Body / query |
|---|---|---|
| `createPayment` | `POST /api/merchant/invoice/create` | `{amount, ccy: 980, merchantPaymInfo: {reference: <attempt id>, destination: <description>, basketOrder?}, redirectUrl, webHookUrl, validity, paymentType: "debit"}` |
| `getPayment` | `GET /api/merchant/invoice/status?invoiceId=<id>` | the id is the only query value |
| `invalidatePayment` | `POST /api/merchant/invoice/remove` | `{invoiceId}` |
| `refund` | `POST /api/merchant/invoice/cancel` | `{invoiceId, extRef: <our refund id>, amount}` |
| `verifyWebhook` (key) | `GET /api/merchant/pubkey` | only when no key is cached, or after a failed verification at most once per 60 s |

- Every request carries `X-Token` and `accept: application/json`; a `POST` also `content-type: application/json`. No `X-Cms` header (white-label), no `comment`, `customerEmails` or card-saving member (no personal data leaves the shop).
- `redirectUrl` and `webHookUrl` are built by the CALLER (the API, from `STOREFRONT_PUBLIC_URL`) and passed in; the plugin only checks they are `http(s)` URLs without credentials.
- `validity` = whole seconds from the plugin's clock to `expiresAt` (core `invoiceValidity`); less than 1 s or more than 30 days (M3: Monobank cuts longer ones) is refused before sending.
- `basketOrder` is built from the core basket lines (display only, PRRO not linked, ADR 0032 decision 1). It is OMITTED when the caller sends no lines (core answered `sum_mismatch`) and also when any line has no code, another currency, a total that is not unit x quantity, or the lines do not add up to the amount.
- `amount` is always sent on a refund, also for a full one (it pins what core accounted). UNVERIFIED that Monobank accepts an explicit full amount (the spec documents `amount` "for a partial refund"); S1 checks it.

## Transport rules
- Origin constant, `redirect: "error"` (no answer can send the token elsewhere); only a test may name a stub on `http://127.0.0.1:<port>` (`MonobankHttp` refuses anything else).
- Answers are read up to 64 KiB, counted while streaming and refused early by `content-length`, before parsing; zod schemas read them.
- The time limit is the caller's signal (the API aborts after `PAYMENT_PROVIDER_TIMEOUT_MS`); the plugin adds none and never retries or repeats a request.

## Answers

| Monobank answer | Result |
|---|---|
| create `2xx` `{invoiceId, pageUrl}` with `pageUrl` `https` on an allow-listed host | `ok {providerPaymentId, redirectUrl}` |
| create `2xx` whose `pageUrl` is on another host, scheme or port | `unavailable` `page_host_not_allowed` (the invoice may exist; nobody gets its page) |
| status `2xx` | `ok` fact (mapping below); about another invoice: `unavailable` `answer_mismatch`; unreadable: `unavailable` `malformed_answer` / `unsupported_currency` |
| remove `2xx` (documented empty) | `ok {invalidated: true}` (the body is not read) |
| cancel `2xx` `{status}` | `ok {status}`: `processing`, `success` -> `succeeded`, `failure` -> `failed`; another word: `unavailable` |
| any other unreadable `2xx` | `unavailable` `malformed_answer` (never a refusal: the invoice or refund may exist) |
| `400` with a documented `errCode` | `rejected` (`WRONG_CANCEL_AMOUNT` on a refund also means "already cancelled", which core settles from the refund list) |
| `400` without a documented code | `unavailable` `unnamed_error` |
| `403` (invalid token) | `misconfigured`; logged ONCE per process as an error naming `MONOBANK_TOKEN` |
| `405` | `misconfigured` |
| `404` with `NOT_FOUND` or `1004` | `not_found`; a `404` without a documented code: `unavailable` (never a false "no such invoice") |
| `429` (`TMR`) | `rate_limited`, with `retryAfterSeconds` when a `Retry-After` in seconds is sent (M17 UNKNOWN) |
| `500` `CANCEL_NOT_AVAILABLE` | `not_cancellable` |
| other `5xx`, `408`, any undocumented status | `unavailable` |
| timeout, network failure, refused redirect, answer over 64 KiB | `unavailable` (may have reached Monobank) |
| input refused locally, signal fired before the request | `not_sent` (provably nothing left the process) |

Codes are the documented `errCode` (first) and the HTTP status; `errText`, `failureReason` and undocumented codes are never kept (M16: "`errText` is informative only"). Documented codes (`MONOBANK_ERROR_CODES`, from the spec's error schemas): `BAD_REQUEST`, `1001`, `INVALID_MERCHANT_PAYM_INFO`, `ORDER_IN_PROGRESS`, `HOLD_INVOICE_NOT_FINALIZED`, `WRONG_CANCEL_AMOUNT`, `TOKEN_NOT_FOUND`, `FORBIDDEN`, `NOT_FOUND`, `1004`, `METHOD_NOT_ALLOWED`, `TMR`, `INTERNAL_ERROR`, `CANCEL_NOT_AVAILABLE`.

### Status answer (and webhook body) to core fact
- `status`: `created`, `processing`, `hold` -> `authorized` (unused in v1), `success` -> `succeeded`, `failure` -> `failed`, `reversed`, `expired`; any other short word -> `status: null` with `providerStatus` kept (core raises `unknown_provider_status`).
- `modifiedAt` = `modifiedDate`; when it is missing (the spec does not mark it required) `createdDate` (never later than a real change, so it cannot override a newer fact). Dates must be RFC 3339 with a zone.
- `reference` is required (every invoice we create carries the attempt id); `ccy` is mapped to the core currency (980 UAH, 840 USD, 978 EUR and the other core currencies); `finalAmount` when present.
- `cancelList[]` -> `refunds`: `refundId` = `extRef` when it is a short code (a cabinet refund has none: `null`), status as for the cancel answer, `amount` REQUIRED (the spec does not mark it so: UNKNOWN; a refund without an amount makes the whole answer unreadable rather than dropping a refund), `ccy` must equal the invoice's, at most 100 entries.
- `errCode` (payment error, M7) -> `failureCode` when it is a short code; `paymentInfo` -> `card` = `{system: paymentSystem, last4: last four digits of maskedPan}` only when both are well-formed. Never kept: `maskedPan`, `rrn`, `approvalCode`, `tranId`, `bank`, `fee`, `failureReason`, `destination`.

## Webhook verification (M8, M12)
1. Signal already fired: `not_sent`. Empty body: `invalid_signature` `empty_body`. Body over 64 KiB: `invalid_signature` `body_too_large`. Header `x-sign` (lower-case name) missing, empty, not base64 or not a DER SEQUENCE: `invalid_signature` `malformed_signature`. None of these calls Monobank.
2. The key comes ONLY from `GET /api/merchant/pubkey` with the shop's token (`{key}` = base64 PEM); it must be EC P-256 (else `unavailable` `invalid_key`, not cached). No header or body member can name or carry a key.
3. `crypto.verify("sha256", rawBody, key (DER), signature)` over the EXACT bytes received; the parsed JSON is never re-serialized.
4. With the cached key failing: one refetch if the last fetch started at least 60 s ago, then the new key if it differs; otherwise `invalid_signature` `signature_mismatch`. A failed fetch is throttled the same way (`unavailable` `key_unavailable` meanwhile). Concurrent webhooks share one fetch. Consequence: right after a key rotation, webhooks may be refused for up to 60 s; Monobank retries up to 3 times (M9) and job 11 reads the status anyway.
5. Only then is the body parsed and mapped as above; a verified body that cannot be read is `unavailable` (`malformed_answer`, `webhook`).

The documented example key and `X-Sign` are a fixed spec vector (`src/test-support/documented-example.ts`): they verify over the documented body (two-space indentation, closing brace in column 0; with the code-block indentation of the docs they do not), and a one-character change fails.

## Capabilities
`currencies: ["UAH"]` (question 6; M18 UNKNOWN), `partialRefunds: true` (M13 `amount`), `multipleRefunds: true` (`cancelList[]`, LIKELY, UNKNOWN in detail, M13), `invalidateUnpaid: true` (M14), `webhooks: true` (M8). Hold (`paymentType: hold`) is not used in v1.

## Logs
One warning per failure: `<operation>: <HTTP status | no answer | not sent> -> <reason> (<codes>) after <ms> ms`; a `403` once per process as an error naming `MONOBANK_TOKEN`. Nothing on success. Never the token, a body, a URL, `errText`, a card mask.

## Unverified items (S1)

| Item | What the plugin assumes | Fact |
|---|---|---|
| Page host of `pageUrl` | `https://pay.mbnk.biz` only (the host of every documented example) | M23 UNKNOWN |
| Create dedupe by `reference` | none; a create is never repeated by the plugin | M5 UNKNOWN |
| `extRef` dedupe of a refund | none assumed; a lost refund answer is never resent (core reads `cancelList`) | M13 UNKNOWN |
| Several partial refunds | allowed (`multipleRefunds: true`) | M13 LIKELY |
| Explicit `amount` on a full refund | accepted | UNVERIFIED |
| Status after partial / full refunds | partly refunded stays `success` with a lower `finalAmount`; full may become `reversed` | ADR open question 6 |
| `cancelList[].amount` always present | required by the plugin | spec does not mark it required |
| `modifiedDate` always present | falls back to `createdDate` | spec does not mark it required |
| `Retry-After` on `429` | passed on in seconds when present | M17 UNKNOWN |
| Minimum `validity` | none enforced beyond 1 s | M19 UNKNOWN |
| Webhook retries, intervals, other 2xx | the API answers exactly `200` | M9 partly UNKNOWN |
| A test token answers `pubkey` and `details` | `pubkey` is used for webhooks | open question 11 |
| `invoiceId` alphabet | `^[A-Za-z0-9_.-]{1,64}$` (core `PROVIDER_PAYMENT_ID_PATTERN`; the example is `p2_9ZgpZVsl3`) | checked at S1 |
| Token format | 20 to 256 visible ASCII | UNKNOWN |

## Plan S1 (the owner's live test with a TEST token)
Nothing here has been run against Monobank. S1 needs the owner, on a machine of their own:
1. Prerequisites: a monobank account; a TEST token from https://api.monobank.ua/ (M1, M2: the test environment is the same host, no terminal needed, any Luhn-valid card number, no real money); for the `pay` stage a public `https` staging URL that reaches a running API's webhook route (`STOREFRONT_PUBLIC_URL/webhooks/payments/monobank` behind the `/webhooks` edge proxy route, plan step 11) or any `https` endpoint that logs raw POST bodies and headers; about 20 minutes.
2. Put the token in the environment only (never in chat, a file in the repository or the command line): `read -rs MONOBANK_TOKEN && export MONOBANK_TOKEN`.
3. `node scripts/spikes/monobank-verify.mjs --self-test`, then the stages `readonly`, `invoice --confirm`, `pay --confirm` (with `MONOBANK_SPIKE_WEBHOOK_URL`) and `webhook` (with a saved live body and its `X-Sign`) exactly as in `scripts/spikes/README.md`, "monobank-verify.mjs".
4. `unset MONOBANK_TOKEN`; send the findings JSON (it holds no token, card data or merchant name) for the plan; the facts above are then confirmed or corrected in the plan and, where they differ, in this plugin.

## Tests
`pnpm --filter @fluxkit/provider-monobank test`. Every spec file runs behind the no-network guard (`src/test-support/no-network.ts`, Vitest `setupFiles`): any `fetch` to a host other than `127.0.0.1` fails the file. The stub (`src/test-support/stub-monobank.ts`) has its own P-256 key pair, signs webhooks like M12, is NOT idempotent on create and does NOT deduplicate `extRef` (the stricter readings), and echoes the token and card masks in its error texts so `secrets.spec.ts` can prove none of it is kept (every 8-character fragment of the token is forbidden). Specs: request shapes, answer mapping, operations and fact mapping, webhook verification (documented vector, rotation, throttle, wrong key, tampered and oversized bodies), the core contract suite, secrets, the module, static guards (only `api.monobank.ua`, `fetch` only, only `MONOBANK_TOKEN` read).
