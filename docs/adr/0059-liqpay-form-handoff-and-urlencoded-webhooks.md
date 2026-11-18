# 0059. LiqPay: form checkout handoff and urlencoded payment webhooks

Status: accepted 2026-11-18 (owner instruction to review `docs/plans/2026-11-18-liqpay-payment-provider.md` and implement; all plan quiz answers taken as recommended).

Builds on ADR 0032 (online payments; LiqPay was listed as later). Refines ADR 0032 decision 12 (webhook body was "JSON only") and the storefront hand-off assumption that every provider answers with a GET-navigable `https` page URL. Does not supersede ADR 0032.

## Context

- Fluxkit’s payment port returns `{ providerPaymentId, redirectUrl }` and the storefront navigates with `window.location` because CSP has `form-action 'self'` (ADR 0032 decision 6).
- LiqPay Checkout (API v7) needs a browser **POST** of signed `data` + `signature` to `https://www.liqpay.ua/api/3/checkout`.
- LiqPay server callbacks POST `application/x-www-form-urlencoded` with `data` and `signature`, not a JSON body with an `X-Sign` header. The webhook controller of ADR 0032 answered **415** for anything but JSON.
- `providerPaymentId` on the attempt row must stay stable for `bindFact`; LiqPay’s numeric `payment_id` must not replace our attempt id.

## Decision

1. **LiqPay plugin** (`packages/providers/liqpay`, code `liqpay`): implements `PaymentProviderPort`; enabled via `PAYMENT_PROVIDERS_ENABLED`; secrets `LIQPAY_PUBLIC_KEY` and `LIQPAY_PRIVATE_KEY`; UAH only in v1; no new npm dependency (`fetch` + `node:crypto` SHA3-256).
2. **Form handoff capability:** `PaymentProviderCapabilities.formHandoff`. When true:
   - The API builds `CreatePaymentInput.handoffUrl` from `STOREFRONT_PUBLIC_URL` + locale (`/{locale}/payment/handoff?payment=<id>`).
   - `createPayment` may be local (no outbound call): it returns `providerPaymentId` = our payment attempt id (LiqPay `order_id`) and `redirectUrl` = `handoffUrl`.
   - Port method `buildCheckoutHandoff` returns `{ actionUrl, fields }` for a fresh signed POST. Providers with `formHandoff: false` implement the method as a local `not_sent` refusal; the API never calls it for them.
3. **Store handoff routes** use the same ownership model as payment status (guest: POST + order access token + CSRF; customer: session). Rate limit `paymentStatus`. No bare GET of signed fields by payment id alone.
4. **CSP:** storefront `form-action` is `'self' https://www.liqpay.ua` (always; documented trade-off so enabling LiqPay needs no rebuild). The handoff page sets `Referrer-Policy: no-referrer`.
5. **Webhooks:** `POST /webhooks/payments/{provider}` accepts `application/json` **or** `application/x-www-form-urlencoded` (raw body retained). The plugin verifies: LiqPay recomputes `base64(sha3-256(private_key + data + private_key))` over the form `data` field. Monobank stays JSON + ECDSA over raw bytes. Dedupe remains SHA-256 of the raw body.
6. **Facts:** `ProviderPaymentFact.providerPaymentId` and `reference` are the attempt UUID (`order_id`). LiqPay `payment_id` is not stored as `providerPaymentId`. Amounts convert minor↔major with integer math (UAH: two decimal places).
7. **v1 limits:** no PRRO `rro_info`, `invalidateUnpaid: false`, `multipleRefunds: false` until live S1 proves listing; hold/widget/token out of scope.

## Consequences

- Second Ukrainian acquiring option without requiring a Monobank business account.
- Slightly wider CSP form-action surface even when LiqPay is off.
- Webhook OpenAPI, edge docs and e2e must cover both content types; JSON-only tests stay for Monobank/fake.
- Live behaviour remains stub-only until owner S1 with sandbox keys.

## Not decided here

WayForPay, cash on delivery, runtime use of admin-stored LiqPay keys (integrations slice 2), USD/EUR for LiqPay.
