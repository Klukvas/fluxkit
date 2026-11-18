# @fluxkit/provider-liqpay

LiqPay (PrivatBank) payment provider, code `liqpay`, kind `payment` (ADR 0059; plan `docs/plans/2026-11-18-liqpay-payment-provider.md`). Implements `PaymentProviderPort` with **form checkout handoff** and **urlencoded** webhooks over `https://www.liqpay.ua`.

**Status: built and tested against a local stub only.** No request has reached LiqPay. Behaviour below comes from public documentation (API v7); gaps are marked UNKNOWN or UNVERIFIED until owner live test **S1**.

## Purpose, flag, extension points

- Enabled by putting `liqpay` in `PAYMENT_PROVIDERS_ENABLED`. Requires `LIQPAY_PUBLIC_KEY` and `LIQPAY_PRIVATE_KEY`.
- Package contract: `"fluxkit": {"provider": "liqpay", "kind": "payment"}`, export `providerModule`, class `LiqPayPaymentProvider` with `fluxkit:payment-provider`.
- No DB migration. Webhook route is core: `POST /webhooks/payments/liqpay`.
- Removal: delete this folder and remove `liqpay` from `PAYMENT_PROVIDERS_ENABLED` (matrix `providers-deleted`).

## Configuration

| Variable             | Required                 | Rule                                                                                         |
| -------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `LIQPAY_PUBLIC_KEY`  | when `liqpay` is enabled | 8–256 visible ASCII, trimmed (exact cabinet format UNKNOWN until S1).                        |
| `LIQPAY_PRIVATE_KEY` | when `liqpay` is enabled | Same rule. Never logged. Keys decide sandbox vs production (UNKNOWN cabinet rules until S1). |

Origins are constants (`LIQPAY_API_ORIGIN`). `SHOP_CURRENCY` must be `UAH`. Nothing is sent at startup.

## Operations

| Port method            | Behaviour                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createPayment`        | **Local only**: validates input + `handoffUrl`, returns `{ providerPaymentId: paymentId, redirectUrl: handoffUrl }`. Never calls LiqPay (`not_sent` on validation failure).                                |
| `buildCheckoutHandoff` | Builds `action=pay` payload (`order_id`, major `amount`, UAH, `result_url`, `server_url`, `expired_date` UTC). Returns `{ actionUrl: https://www.liqpay.ua/api/3/checkout, fields: { data, signature } }`. |
| `getPayment`           | `POST /api/request` `action=status` by `order_id`.                                                                                                                                                         |
| `refund`               | `POST /api/request` `action=refund` with major `amount`. Sends `refund_ref` (our refund id) — **UNVERIFIED** whether LiqPay echoes it (S1).                                                                |
| `invalidatePayment`    | Local `{ invalidated: false }` (`invalidateUnpaid: false`).                                                                                                                                                |
| `verifyWebhook`        | Parses raw `application/x-www-form-urlencoded` `data` + `signature`; SHA3-256 verify; maps fact with `providerPaymentId` = `order_id` (not LiqPay `payment_id`).                                           |

Signature: `base64(sha3-256(private_key + data + private_key))` over base64 JSON `data` (Node `crypto`, no extra npm deps).

## Capabilities

`currencies: ["UAH"]`, `partialRefunds: true`, `multipleRefunds: false` (UNKNOWN listing until S1), `invalidateUnpaid: false`, `webhooks: true`, `formHandoff: true`.

## Status mapping (stub-tested)

`success`/`sandbox`/`wait_compensation` → `succeeded`; `failure`/`error`/`try_again` → `failed`; `reversed`; `processing`, documented `wait_*` (except compensation) / `*_verify` / `prepared` / `cash_wait` → `processing`; `hold_wait` → `authorized`; `invoice_wait` / `created` → `created`; `expired`; unknown → `status: null` with `providerStatus` kept. Refund answers with `wait_amount: true` stay `processing`.

Amounts: outbound major text from integer minor units (`payload-money.ts`, two decimals, truncate toward zero); inbound answers accept a number or a decimal string with at most two fractional digits and convert to minor units without float money arithmetic.

## UNKNOWN / S1

- Sandbox vs production key rules and cabinet setup.
- Whether unpaid checkout can be cancelled via API (`invalidateUnpaid` stays false).
- Refund idempotency / listing: we send `refund_ref` (our refund UUID) and map a documented refund answer (`status: "reversed"`, honouring `wait_amount`) from the refund call itself. Fluxkit also needs `getPayment` to list that refund under the same id after a lost answer; the local stub models a `refunds[]`/`refund_ref` status shape for the provider contract, but whether live LiqPay status answers echo that is UNKNOWN until S1 — until then a timed-out refund may stay `unknown` in production.
- Callback retry policy and expected HTTP status codes.
- Whether `payment_id` is always present in callbacks (never used as `providerPaymentId`).
- PRRO / `rro_info`, USD/EUR, exact error code catalogue, rate limits, `Retry-After`.

## Tests

`pnpm --filter @fluxkit/provider-liqpay test` — contract suite, signature vectors, stub ops, secrets guard, no-network guard (127.0.0.1 stub only).
