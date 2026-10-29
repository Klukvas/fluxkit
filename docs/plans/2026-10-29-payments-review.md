# Independent review: online payments (Monobank plan steps 1 to 10)

- Date: 2026-10-29. Reviewer: QA/Reviewer agent (Claude Opus 5.5), not an author of the payment code.
- Base: `origin/main` at `e5ef529` (steps 1 to 10 merged). Branch `review/payments`. No product code changed; every experiment below was reverted (`git status` clean apart from this file).
- Scope: ADR 0032, plan `2026-10-26-payments-monobank.md`, core `src/payments/`, migration `0008_payments` (+ down), `apps/api/src/payments/**`, the order-side guards in `OrdersService`, `packages/providers/monobank`, `packages/providers/_fake-payment`, the storefront pay step, return and order pages, the admin payment panel, refund dialog and attention list, `docs/api/payments.md`, `docs/contracts/events.md`.
- Stack used for proofs: real Postgres (scratch databases `fluxkit_payrev_test` and `fluxkit_payrev_mig_test`, dropped afterwards), Redis, Meilisearch v1.55; the in-repo test provider `apps/api/src/test/test-payment-provider.ts`. Scratch spec `apps/api/src/payments/zz-review-scratch.spec.ts` (not committed; its code is quoted in the findings).

## Summary

| ID | Severity | Finding |
|---|---|---|
| F1 | Major | A partial refund made outside the shop (Monobank cabinet) is applied silently: no attention, `refundableAmount` not reduced, so an admin can refund the same money a second time |
| F2 | Minor | An order with total 0 is offered online payment (`canPay: true`), and the create route then answers `400 validation_failed` `check_violation` |
| F3 | Minor (test gap) | The refund concurrency specs run on a cold connection pool and never race: removing the payment row lock lets 10 refunds of 1 200 through on a 2 000 payment, and every spec still passes |
| F4 | Minor (test gap) | No spec needs the order row lock of the create flow: removing it survives the whole payments suite |

No Blocker. Nothing found in signature checking, replay and dedupe, binding, the state machines, authorization, redirects or logs (see "Verified OK").

## Findings

### F1 (Major): external partial refunds are invisible to the shop's refund accounting

- Where: `apps/api/src/payments/payment-facts.service.ts:384` (`settleRefunds` looks only at refunds with our id); `packages/core/src/payments/refund.ts:224-228` (`decideRefundFromFact` filters `refundId === refund.id`; entries with `refundId: null` are dropped); `packages/core/src/payments/apply.ts:111` (only `reversed` raises `external_reversal`; a `succeeded` fact with a lower `finalAmount` and a foreign `cancelList` entry is `apply(null, null)`); `packages/core/src/payments/refund.ts:51` and `apps/api/src/payments/admin/admin-payment-view.ts:102` (`remainingRefundable` / `refundableAmount` = amount less OUR refunds only).
- Scenario: a 2 000 UAH payment succeeds. Staff refund 800 in the Monobank cabinet (the plugin maps such a `cancelList` entry to `refundId: null`, `packages/providers/monobank/src/invoice.ts`, "a refund made elsewhere has none"). The invoice stays `success` with `finalAmount` 1 200. The shop records the fact (`final_amount` 1 200) but raises no attention, `refunded_amount` stays 0 and the admin panel offers 2 000 as refundable (the refund dialog pre-fills it, `apps/admin/src/areas/payments/refund-form.ts`). An admin who refunds the returned item through the shop refunds the customer a second time; the provider accepts it because 1 600 <= 2 000.
- Proof (scratch spec "E2", real Postgres, real webhook route, real admin route):
  ```
  E2 after external refund {"status":"succeeded","final_amount":1200,"refunded_amount":0,"needs_attention":false,"attention_code":null}
  E2 admin view [[{"amount":1200,"currency":"UAH"},{"amount":2000,"currency":"UAH"}]]   // [finalAmount, refundableAmount]
  E2 second refund 202 "succeeded"
  E2 provider refunds [["external",800,"succeeded"],["ours",800,"succeeded"]] refunded_amount 800 needs_attention false
  ```
  `TestPaymentProvider.addExternalRefund` exists for this case but no spec uses it (`grep -rn addExternalRefund apps/api/src` finds only its definition).
- Suggested fix (core first, test first): treat any non-failed fact refund without our id (or with an id we do not know) as an external refund: raise a new or the existing `external_reversal` attention (or a new `external_refund` code, schema CHECK change, red zone), and cap `refundableAmount` and `decideRefund` by the provider's view as well (`min(amount - our active refunds, finalAmount)` when the fact reports a final amount, or amount less every non-failed fact refund). Add API specs with `addExternalRefund` for: attention raised, refundable reduced, a second refund of the same money refused `refund_exceeds_remaining`.

