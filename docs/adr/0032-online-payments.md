# 0032. Online payments

Status: accepted 2026-10-26 (owner's quiz answers on `docs/plans/2026-10-26-payments-monobank.md`, recorded in its section "Owner answers": questions 1 to 3 answered with the recommended options; every other question of that plan is taken as recommended by the orchestrator, the owner may revisit any of them). The red-zone items named in that plan's "Needs approval" section are approved by those answers: the payment flow, automatic refunds of late or duplicate payments and admin full and partial refunds (payments); `markPaidIn`, the expiry deferral with its 30-minute cap, the cancel and mark-paid guards, no change to order totals (order status logic); migration `0008_payments` with `payment`, `payment_event`, `payment_refund` and the journal trigger (schema); the unauthenticated webhook route, `rawBody`, the new rate limits and the permission `payments.refund` (auth and public surface); the store and admin routes, the additive order view and config members, the `payment.*` events, `PaymentProviderPort` and the new problem rules (public contracts); `PAYMENT_PROVIDERS_ENABLED`, `MONOBANK_TOKEN` and the production `https` rule of `STOREFRONT_PUBLIC_URL` with a payment provider (config schema); the CI matrix modes `providers-payment-*`, job 11 and `rawBody` in the app factory (CI); Monobank as an external service and processor. No new dependency. What needs the owner's own action waits for it: the live test S1 (plan step S1) needs the owner's TEST token `MONOBANK_TOKEN` (environment only, never in chat), a public `https` staging URL and the owner's go; production (S2) needs a merchant contract with internet acquiring, the production token, the bank's website requirements, the PRRO decision with the accountant and the `/webhooks` edge proxy route (decision 17).

Builds on ADR 0004 (money in minor units; separate payment entity), 0011, 0015 (checkout, lock order, TTL), 0017 (one order status, `markPaid` rules, late payment refused), 0018 (events, `OrderPaymentsPort`, `OrderReadPort`), 0019 (append-only journals with `pg_trigger_depth()`), 0021 and 0025 (bounded jobs), 0022 (paid-order cancel), 0023 (guest tokens), 0024 (trusted proxy), 0026 and 0027 (one origin, typed client, the admin never retries a write), 0029, 0030 and 0031 (provider port in core, manifest loader, typed provider result, contract suite, no-network guard, test-only providers refused in production). Refines ADR 0004 decision 4 and ADR 0017's "the payment plan may split [the status]" (decision 4: a `payment` entity, the order keeps one status) and one sentence of ADR 0018 (decision 2: the payment routes and the `markPaid` call belong to the core payments module, the plugin only implements the port). Edits and supersedes nothing.

Nothing described under Decision is built yet. Each item is a requirement for the implementation steps 2 to 12 of the plan. Monobank facts carry the plan's M-numbers (plan section "Monobank acquiring facts", read 2026-10-26, never called; only the documented signature example was verified locally); UNKNOWN marks what the documents read do not state.

## Context

- **No online payment exists.** Orders stay `awaiting_payment` until an admin marks them paid (`POST /admin/orders/{id}/mark-paid`, `orders.write`) or the expiry job expires them. There is no payment port, attempt table, provider loader for payments, webhook route, reconcile job or payment permission.
- **`OrdersService.markPaid(orderId, {amount, providerReference, source}, actor)`** implements core `OrderPaymentsPort`: locks the order row first; `order_not_payable` for `expired`/`cancelled` and when any reservation is no longer `active`; the same reference on a paid order is `ok alreadyPaid`, another reference `payment_reference_conflict`; the amount must equal the total (`amount_mismatch`); `awaiting_payment -> paid` commits stock. `source` is accepted and not stored (only `payment_reference`, max 255, and `paid_at`).
- **Expiry:** job 1 expires `awaiting_payment` orders with `expires_at <= now` under the order row lock; `ORDER_PAYMENT_TTL_MINUTES` default 30 (5 to 1440); reservations live until `expires_at + 10 minutes`; core `decideExtend` extends only active reservations and never shortens. ADR 0017 requires a provider session shorter than the TTL.
- **Provider pattern:** the shared manifest scan `loadProviderPackages({kind, ...})`, registries by Nest discovery, `ProviderResult` with codes, `ProviderAbortSignal`, plugin rules (constant base URL, `redirect: "error"`, size cap, zod answers, no secret in logs, stub server, no-network guard, contract suite in core), test-only providers refused in production, CI matrix modes `providers-*`.
- **HTTP:** `NestFactory.create` runs without `rawBody`; CSRF is a per-controller guard on `/store`; rate limits are named in-memory windows; the edge proxy routes `/store`, `/admin`, `/media` only; `STOREFRONT_PUBLIC_URL` is read by the API and is never replaced by a request's `Host`.
- **Storefront:** the CSP has `form-action 'self'`; a navigation by `window.location` to a provider page is allowed, a form POST to it is not. Texts say no money is taken on the site.
- **Monobank acquiring** ("Plata by mono") is the first provider: hosted payment page by redirect, `X-Token` auth, ECDSA-signed webhooks without ordering guarantee, no create idempotency, refunds by `invoice/cancel` with `extRef` (decision 15).

## Decision

### 1. Scope (owner answer 1; plan questions 5, 6, 8, 9, 12 as recommended)
- In v1: redirect card payment (`debit`) through the provider's hosted page (card, Apple Pay, Google Pay, the monobank app), webhook plus reconcile job, automatic full refunds of late or duplicate payments, admin full and partial refunds, admin resync and an attention list, store pay and return pages, the Monobank plugin and a test-only fake.
- Later, each with its own plan or step: hold/capture (`paymentType: hold`), card tokenization and recurring payments, the "Pay with mono" button (`withAppUrl`), the iframe widget, split payments, PRRO fiscal items on refunds, LiqPay and WayForPay, cash on delivery and an order status split, refund mails, multi-currency, statements and receipts.
- Non-goals: any card data, PAN, CVV or provider token in our database, logs or browser code; trusting the return URL; payments changing order totals (ADR 0029 decision 1); editing orders after payment.
- PRRO (plan question 5): v1 assumes PRRO is NOT linked in the merchant's Monobank cabinet; `basketOrder` is still sent for display; refunds carry no fiscal `items`.
- Currency (question 6): UAH only for `monobank` (decision 3).
- Card data shown to admins (question 12): card system and last 4 digits only.

### 2. Boundaries (core, no feature flag)
- **Payments are core; providers are plugins** (AGENTS.md section 1). The "off" state is an empty `PAYMENT_PROVIDERS_ENABLED`; there is no feature flag beyond it. With no provider the shop behaves exactly as today (manual mark paid).
- `packages/core/src/payments/` (pure, TDD, no I/O, enforced by dependency-cruiser): `PaymentProviderPort`, `PaymentProviderResult`, `ProviderPaymentFact`, the metadata key `fluxkit:payment-provider`, the package kind `"payment"`, the contract suite `checkPaymentProviderContract`, and the pure rules: attempt and refund statuses and transitions as data, `normalizeProviderFact` (ordering by `modifiedAt`), `bindFact`, `decideOrderOutcome`, `decideRefund` and `remainingRefundable`, `invoiceValidity`, `decideExpiry`, the reconcile backoff, the dedupe and idempotency key builders, basket building with its sum check. Core maps provider statuses to attempt statuses; a plugin only normalises fields.
- `apps/api/src/payments/` (core module): loader and registry, `PaymentAttempts` (the ONLY writer of attempt status, over the core transitions), the create flow, the webhook controller, store and admin controllers, `PaymentActions` (post-commit invoice invalidation and automatic refunds), job 11 `reconcile-payments`.
- `apps/api/src/orders/`: a small reviewed diff (`markPaidIn`, the expiry deferral, the cancel and mark-paid guards). `OrdersService` stays the only order status writer.
- **Refines ADR 0018** ("a payment plugin registers its own routes ... and calls `OrderPaymentsPort.markPaid`"): the routes, signature dispatch and the `markPaid` call live in the core payments module; a plugin implements `PaymentProviderPort` only and never imports `apps/api` or touches the database.
- Providers: `packages/providers/monobank` (code `monobank`) and `packages/providers/_fake-payment` (code `fake`, test only). The existing dependency-cruiser rules keep core and apps from importing provider packages statically.
- Client methods live in `packages/api-client`; pages in `apps/storefront` and `apps/admin`.

### 3. `PaymentProviderPort` and its result
Internal until the first external plugin; then listed in `docs/contracts/`. Shape (exact types fixed in plan step 2):

```ts
interface PaymentProviderPort {
  readonly code: string;                                   // "monobank"
  readonly capabilities: { currencies: readonly string[]; partialRefunds: boolean; multipleRefunds: boolean;
                           invalidateUnpaid: boolean; webhooks: boolean };
  createPayment(input: { paymentId: string; orderNumber: string; amount: Money; description: string;
      lines: readonly PaymentLine[]; returnUrl: string; webhookUrl: string; expiresAt: Date },
    signal: ProviderAbortSignal): Promise<PaymentProviderResult<{ providerPaymentId: string; redirectUrl: string }>>;
  getPayment(providerPaymentId: string, signal: ProviderAbortSignal): Promise<PaymentProviderResult<ProviderPaymentFact>>;
  invalidatePayment(providerPaymentId: string, signal: ProviderAbortSignal): Promise<PaymentProviderResult<{ invalidated: boolean }>>;
  refund(input: { providerPaymentId: string; refundId: string; amount: Money; full: boolean }, signal: ProviderAbortSignal):
    Promise<PaymentProviderResult<{ status: "processing" | "succeeded" | "failed" }>>;
  verifyWebhook(input: { headers: Readonly<Record<string, string>>; rawBody: Uint8Array }, signal: ProviderAbortSignal):
    Promise<PaymentProviderResult<ProviderPaymentFact>>;
}
// ProviderPaymentFact = {providerPaymentId, reference, status: "created" | "processing" | "authorized" | "succeeded" | "failed"
//   | "reversed" | "expired", providerStatus, amount: Money, finalAmount: Money | null, modifiedAt: Date, failureCode: string | null,
//   refunds: {refundId: string | null, status, amount: Money, modifiedAt}[], card: {system, last4} | null}
// PaymentProviderResult<T> = {ok: true, value: T}
//   | {ok: false, reason: "unavailable" | "rate_limited" | "rejected" | "misconfigured" | "not_found" | "not_cancellable"
//        | "invalid_signature" | "not_sent", retryAfterSeconds?: number, providerCodes: string[]}
```

- `not_sent`: the plugin proves nothing left the process; safe to treat as "nothing happened". `unavailable`, a timeout, a thrown error and a malformed answer MAY have reached the provider: a create becomes `create_unknown`, a refund `unknown` (decision 13); neither is retried blindly.
- Codes only, never provider message text (`errText` is "informative only", M16).
- The API, not the plugin, owns the timeout (10 s per call, through the abort signal), logging and retries.
- `authorized` exists for later hold support; no v1 flow produces it.
- **Provider loading** (plan question 7): `PAYMENT_PROVIDERS_ENABLED` is a comma list of codes (shipping precedent, not the email "one provider" rule); the shared manifest scan runs with `kind: "payment"`; a package declares `"fluxkit": {"provider": "<code>", "kind": "payment"}`; the registry discovers classes marked `fluxkit:payment-provider` and checks port methods and codes. An enabled provider that is missing or broken fails startup. **`fake` is refused when `NODE_ENV=production`** (a test-only list as for shipping and email). A provider whose `capabilities.currencies` lacks `SHOP_CURRENCY` refuses startup (`monobank` declares `["UAH"]`). The storefront shows a provider choice only with more than one enabled.
- **CI matrix modes** (plan step 4): `providers-payment-fake`, `providers-payment-none`, `providers-payment-monobank` (refuses to start without `MONOBANK_TOKEN`; sends no request to Monobank at startup); `providers-deleted` also removes `_fake-payment` and `monobank`.

### 4. A payment entity next to the single order status (plan question 8)
- The order keeps ONE explicit status (ADR 0017); `paid` is set only through `markPaid`/`markPaidIn`. No `payment_status` or `fulfilment_status` column, no derived status in v1.
- The `payment` table is the separate payment entity ADR 0004 decision 4 asked for (`payment_attempt` in ADR 0004's list), with its own state machine as data in core. Cash on delivery (it needs `fulfilled` before `paid`) and a derived order status get their own ADR later.

### 5. Data model (red zone: migration `0008_payments`)
Generated migration plus a hand-written `0008_payments.down.sql` that also deletes its `drizzle.__drizzle_migrations` row; up, down, up, down tested. Exact types and CHECK texts are fixed in plan step 3 within these rules.

**`payment`** (one row per attempt)

| Column | Rule |
|---|---|
| `id` uuid PK | also sent to Monobank as `merchantPaymInfo.reference` (binds facts to the attempt) |
| `order_id` -> `sales_order` RESTRICT | |
| `provider_code`, `provider_payment_id` | Monobank `invoiceId`; UNIQUE `(provider_code, provider_payment_id)`; NULL until the create answered |
| `amount`, `currency` | minor units, equal to the order total at creation; CHECK `amount > 0`, currency pattern |
| `status` | `creating`, `awaiting_customer`, `processing`, `succeeded`, `failed`, `expired`, `invalidated`, `create_unknown`; CHECK list; transitions are core data |
| `provider_status`, `provider_modified_at` | the last APPLIED provider status and its `modifiedDate`; monotonic (an older fact never overwrites, M10) |
| `final_amount` | provider `finalAmount` (minor), NULL until known |
| `refunded_amount` | sum of succeeded refunds; CHECK `0 <= refunded_amount <= amount`; written in the refund's transaction |
| `redirect_url` | `pageUrl` (`https`, allow-listed host); kept while the attempt is live so "continue payment" reopens it; cleared when final |
| `expires_at` | invoice validity end (decision 9) |
| `order_outcome` | NULL, `applied`, `already_paid`, `order_not_payable`, `amount_mismatch`, `reference_conflict` (what `markPaidIn` answered) |
| `needs_attention` boolean, `attention_code` | every case an admin must see (late or duplicate success, refund failed or unknown, amount mismatch, unknown status, reconcile gave up) |
| `failure_code` | provider `errCode`, pattern `^[A-Za-z0-9_.:-]{1,64}$` |
| `card_system`, `card_last4` | question 12; no BIN, no full mask |
| `next_check_at`, `check_attempts` | reconcile schedule; partial index on `next_check_at` for live attempts and attempts with refund work |
| `idempotency_key` | the store create route's `Idempotency-Key`; UNIQUE per order |
| `created_by` | `customer`, `guest`, `admin` (admin-created links are later); `created_at`, `updated_at` |

- **At most one live attempt per order:** a partial unique index on `order_id` WHERE `status IN ('creating', 'awaiting_customer', 'processing', 'create_unknown')`.

**`payment_event`** (append-only journal)
- `id`, `payment_id` -> `payment` CASCADE, `source` (`webhook`, `poll`, `create`, `admin`, `system`), **`dedupe_key` UNIQUE** (`webhook:<sha256 of the raw body>`; `poll:<status>:<modifiedAt>:<finalAmount>:<cancelList hash>`), `provider_status`, `provider_modified_at`, `amount`, `final_amount`, `failure_code`, `applied` boolean (false when older than the current state or not bound), `from_status`, `to_status`, `actor_admin_id` -> `admin_user` SET NULL, `created_at`.
- A trigger rejects UPDATE and DELETE as for `order_status_change` (ADR 0019), with the `pg_trigger_depth()` exceptions for the referential actions above.
- Never stored: the raw body, `maskedPan`, `errText`, `rrn`, `approvalCode`.

**`payment_refund`**
- `id` uuid PK (sent as Monobank `extRef`), `payment_id` -> `payment` RESTRICT, `amount > 0`, `currency`, `status` (`requested`, `processing`, `succeeded`, `failed`, `unknown`), `reason` (`admin`, `late_payment`, `duplicate_payment`, `amount_mismatch`), `note` (admin text, 1 to 500), `actor_admin_id` SET NULL, `idempotency_key` UNIQUE NULL (admin route), `provider_modified_at`, `failure_code`, `created_at`, `updated_at`.
- The sum of `requested`, `processing`, `succeeded` and `unknown` refunds never exceeds `payment.amount`: checked in core and in the service under the payment row lock.

**Not stored anywhere:** card numbers or masks beyond last 4 and system, the provider token, raw webhook bodies, `errText`, `pageUrl` after the attempt is final, IP addresses.

### 6. Create flow (store)
1. `POST /store/orders/payments` (guest: `{number, accessToken, provider?, locale}`) or `POST /store/account/orders/{number}/payments` (customer session); header `Idempotency-Key` (UUID); ownership exactly as order lookup and cancel (identical `404` for an unknown number, a wrong token and a foreign order). Refusals `409 rule_violation`: `order_not_payable`, `payment_in_progress` (a `processing` or `create_unknown` attempt exists), `payment_window_too_short` (decision 9), `payment_not_available` (no provider, currency not supported). A replay with the same key answers the same attempt (`200`).
2. One short transaction (order row lock, then payment rows): re-check status and total; close an `awaiting_customer` attempt of the order as `invalidated` (its invoice is invalidated after commit, best effort, M14; if it was paid meanwhile, that success lands as a duplicate and is refunded); insert the new attempt `creating` with `expires_at`. Commit.
3. **Provider call with no transaction open:** `createPayment` with `amount`, `ccy` 980, `merchantPaymInfo` {`reference` = attempt id, `destination` = localized "Order <number>" (max 280), `basketOrder` = the order snapshot lines plus the shipping line, sum checked equal to `amount` in core}, `redirectUrl`, `webHookUrl` (decision 16), `validity`, `paymentType: debit`. No `X-Cms` header (white-label).
4. Record (short transaction): `ok` -> `awaiting_customer` with `provider_payment_id` and `redirect_url`; `rejected`, `misconfigured`, `not_sent` -> `failed` (code; the shopper may try again at once); timeout or `unavailable` -> `create_unknown`. Answer `201 {paymentId, redirectUrl, expiresAt}` or `503 payment_provider_unavailable`.
5. The browser navigates to `redirectUrl` with `window.location.assign` (allowed by the CSP). It never sends an amount.
6. **Return page** `/{locale}/payment/return?payment=<id>`: the query parameter only says WHICH attempt to show. State comes from `POST /store/orders/payments/status {number, accessToken, paymentId}` (guest; the token is read from `sessionStorage`, saved before the redirect in the same tab, never sent to the provider) or `GET /store/account/orders/{number}/payments/{paymentId}`. When the attempt is not final and the last provider read is older than 10 s, the route reads the provider once (bounded, single flight per attempt, rate limited) before answering. The page polls every 3 s for at most 2 minutes, then says the order will update.
7. **When the shopper goes to the provider** (plan question 9): right after placing the order (automatic redirect when online payment is enabled); "Pay now" on the order page is the fallback and the retry path.

### 7. Only a verified provider fact pays; a single writer
- A **fact** comes either from `verifyWebhook` (signature over the raw body) or from `getPayment` called by the API with the shop's token. Both are equally trusted; the redirect, a query parameter and any client-sent amount are never trusted.
- **Binding** (core `bindFact`): provider id equals the attempt's; `reference` equals the attempt id; `amount` and currency equal the attempt's (and the attempt equals the order total); for `succeeded`, `finalAmount` (when present) equals `amount`. A fact that does not bind is journaled with `applied = false`, sets `needs_attention` and never pays.
- **Applying `succeeded`** happens in ONE transaction in the existing lock order (`sales_order` -> `payment` -> reservations, ADR 0015): the attempt moves to `succeeded`, then `OrdersService.markPaidIn(tx, orderId, {amount, providerReference: "<provider>:<providerPaymentId>", source: "<provider>"}, system)`, a variant of `markPaid` that runs inside the caller's transaction so the attempt and the order commit together. `PaymentAttempts` is the only writer of attempt status; `OrdersService` stays the only writer of order status.
- **Outcomes** (core `decideOrderOutcome`, stored in `order_outcome`):

| `markPaidIn` answer | Result |
|---|---|
| `ok` | `applied`; `order.paid` emitted as today |
| `ok alreadyPaid` (same reference) | `already_paid`; nothing else |
| `order_not_payable` (expired, cancelled, reservation gone) | `needs_attention`; automatic full refund queued (reason `late_payment`) |
| `payment_reference_conflict` (paid by another attempt or by hand) | `needs_attention`; automatic full refund queued (reason `duplicate_payment`) |
| `amount_mismatch` | `needs_attention`; NO automatic refund (our data and the provider's disagree; an admin decides) |

- **Unordered facts** (M10): a fact older than `provider_modified_at` is journaled `applied = false` and ignored; the core transition table decides the rest (`succeeded` never moves back to `processing`; `reversed` after `succeeded` is recorded with an attention flag).
- `order.paid` stays the only paid event for emails; it is not emitted for a refunded late or duplicate payment.

### 8. Expiry versus a payment in flight (owner answer 2)
- `expireOne` asks core `decideExpiry(order, attempts, now)` under the order lock. If an attempt is `processing`, or `awaiting_customer` / `create_unknown` without a final provider read after its `expires_at` (Monobank sends no `expired` webhook, M8), the order is NOT expired: its `expires_at` and its active reservations are extended by **10 minutes** (`decideExtend`; journaled as a `system` `payment_event`), at most until **`placed_at + ORDER_PAYMENT_TTL_MINUTES + 30 minutes`**, and job 11 is made due for those attempts.
- After the cap the order expires anyway; any later success is refunded automatically with an admin alert (`needs_attention`).
- Consequence: an order whose shopper opened the payment page and left waits at least until job 11 has read the invoice once after its validity ended.

### 9. Invoice validity (plan question 11)
- `ORDER_PAYMENT_TTL_MINUTES` stays (default 30); no new variable.
- `payment.expires_at = order.expires_at - 3 minutes`; Monobank `validity` is derived from it in seconds (well below the 30-day maximum, M3).
- A create is refused with `payment_window_too_short` when less than 5 minutes remain (open question 3).

### 10. Cancel, manual mark paid and double payment (owner answer 3)
- **Cancel while paying:** the owner's or an admin's cancel of an `awaiting_payment` order is refused with `409 rule_violation payment_in_progress` while an attempt is `processing`; an `awaiting_customer` attempt is closed `invalidated` in the cancel transaction and its invoice invalidated after commit (best effort); a success that still lands is refunded automatically.
- **Manual mark paid stays** for offline payments (bank transfer): refused with `payment_in_progress` while an attempt is `processing`; an `awaiting_customer` attempt is invalidated; a later online success is a `payment_reference_conflict` and is refunded automatically. The admin mark-paid dialog explains the guard.
- **Double payment:** one live attempt per order (decision 5) plus invalidation of the previous invoice; a second success anyway is refunded automatically.
- **Paid-order cancel and refunds are independent:** a refund never changes the order status; cancelling a paid order (ADR 0022) does not refund by itself; the admin UI offers "Refund" next to it. A full refund of a `fulfilled` order is allowed (returns).

### 11. Refunds (owner answer 3; plan question 13)
- Admin `POST /admin/orders/{id}/payments/{paymentId}/refunds {amount, note}` with `Idempotency-Key`, permission **`payments.refund`** (new; owner and manager). Payments are visible with `orders.read`.
- Core `decideRefund`: the attempt is `succeeded`; currency equal; `0 < amount <= amount - refunded - in flight`; a partial amount only when the provider's capabilities allow it and no fiscal items are required (PRRO not linked, decision 1). Refusals: `refund_not_allowed`, `refund_exceeds_remaining`, `partial_refund_not_supported`.
- The refund row is inserted `requested` under the payment row lock; the provider call runs with no transaction open; the result is recorded as `processing`, `succeeded`, `failed` or `unknown`; `refunded_amount` grows only on `succeeded`; `payment.refund_status_changed` is emitted.
- **Idempotency:** the refund id is sent as `extRef`; the admin route's `Idempotency-Key` returns the same refund row on a replay; a lost answer is never resent (decision 13).
- **A refund never changes the order status.**
- **Automatic refunds** (late or duplicate payment) use the same path with their reason code and the full amount, run after commit by job 11 (or a post-commit attempt), never inside the webhook transaction.

### 12. Webhook route (red zone: unauthenticated public route)
- `POST /webhooks/payments/{provider}` (plan question 10): no session, no CSRF, JSON only, body cap 64 KiB, rate limit `paymentWebhook` 300 per minute per address (generous because Monobank's addresses are unknown, M25).
- **Raw body:** `NestFactory.create` gets `rawBody: true` (Nest built-in, no dependency); the route verifies over the exact bytes received; the parsed JSON is never re-serialized for verification.
- Steps: provider not loaded -> `404`; `verifyWebhook`; invalid signature -> `401`, a warning without the body, nothing stored; find the attempt by provider id, else by `reference` (this binds a `create_unknown` attempt); unknown attempt -> `200` (logged; retries would not help); one transaction: journal insert `ON CONFLICT (dedupe_key) DO NOTHING` (a duplicate answers `200` at once), then apply (decision 7) -> `200` with an empty body. A database failure answers `503` so the provider retries (M9: up to 3 more attempts until `200`; answer exactly `200`).
- No outbound call on this path except the rare key refetch (decision 14).
- **Idempotency and replays:** a replayed genuine webhook cannot change state (dedupe key, monotonic `modifiedAt`, `markPaidIn` idempotent by reference). No timestamp is signed (M12), so replays cannot be refused by age.

### 13. Reconcile job and lost answers (job 11 `reconcile-payments`)
- Bounded like ADR 0025: 30 s budget, pages of 50, provider calls outside transactions, one short transaction per attempt; runs after job 8 and before jobs 9 and 10 (exact place fixed in plan step 5).
- (a) **Status reads** for attempts `processing`, `awaiting_customer` past `expires_at`, `create_unknown` and attempts with unfinished refund work: `getPayment`, applied as a `poll` fact. Backoff 1, 2, 5, 10, 30 minutes, then hourly for 48 hours, then `needs_attention` `reconcile_gave_up`.
- (b) **Invalidation** of closed attempts that have a provider id: `invalidatePayment` once, failures retried twice.
- (c) **Queued automatic refunds:** `refund` with `extRef` = refund id.
- Admin "Resync" runs (a) for one attempt.
- **Lost-answer rules:**
  - `create_unknown` is **never retried** with the same attempt (Monobank has no create idempotency, M5). A later webhook carrying our `reference` binds the invoice; otherwise job 11 closes the attempt `failed` `create_unknown` after its `expires_at` (nobody received its `pageUrl`).
  - A refund whose answer was lost becomes `unknown`; the next run reads the payment's `cancelList` and matches our `extRef` instead of calling `refund` again (M13: whether Monobank deduplicates `extRef` is UNKNOWN). A double refund would lose money.
  - `429 TMR` (M17): the job pauses the run.

### 14. Security
- **Signature:** ECDSA P-256 over SHA-256 of the raw body bytes, `X-Sign` base64 DER (M12); verified with `node:crypto` (the documented example verifies locally). The public key from `GET /api/merchant/pubkey` is cached in memory per process, checked to be EC P-256 before use, and refetched only after a failed verification and at most once per 60 s per process (rotation without letting an attacker make us call Monobank per request).
- **PCI scope = redirect only:** no card data in our systems or browser code; the shop never renders a card form (SAQ A in spirit). Only card system and last 4 digits are stored.
- **Binding** as decision 7; the return page's query parameter is only an id looked up under ownership checks.
- **URLs from config only:** `redirectUrl` and `webHookUrl` are built from `STOREFRONT_PUBLIC_URL`; a spec sends forged `Host` and `X-Forwarded-Host` and asserts they are ignored.
- **SSRF pin:** the Monobank base URL `https://api.monobank.ua` is a constant (test and production share the host, M1, M2; tests inject a stub origin through the module's test factory only); `redirect: "error"`; 64 KiB answer cap; zod schemas; `pageUrl` must be `https` on an allow-listed host (M23 UNKNOWN; the list is fixed at S1) before it reaches a browser.
- **Secrets:** `MONOBANK_TOKEN` only in the environment; never logged, stored, returned or put in an error (errors name the variable only; a log-capture spec proves it). No `errText` stored or shown; shoppers see a few categories ("declined by the bank", "payment cancelled", "link expired", "technical problem").
- **Rate limits** (named in-memory windows): `paymentCreate` 10 per 10 minutes per address, `paymentStatus` 60 per 10 minutes per address, `paymentWebhook` 300 per minute per address, `paymentRefund` per admin user; provider reads of the status route single flight per attempt.
- **Authorization:** store routes use the lookup/cancel ownership rules; refunds and attention clears need `payments.refund`; each is journaled with the admin id.

### 15. Monobank plugin (`packages/providers/monobank`)
- Node 22 `fetch`, `node:crypto` and zod 4.6.7 (already pinned); no new dependency. Header `X-Token` on every call.
- Facts the plugin codes against (sources in the plan: [S] the official OpenAPI spec "Acquiring v2410" embedded in https://api.monobank.ua/docs/acquiring.html, [C] invoice create, [X] invoice cancel, [W] webhook verify, [T] testing, [P] the Plata by mono page):

| # | Fact | Verdict |
|---|---|---|
| M1, M2 | `X-Token` auth; test token from https://api.monobank.ua/ on the same host; any Luhn-valid card in test; Apple/Google Pay not shown with a test token | confirmed [S], [C], [T] |
| M3, M4 | `POST /api/merchant/invoice/create` (`amount` minor, `ccy` 980, `merchantPaymInfo`, `basketOrder`, `redirectUrl`, `webHookUrl`, `validity` max 30 days, `paymentType`) -> `{invoiceId, pageUrl}` | confirmed [S], [C] |
| M5 | No idempotency key on create; dedupe by `reference` | absent [S]; dedupe by `reference` **UNKNOWN** (assumed none) |
| M6 | `GET /api/merchant/invoice/status`: statuses `created`, `processing`, `hold`, `success`, `failure`, `reversed`, `expired`; `finalAmount`, `modifiedDate`, `cancelList[]` with `extRef`, `paymentInfo` | confirmed [S] |
| M7 | Payment error codes (`errCode`), mapped to a few shopper categories | confirmed [S] |
| M8 | Webhook on every status change except `expired`; body = status answer; header `X-Sign` | confirmed [S], [C], [W] |
| M9 | Up to 3 further webhook attempts until `200 OK` | count confirmed; intervals, timeout, other 2xx **UNKNOWN** |
| M10 | No ordering guarantee; the greater `modifiedDate` is current | confirmed [S], [C] |
| M12 | `X-Sign` = base64 DER ECDSA over SHA-256 of the raw body; key from `GET /api/merchant/pubkey`; cache and refetch on failure | confirmed [S], [W]; example verified locally (P-256) |
| M13 | `POST /api/merchant/invoice/cancel` {`invoiceId`, `extRef`, `amount`} -> `processing`/`success`/`failure`; `CANCEL_NOT_AVAILABLE` | confirmed [S], [X]; `extRef` dedupe and several partial refunds **UNKNOWN** |
| M14 | `POST /api/merchant/invoice/remove` invalidates an unpaid invoice | confirmed [S] |
| M16 | Errors `{errCode, errText}`, `400`, `403`, `404`, `405`, `429 TMR`, `500`; `errText` informative only | confirmed [S] |
| M17 | Rate limit numbers, `Retry-After` | **UNKNOWN** |
| M18 | Non-UAH invoices | **UNKNOWN** (v1 UAH only) |
| M19 | Minimum `validity`; whether `processing` can finish after validity | **UNKNOWN** |
| M20 | Amount limits (`1077` below minimum) | **UNKNOWN** |
| M22 | `GET /api/merchant/details` -> `{merchantId, merchantName, edrpou}` (admin status shows `merchantName`) | confirmed [S] |
| M23 | Hosts of `pageUrl` | **UNKNOWN** (allow-list fixed at S1) |
| M24 | Commission 1.3 %, 2 % for foreign cards | confirmed [P] (commercial terms) |
| M25 | Settlement timing, website requirements, webhook HTTPS requirement and source addresses | **UNKNOWN** (owner asks the bank) |

- Mapping: `success` -> `succeeded`, `failure` -> `failed`, `reversed`, `expired`, `processing`, `created` as named, `hold` -> `authorized` (unused in v1); `403` -> `misconfigured` (one error log per process; creates answer `503`); `429` -> `rate_limited`; `CANCEL_NOT_AVAILABLE` -> `not_cancellable`; `404` -> `not_found`.
- Tests: a stub server `test-support/stub-monobank.ts` with its own P-256 key pair, every documented status and error, `429`, `CANCEL_NOT_AVAILABLE`, malformed and oversized answers; the documented example key and signature as a fixed vector; the contract suite; a no-network guard; the token never in logs or errors.
- **Owner prerequisites.** **S1 (test environment):** a monobank account, the test token as `MONOBANK_TOKEN` in a local `.env` (never in chat), a public `https` URL reaching a running API for the webhook stage, about 20 minutes to pay with a test card; the tool `scripts/spikes/monobank-verify.mjs` (stages `readonly`, `invoice`, `pay`) verifies M23, M19, live `X-Sign` (M12), whether `created` is sent as a webhook, ordering in practice (M10), `details` and `pubkey` with a test token, error shapes (M16), partial and repeated refunds and `extRef` dedupe (M13), `remove` on unpaid and paid invoices (M14), `429` (M17). **S2 (production):** a FOP or legal-entity account with internet acquiring, the production token, the merchant agreement and website requirements (M25), the PRRO decision with the accountant (M21), commission and settlement terms, `STOREFRONT_PUBLIC_URL` with `https`, the `/webhooks` proxy route, the refund and cancellation policy text; one small real payment (1 to 10 UAH) and its refund.

### 16. Configuration (red zone: config schema)

| Variable | Read by | Required | Default | Rule |
|---|---|---|---|---|
| `PAYMENT_PROVIDERS_ENABLED` | `loadEnv` | no | empty (none) | comma list of codes (`monobank`, `fake`); `fake` refused in production; a provider lacking `SHOP_CURRENCY` refuses startup |
| `MONOBANK_TOKEN` | `packages/providers/monobank` (own parser) | when `monobank` is enabled | none | visible ASCII, 20 to 256 characters (format UNKNOWN; widened if S1 shows otherwise); never logged, stored or returned |
| `STOREFRONT_PUBLIC_URL` | `loadEnv` (exists) | with a payment provider in production | as today | the ONLY base of `redirectUrl` (`/{locale}/payment/return?payment=<id>`) and `webHookUrl` (`/webhooks/payments/<provider>`); `https` required in production with a payment provider |
| `FAKE_PAYMENT_*` | `_fake-payment` | no | none | test hooks only (e2e); exact names in plan step 4 |

- No Monobank base-URL variable (decision 14); the token decides test or production.

### 17. Edge proxy route
- The webhook URL is on the storefront origin (`STOREFRONT_PUBLIC_URL/webhooks/payments/<provider>`), so every deployed environment's edge proxy needs a route `/webhooks` -> API next to `/store`, `/admin`, `/media` (README examples and the e2e proxies `apps/*/e2e/proxy.ts`, plan step 11).
- Without it no webhook arrives; job 11 still pays orders, more slowly. The proxy must pass the body unchanged (the signature covers the raw bytes).

### 18. API surface and events (red zone: public contracts; exact shapes in `docs/api/payments.md` and OpenAPI at build time)

| Route | Auth | Purpose |
|---|---|---|
| `POST /store/orders/payments` | guest token, CSRF, `paymentCreate` | create an attempt, `201 {paymentId, redirectUrl, expiresAt}` |
| `POST /store/account/orders/{number}/payments` | customer, CSRF, `paymentCreate` | same for a customer order |
| `POST /store/orders/payments/status` | guest token, CSRF, `paymentStatus` | `{paymentId, status, failureCategory?, expiresAt, orderStatus, canRetry}` |
| `GET /store/account/orders/{number}/payments/{paymentId}` | customer | same |
| store order views (lookup, account order) | as today | additive `payment: {canPay, providers[], latest \| null}` |
| `POST /webhooks/payments/{provider}` | provider signature | decision 12 |
| `GET /store/config`, `GET /admin/config` | as today | additive `onlinePayments: {enabled, providers[]}` |
| `GET /admin/orders/{id}` (and `OrderReadPort`) | `orders.read` | additive `payments[]` (attempts, events summary, refunds; no redirect URL) |
| `POST /admin/orders/{id}/payments/{paymentId}/resync` | `orders.write` | read the provider status now |
| `POST /admin/orders/{id}/payments/{paymentId}/refunds` | `payments.refund`, `paymentRefund` | refund (decision 11) |
| `GET /admin/payments?needsAttention=true` | `orders.read` | attention list, cursor paging |
| `POST /admin/payments/{paymentId}/attention/clear {note}` | `payments.refund` | close an attention item (journaled) |
| `POST /admin/orders/{id}/mark-paid` | as today | + `409 payment_in_progress` |

- Problem codes: `payment_provider_unavailable` (503); `rule_violation` rules `payment_in_progress`, `payment_window_too_short`, `payment_not_available`, `refund_not_allowed`, `refund_exceeds_remaining`, `partial_refund_not_supported`; existing `order_not_payable`, `idempotency_key_reused`.
- Events (ids only, at least once): `payment.status_changed`, `payment.refund_status_changed`; `order.paid` unchanged.
- The storefront's "no payment is taken on this site" texts change only when `onlinePayments.enabled`.

## Consequences

- **Cost.** Three tables and a journal trigger, one job, a loader kind, two provider packages, four store routes, one webhook route and five admin routes plus additive members, a pay and return flow in the storefront, a payment panel and attention list in the admin. Outbound network calls from requests (create, the bounded status read) and from job 11, all outside transactions and bounded by timeouts and the job budget.
- **Order logic.** `markPaidIn` joins `markPaid`; expiry may be deferred by up to 30 minutes past the normal deadline while a payment is unconfirmed (stock stays held that long); cancel and mark paid gain `payment_in_progress`. Order totals do not change.
- **Contracts.** New public items once built: the routes and members of decision 18, the problem rules, the `payment.*` events, `payments.refund`, the configuration of decision 16; later `PaymentProviderPort`. Pre-1.0, recorded in `CHANGELOG.md`.
- **Deployment.** Every environment needs the `/webhooks` proxy route and `rawBody`-compatible proxying; the API process keeps raw request bytes for JSON bodies.
- **Docs.** The plan's "Docs to update" list applies (new `docs/api/payments.md`, `docs/contracts/events.md`, `config.md`, `docs/dependencies.md` with Monobank as an external service and processor, `.env.example`, README payments setup and proxy route) and the AGENTS.md lines the owner adds (plan section "AGENTS.md edits the owner makes").
- **Risks.** Money moves on facts not yet seen live (statuses, ordering, partial refund behaviour): binding checks, attention items, automatic refunds only in the clear cases, S1 before production. No create idempotency (a lost answer leaves an unpayable invoice). Unknown refund idempotency (a lost refund answer must never be resent blindly). A late success after the cap is refunded (communication text needed; refund mail later). In-memory limits and the key cache multiply with instances (harmless for correctness). The order status stays single (no cash on delivery). The PRRO duty is the owner's.
- **What would supersede this ADR (in part):** an order status split or cash on delivery; hold/capture; a second provider that changes the port; S1 findings that change the binding, the refund handling or the webhook rules; PRRO support.

## Open questions (not decided by the plan or the owner's answers)

1. **Retry after `create_unknown`.** The plan blocks a new attempt while one is `create_unknown` (partial unique index, `payment_in_progress`) until job 11 closes it after its `expires_at`, which is 3 minutes before the order's deadline, so in practice the shopper cannot retry that order. Plan section 12 says "or at once if the owner prefers (question 2 note)", but question 2 has no such note. Options: keep (safe against a double charge), or allow a new attempt at once (the unknown invoice, if it exists, has no provider id we know, so it cannot be invalidated; Monobank offers no lookup by `reference`, M5; a success on it would be refunded as a duplicate). Decided in plan step 5 or by the owner.
2. **Cancel and mark paid with a `create_unknown` attempt.** Decision 10 names `processing` (refuse) and `awaiting_customer` (invalidate) only; the plan is silent on `create_unknown` (no provider id to invalidate). Proposal for step 6: refuse like `processing`; a late success is refunded anyway.
3. **`payment_window_too_short`.** "Less than 5 minutes remain" can be read against the order deadline or against the invoice validity (`order.expires_at - 3 minutes`). With `ORDER_PAYMENT_TTL_MINUTES = 5` (the allowed minimum) the second reading refuses every create. Decided in step 2 (`invoiceValidity`); the minimum Monobank `validity` (M19) may raise the floor at S1.
4. **Refund `unknown` that never shows in `cancelList`.** Decision 13 reads `cancelList` by `extRef`, but no rule says when an absent `extRef` becomes `failed` (and the amount reusable). Proposal: after the reconcile backoff ends, `needs_attention`; never `failed` automatically. Step 5.
5. **Equal `modifiedDate` with a different status or `cancelList`.** M10 orders by the greater `modifiedDate`; a tie is not covered (a refund may change `cancelList` and `finalAmount`). Core `normalizeProviderFact` needs a tie rule (proposal: apply only transitions the table allows, never move back). Step 2.
6. **`reversed` and partial refunds.** How a partially refunded invoice reports its `status` (still `success` with a lower `finalAmount`?) and whether `reversed` follows our own full refund are UNKNOWN (M13). The rule "`reversed` after `succeeded` records a full refund made outside the shop" must not raise attention for our own succeeded full refund. Step 2, confirmed at S1.
7. **`Retry-After` on the store route after `429`.** The plan says "from config, not from Monobank", but no variable is defined. Proposal: a constant in the API; no new variable. Step 5.
8. **`paymentRefund` limit size.** The plan names the window, not the numbers. Step 8.
9. **Journal trigger exceptions.** `payment_event` cascades from `payment` and sets `actor_admin_id` NULL; the trigger needs the ADR 0019 `pg_trigger_depth()` exceptions, while `payment` itself is RESTRICT from `sales_order` (orders are not deleted). Exact clauses in step 3.
10. **Matrix mode names.** The plan names `providers-payment-*`; confirm in step 4 (the email precedent changed names at its step 4).
11. **Monobank UNKNOWNs** M5, M9 (intervals, timeout, other 2xx), M13, M17, M18, M19, M20, M23, M25, whether a test token answers `details` and `pubkey`, whether `created` produces a webhook, and whether `api.monobank.ua` is reachable from non-Ukrainian hosting: S1 and S2 close what they can; M25 and the merchant terms are owner actions.
12. **`source` of `markPaid` is not stored.** The provider is recoverable from `payment_reference` (`<provider>:<id>`) and the `payment` row; whether `sales_order` should store `source` is not decided (no column change in this plan).