### F2 (Minor): zero-total orders are offered online payment and the create fails with a raw check violation

- Where: `packages/core/src/payments/attempt.ts:67` (`decideNewPaymentAttempt` has no rule for a total of 0); `apps/api/src/payments/store/store-payment-views.ts:97` (`canPay` reuses it); `apps/api/src/payments/payment-create.service.ts:212` inserts `amount: order.totalAmount` into `payment`, whose `payment_amount_check` requires `amount > 0`. Prices and order totals of 0 are valid (`price_amount_check`, `sales_order_total_amount_check` are `>= 0`).
- Scenario: a free product (or a free order) is checked out; the order is `awaiting_payment`; the storefront order page shows "Pay now" because `payment.canPay` is true; the click answers a `400` the shopper cannot act on.
- Proof (scratch spec "E1", real HTTP routes):
  ```
  E1 lookup status 200 {"canPay":true,"providers":["fake"],"latest":null}
  E1 create 400 {"code":"validation_failed","detail":"A value violates a data rule.","errors":[{"path":"","code":"check_violation"}],"constraint":"payment_amount_check"}
  E1 provider creates 0
  ```
  Money is safe (nothing is created and no provider is called).
- Suggested fix: a core rule in `decideNewPaymentAttempt` (for example `order_not_payable` or a new `payment_not_needed`, a public contract change) when the total is not positive, so `canPay` is false and the route answers a `409 rule_violation`; a spec with `price: 0`. Whether a free order should be settled automatically is an owner decision (today an admin marks it paid).

### F3 (Minor, test gap on a money-critical lock): the refund concurrency specs do not race

- Where: `apps/api/src/payments/payment-refunds.service.ts:88` (`lockById` FOR UPDATE: the only thing that keeps the cumulative refund limit; `lockRefundsOfPayment` cannot lock rows that do not exist yet, and no CHECK bounds the sum of refunds). Specs: `apps/api/src/payments/admin/admin-payments.spec.ts:395` and `apps/api/src/payments/payments-reconcile.spec.ts:356`.
- Mutation M2 (`lockById` -> `findById` in `requestAdminRefund`): the whole payments suite still passes (11 spec files plus the scratch spec, 193 tests). Cause: the API's `pg.Pool` closes idle clients after 10 s, so in the specs the first transaction runs on the only open client and commits before the others have connected; they then see its refund and are refused, which is the expected answer either way.
- Proof that the lock matters: scratch spec "E3" warms the pool (ten concurrent `select pg_sleep(0.05)` transactions), then sends ten concurrent `requestAdminRefund` of 1 200 on a 2 000 payment. Unmutated code: `accepted 1 rows 1` (passes). With M2: `accepted 10 rows 10` (fails). The production code is correct; only the specs cannot detect a regression.
  ```ts
  const database = world.app.app.get(DRIZZLE) as Database;
  await Promise.all(Array.from({ length: 10 }, () =>
    database.transaction(async (tx) => { await tx.execute(sql`select pg_sleep(0.05)`); })));
  const results = await Promise.all(Array.from({ length: 10 }, () => ask()));   // ask = requestAdminRefund(1 200)
  expect(results.filter((r) => r.kind === "requested").length).toBe(1);
  ```
- Suggested fix: warm the pool (or hold the first transaction with a gate) in every concurrency spec of payments (refunds, and the races in `payments-races.spec.ts`), and keep E3 as a regression spec.

### F4 (Minor, test gap): the order lock of the create flow is not covered

- Where: `apps/api/src/payments/payment-create.service.ts:173` (`orders.lockById`). It serializes a create with a cancel, a manual mark paid and the expiry job; the one-live-attempt index only covers create against create.
- Mutation M12 (`lockById` -> `findById`): the whole payments suite passes (11 spec files plus the scratch spec, 194 tests). No spec races a create with a guest cancel, an admin cancel or `expireOne`; without the lock a create can commit a live attempt (and a provider invoice) on an order that a concurrent cancel has just cancelled (money stays safe: a success on it is refunded as `late_payment`).
- Suggested fix: a race spec (warm pool, see F3) of create against guest cancel and against the expiry job: either the cancel answers `409 payment_in_progress` or the create answers `order_not_payable`, never a live attempt on a cancelled order.

## Mutation experiments

Runner: `payrev-mutate.py` in the session scratchpad (replace one exact snippet, run vitest, restore the file byte for byte). Each was reverted; `git status` showed only the scratch spec afterwards.

| # | Mutation (file) | Specs run | Result |
|---|---|---|---|
| M1 | `amount > remaining` -> `amount > remaining + 1` (`core/payments/refund.ts`) | core `src/payments` | Killed: 3 tests of `refund.spec.ts` |
| M2 | payment row `lockById` -> `findById` in `requestAdminRefund` (`payment-refunds.service.ts`) | API `src/payments` (all) | **Survived** (F3); killed by the warmed scratch spec E3 |
| M3 | `refundedAmount: current + refund` -> `refund` (`payment-changes.ts`) | API `src/payments` | Killed: `admin-payments.spec.ts` partial refunds, `payments-reconcile.spec.ts` cumulative limit |
| M4 | status route drops `row.orderId !== order.id` (IDOR) (`store-payments.service.ts`) | `src/payments/store` | Killed: `store-payments.spec.ts` "an attempt of another order is 404" |
| M5 | API ignores `bindFact` refusals (`payment-facts.service.ts`) | webhook and reconcile specs | Killed: 7 binding specs in `payments-webhook.spec.ts` |
| M6 | Monobank key refetch throttle removed (`monobank/src/signature.ts`) | monobank package | Killed: 2 specs of `webhook.spec.ts` (refetch at most once per 60 s) |
| M7 | Monobank page host allow-list removed (`monobank/src/invoice.ts`) | monobank package | Killed: `operations.spec.ts` "never hands a page on another host" |
| M8 | late payment without automatic refund (`core/payments/outcome.ts`) | core `src/payments` | Killed: `outcome.spec.ts` |
| M9 | admin refund drops the order-of-payment check (`payment-refunds.service.ts`) | API `src/payments` | Killed: `admin-payments.spec.ts` "another order's payment (404)" |
| M10 | refund claim check disabled (resend while a send is in flight) (`payment-refunds.service.ts`) | API `src/payments` | Killed: 2 specs of `payments-reconcile.spec.ts` (exactly one provider call; never sent again) |
| M11 | manual mark paid without the online-payment guard (`orders.service.ts`) | API `src/payments` | Killed: 2 guard specs, 1 webhook spec |
| M12 | create flow without the order row lock (`payment-create.service.ts`) | API `src/payments` (all) | **Survived** (F4) |
| M13 | fact application without the order row lock (`payment-facts.service.ts`) | races and webhook specs | Killed: 3 specs of `payments-races.spec.ts` |

## Verified OK

- Test suites at `e5ef529` with real services: API `src/payments` 11 files / 191 tests; core `src/payments` 17 / 147; `packages/providers/monobank` 12 / 71; `packages/providers/_fake-payment` 1 / 45; storefront payment specs 8 / 182; admin `src/areas/payments` 6 / 87. All pass.
- Migration `0008_payments`: up, down, up, down, up on an empty scratch database (`drizzle.__drizzle_migrations` 9 -> 8 -> 9 -> 8 -> 9; tables and the trigger function created and dropped each time). Indexes exist for every lookup the code makes (provider id, idempotency keys, live attempt, `next_check_at`, journal by payment, refunds by payment, both admin FKs).
- Signature: verified over the exact raw bytes before any parse (raw reader mounted before Nest's JSON parser, path-scoped, 64 KiB cap by `Content-Length` and while streaming); a re-serialized body never verifies; Monobank: P-256 key only from `GET /pubkey` with the token, refetch at most once per 60 s, `x-sign` only, DER length bounds (M6 killed).
- Replay and ordering: dedupe key `webhook:<sha256 raw body>` checked under the attempt lock and by the unique index; poll keys per attempt; stale `modifiedAt` journaled unapplied; `succeeded` never moves back; five identical webhooks at once give one `order.paid` (spec).
- Binding: reference, provider id, currency, exact amount, final amount and refund sums before anything pays (M5 killed); `markPaidIn` uses the attempt amount, which is the order total read under the order lock; no amount or currency is accepted from a client (strict bodies).
- State machines: one live attempt per order (partial unique index plus order lock), `create_unknown` never retried and closed at the invoice end, cancel and manual mark paid refused while `processing`, `creating` or `create_unknown` (M11 killed), late and duplicate successes refunded automatically after commit (M8 killed), expiry deferral capped at `placed_at + TTL + 30 min`.
- Refunds: cumulative limit under the payment row lock in production code (E3 passes unmutated), exactly-once send per claim with stale claims becoming `unknown` and never resent (M10 killed), `refunded_amount` only on `succeeded` (M3 killed), idempotency replay compares payment, amount, currency and note.
- Authorization: guest create and status open the order exactly like the lookup (one identical 404; a customer's order is 404 for a guest); customer owner filter in SQL; status of another order's attempt is 404 (M4 killed); admin refund of another order's payment is 404 (M9 killed); `payments.refund` for owner and manager only, viewer has no order permission; CSRF required on every store and admin write (specs).
- Redirects: return and webhook URLs only from `STOREFRONT_PUBLIC_URL`; Monobank `pageUrl` must be `https` on `pay.mbnk.biz` without port or credentials (M7 killed); the API re-checks `https` and visible ASCII; the storefront navigates only through `goToProvider` (https, host, no credentials, no whitespace or control characters); the return page's query id is only a hint and the status route checks ownership; guest tokens live in the URL fragment and `sessionStorage`, pages with tokens send `Referrer-Policy: no-referrer`.
- Information: logs carry codes, ids and error class names only (`describePaymentCall`), never bodies, headers, tokens or `errText`; admin views carry card system and last 4 only, no page URL or keys; shopper views never carry provider statuses, ids or codes.
- i18n: admin `payments.json` en/uk have identical keys (183); storefront en/uk differ only by Ukrainian plural forms.

## Not verified

- Anything against the real Monobank API (S1/S2 are owner steps): the live `X-Sign` format and padding, the webhook `Content-Type` (the route answers `415` to anything but `application/json`), whether a partially refunded invoice stays `success` with a lowered `finalAmount` (F1 assumes the documented shape; if Monobank reports a processing refund through `finalAmount`, `bindFact` refuses the fact as `final_amount_mismatch` and that refund settles only through attention), `extRef` dedupe (M13), `pageUrl` hosts (M23).
- The storefront and admin pages in a real browser (only their unit and component specs were run); screen-reader and keyboard behaviour beyond what those specs assert.
- The edge proxies passing the webhook body byte for byte (`infra/proxy`), and behaviour with several API instances (in-memory read throttles and the Monobank key cache are per process).
- Down migration with payment data present (only the empty-database cycle was run; the down script drops all payment history by design).
- Load: the attention list (`GET /admin/payments`) sorts by `created_at, id` without a matching index; not measured.

## Fixes (branch `fix/payments-review`)

Developer agent (Claude Opus 5.5), started from `origin/review/payments` so this review ships with its fixes. Constraints set by the orchestrator: no migration, no schema or CHECK change, no new attention code, no edit of an old ADR (the decisions are recorded here instead). Money logic test first (AGENTS.md section 13).

### F1 fix: refunds made outside the shop

- Attention: the existing `external_reversal` ("money returned that our own refunds do not explain, a refund made outside the shop"; already in `PAYMENT_ATTENTION_CODES` and `payment_attention_code_check`). No new code, no CHECK change.
- Core (`packages/core/src/payments/refund.ts`):
  - `refundableAmount({amount, finalAmount, refunds})` = `remainingRefundable` less the external part `max(0, amount - finalAmount - our succeeded refunds the final amount already shows)`, at least 0. `decideRefund` takes the optional `payment.finalAmount` and uses it, so `refund_exceeds_remaining` also covers money returned outside the shop.
  - `RefundRecord.inFinalAmount`: a `succeeded` refund of ours that an applied fact listed `succeeded`. Without it a stale stored final amount (the provider has not reported our latest refund yet) would let the same money count twice or not at all.
  - `externalRefundAmount` (the larger of the final-amount view and the listed refunds without our id or with an id we do not know, never their sum) and `decideExternalRefund` (attention when a fact shows more external money than the previously stored final amount did).
- API: `PaymentFactsService.applyIn` calls `decideExternalRefund` after settling our refunds on a `succeeded` attempt; `settleRefunds` records `payment_refund.provider_modified_at` on a refund that is already `succeeded` when a fact lists it `succeeded` (an existing column, its meaning unchanged: the provider's change time of the listed refund); `requestAdminRefund`, the automatic refund and the admin view use `refundableAmount` through `refundRecordOf`.
- Decisions (recorded here instead of editing ADR 0032):
  - D1. Re-use `external_reversal` for partial external refunds; the admin help text (uk and en) now says "all or part of the payment" and that the refundable amount already excludes it.
  - D2. Without new storage the shop cannot always tell, from the stored final amount alone, how much of the missing money was its own refund made after an external one. The attention rule errs towards raising: the fact after such a shop refund may raise `external_reversal` once more (never fewer); an external refund the provider still lists as `processing` raises it on every new fact until the final amount drops. Proved by core specs ("errs towards attention").
  - D3. `refundedAmount` stays the sum of OUR succeeded refunds; the money returned elsewhere shows as `finalAmount` and in `refundableAmount` only.
  - D4. An external refund the provider lists as `processing` raises attention but caps `refundableAmount` only once the provider lowers its final amount (the refund list is not stored). A provider is expected to refuse a refund above what it holds (the test provider answers `not_cancellable`, stored `failed` with `refund_failed`); not verified against Monobank.
- Behaviour without an external refund is unchanged (core specs per exponent 0/2/3, API spec "refunds made through the shop raise nothing").

### F2 fix: an order total of 0

- Core `decideNewPaymentAttempt` takes `orderTotal` (minor units; not a safe integer: RangeError) and refuses a total of 0 or less with the EXISTING rule `payment_not_available` ("Online payment is not available for this order."), checked right after `order_not_payable`. No new rule value, so the public problem contract (`docs/contracts/api.md`) does not change and the storefront already has a friendly message for it.
- API: the create flow passes `order.totalAmount` (under the order lock); the store order views pass it too, so `payment.canPay` is false. The create route answers `409 rule_violation payment_not_available` instead of `400 validation_failed check_violation`; no attempt row and no provider call.
- Decision D5: `payment_not_available` over `order_not_payable` (that one means paid, cancelled or expired, and the storefront says so) and over a new `payment_not_needed` (a public contract change, red zone).
- Open question for the owner (not decided here): should a free order be settled automatically (marked paid by the system at checkout) instead of waiting for an admin's manual mark paid? Until decided, a free order stays `awaiting_payment` and expires like any unpaid order unless an admin marks it paid.

### F3 fix: the refund concurrency specs race

- `PaymentWorld.warmPool(running?, connections = 10)` opens ten clients of the API's own `pg` pool at once and hands them back idle, right before the `Promise.all`; ten is the `pg` default pool size.
- `admin-payments.spec.ts` ("refunds at once ...") and `payments-reconcile.spec.ts` ("admin refunds keep the cumulative limit under concurrency") now send ten refunds of 1 200 on a 2 000 payment on a warm pool: exactly one accepted, nine `refund_exceeds_remaining`, one refund row. Every race of `payments-races.spec.ts` warms the pool first too.
- Mutation M2 again (`lockById` -> `findById` in `requestAdminRefund`), whole API `src/payments`: **killed** (2 failed of 196: the reconcile spec got 9 accepted refunds instead of 1, the admin route spec 202 + 409 x3 + 500 x6 instead of 202 + 409 x9). Restored byte for byte; unmutated the same specs pass.

### F4 fix: the order row lock of the create flow is covered

- New specs in `payments-races.spec.ts` ("a create racing a cancel, the expiry job or a manual mark paid"): the test holds the `payment` table (ACCESS EXCLUSIVE) on its own connection, starts the create, waits until it waits for a lock, starts the competitor (a guest cancel over HTTP, `OrdersService.expireOne` at the order deadline, an admin's manual mark paid over HTTP), waits until it waits too, then releases. Deterministic, no timing loop. Asserted: a cancel or mark paid is either `409 payment_in_progress` with the order still `awaiting_payment`, or succeeds and leaves no live attempt; the expiry job defers the order while the new attempt is live.
- Mutation M12 again (`orders.lockById` -> `orders.findById` at the start of the create transaction), whole API `src/payments`: **killed** (3 failed of 199): a cancelled order and a paid order each kept an `awaiting_customer` attempt, and the expiry job expired the order under a live attempt. Without the lock the competitor takes the order row first and its attempt read misses the new row; the create's insert only waits for the order row (foreign key) and then lands. Restored byte for byte; unmutated all pass.

### Open items

- Attention list index (review "Not verified", Minor): measured with `EXPLAIN (ANALYZE, BUFFERS)` on a scratch copy of the migrated schema seeded with 100 000 orders and one `failed` payment each (1 000 with open attention). The first page of `GET /admin/payments?needsAttention=true` is a sequential scan of the whole `payment` table plus a sort (17.5 ms, 2 379 buffers); a keyset page deep in the list the same (14.6 ms); the unfiltered list hashes every order (72.7 ms, 5 672 buffers). Cost grows linearly with the payment count. An index is warranted before real volume: a partial index `payment (created_at DESC, id DESC) WHERE needs_attention` for the attention list, and `payment (created_at, id)` if the unfiltered list is used. Not added: a migration is a red zone and needs its own approved step.
- Owner decision (F2): automatic settlement of a free order.
- Not verified against Monobank (F1): how a partial refund made in the cabinet is reported (assumed: listed in `cancelList` without `extRef`, `finalAmount` lowered once it succeeded) and whether Monobank refuses a refund above what it still holds.
