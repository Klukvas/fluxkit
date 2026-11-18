# Plan: LiqPay payment provider (second Ukrainian acquiring plugin)

Status: **proposed** (2026-11-18). Waiting for owner answers on the quiz below before any implementation. Follows ADR 0032 (online payments; LiqPay listed as later) and the Monobank plugin pattern (`packages/providers/monobank`, plan `docs/plans/2026-10-26-payments-monobank.md`).

## Goal

Let a Ukrainian shop take card / Apple Pay / Google Pay / Privat24 payments through **LiqPay** (PrivatBank) next to, or instead of, Monobank. Same safety rules as ADR 0032: no card data in Fluxkit, never trust the browser return, mark the order paid only from a verified provider fact (signed callback or status read), reconcile lost callbacks, automatic refunds of late/duplicate successes, admin full and partial refunds.

## Why LiqPay (product)

- Same public fee band as Monobank for UA cards (~1.3 %) and foreign cards (~2 %), without requiring a Monobank business account.
- Strong PrivatBank / Privat24 footprint for shoppers who do not use mono.
- Covers the common "client's current account is not in mono" case for white-label clients.

Monobank stays the default for shops that already bank there. Enabling both is already supported by `PAYMENT_PROVIDERS_ENABLED` (ADR 0032 decision 3 / plan question 7).

## What already exists (reuse, do not reinvent)

| Piece | Where | Reuse |
|---|---|---|
| `PaymentProviderPort`, fact rules, contract suite | `packages/core/src/payments/` | Implement the port; no change to money rules unless a quiz answer forces it |
| Loader / registry / create / webhook / job 11 / store+admin UI | `apps/api/src/payments/` | Load a second code; widen webhook content-type if needed |
| Monobank plugin shape | `packages/providers/monobank/` | Copy structure: config, http, signature, stub, no-network, contract specs, README |
| Fake payment provider | `packages/providers/_fake-payment/` | Keep for e2e; LiqPay is never the e2e driver |
| Matrix modes | `scripts/feature-matrix.sh` | Add `providers-payment-liqpay`; extend `providers-deleted` |
| Config contract | `docs/contracts/config.md`, `.env.example` | Add `LIQPAY_PUBLIC_KEY` / `LIQPAY_PRIVATE_KEY` |
| Storefront pay flow | `apps/storefront` payment redirect (CSP `form-action 'self'`) | Needs a handoff decision (below) |

## LiqPay facts (read 2026-11-18 from public docs; never called; no keys)

Sources: [Checkout](https://www.liqpay.ua/en/doc/api/internet_acquiring/checkout), [Callback](https://www.liqpay.ua/en/doc/api/callback), [Status](https://www.liqpay.ua/en/doc/api/information/status_payment), [Refund](https://www.liqpay.ua/en/doc/api/internet_acquiring/refund), [Invoice](https://www.liqpay.ua/en/doc/api/internet_acquiring/invoice). API version **7**. Signature: `base64( sha3-256( private_key + data + private_key ) )` over base64 JSON `data`. Node `crypto.createHash("sha3-256")` — **no new npm dependency**.

| Topic | Documented | Fluxkit impact |
|---|---|---|
| Checkout | Client-Server: browser **POST** `data`+`signature` to `https://www.liqpay.ua/api/3/checkout`. Server-Server: POST same pair to `https://www.liqpay.ua/api/request`. | Port expects an `https` **GET** `redirectUrl` and the storefront CSP allows only `form-action 'self'` (ADR 0032 / storefront README). Classic form POST alone does not fit. |
| Callback | POST to `server_url` with form fields `data` and `signature` (not JSON body + header). | Current webhook controller answers **415** unless `Content-Type: application/json`. Must accept `application/x-www-form-urlencoded` for LiqPay (or a provider-declared content type). |
| Status | `action=status` by `order_id` (or `payment_id`) via `/api/request`. | `getPayment` / job 11. |
| Refund | `action=refund` with `order_id`, `amount` (major units). Partial supported. | Map to port `refund`; no separate refund-id field in docs → UNKNOWN whether our refund UUID can be echoed back for settle-from-status. |
| Invoice | `invoice_send` returns `href` (GET-navigable) but requires **email** and sends the invoice mail. | Sends personal data; worse checkout UX. Not recommended for v1 Pay now. |
| Amounts | Decimal major units (`7.34`), currencies `UAH` / `USD` / `EUR`. | Convert from minor units with integer math only; never float money in core. |
| `order_id` | Unique per shop, max 255; a second payment with the same id is refused. | Use our payment attempt UUID (same role as Monobank `reference`). |
| Sandbox | Test keys / sandbox company in the LiqPay cabinet (details UNKNOWN until S1). | Same env vars; keys decide environment (like Monobank token). |

UNKNOWN / UNVERIFIED until live S1: exact sandbox key rules, whether unpaid checkout can be cancelled by API, refund idempotency / listing in status, callback retry policy and success HTTP codes, whether `payment_id` is always present, page host allow-list for any `href`, PRRO/`rro_info` behaviour, settlement and website requirements.

## Hard mismatch: redirect vs form POST

Fluxkit today:

1. `createPayment` → `{ providerPaymentId, redirectUrl }` with `https` URL.
2. Storefront assigns `window.location` once (`lib/payment-redirect.ts`); source guards forbid form posts to providers.
3. CSP: `form-action 'self'`.

LiqPay checkout needs a signed **POST** to `https://www.liqpay.ua/api/3/checkout`.

### Recommended handoff (A) — same-origin bridge

1. Plugin `createPayment` is **local** for the checkout payload: builds and signs `data`/`signature`, does not call LiqPay yet (`not_sent` until the browser posts). Sets `providerPaymentId` = our payment attempt id (LiqPay `order_id`).
2. `redirectUrl` = same-origin storefront handoff page built by the **API** from `STOREFRONT_PUBLIC_URL` + locale already used for `returnUrl`, e.g. `/{locale}/payment/handoff?payment=<id>` (provider-agnostic path; no provider host in storefront source).
3. Handoff page (storefront): authenticated to the order the same way as the return page; calls a new store route that returns `{ actionUrl, fields: { data, signature } }` only for a live attempt of an enabled form-handoff provider; auto-submits a POST form (no card fields).
4. CSP change (narrow): `form-action 'self' https://www.liqpay.ua` when LiqPay can be used (build-time from config, or always allow that one host when the template ships LiqPay — prefer **always allow the one host** so a fork that enables LiqPay later does not need a rebuild; document the trade-off).
5. "Continue payment" reopens the same handoff URL; the API re-signs fresh `data`/`signature` for the same `order_id`/amount/expiry (LiqPay UNIQUE `order_id` — re-sign must not create a second payment; S1 confirms).

### Rejected / later alternatives

| Option | Why not for v1 |
|---|---|
| B. Widen port with `handoff: { method, actionUrl, fields }` | Larger public contract; every client and the storefront change; useful later if several form-POST providers appear |
| C. `invoice_send` + `href` | Requires shopper email to LiqPay; sends personal data; email round-trip |
| D. Server POSTs checkout and follows redirects to invent a GET URL | Fragile, undocumented, may leak secrets into logs |
| E. Drop CSP `form-action` to `*` | Too wide |

## Webhook content type (required core change)

Today: JSON only → 415. LiqPay: `application/x-www-form-urlencoded` body with `data` and `signature`.

**Recommended:** keep raw-body capture; allow JSON **or** `application/x-www-form-urlencoded` (and optionally `multipart/form-data` if S1 shows it — start without multipart). The **plugin** verifies: for LiqPay, parse `data`/`signature` from the raw urlencoded bytes (do not trust a re-parsed object), recompute SHA3-256 signature with `private_key`, then decode base64 JSON and map to `ProviderPaymentFact`. Dedupe key stays SHA-256 of the raw body. Monobank path unchanged (still JSON + `X-Sign`).

Edge proxy: already routes `/webhooks/payments/*`; confirm body size 64 KiB still enough (LiqPay callbacks are small; UNKNOWN exact max — keep 64 KiB, refuse oversize).

## Scope (v1)

**In:**

- Package `packages/providers/liqpay` (code `liqpay`, kind `payment`): port implementation, stub, no-network guard, contract suite, secrets guards, README with UNKNOWN list.
- Env: `LIQPAY_PUBLIC_KEY`, `LIQPAY_PRIVATE_KEY` (required when `liqpay` is enabled); constants `https://www.liqpay.ua` for checkout and `/api/request`.
- Capabilities (recommended): `currencies: ["UAH"]` for v1 (match Monobank / first market); `partialRefunds: true`; `multipleRefunds: UNKNOWN → start `false` until S1 proves listing`; `invalidateUnpaid: false` until cancel of unpaid checkout is verified; `webhooks: true`.
- Operations: create (local sign + handoff URL from caller — see decision), `getPayment` (`action=status`), `refund` (`action=refund`), `verifyWebhook` (form signature). `invalidatePayment` → `not_cancellable` / `{ invalidated: false }` until proven.
- API: accept form-urlencoded webhooks; store handoff payload route; build handoff `redirectUrl` for providers that declare form handoff (capability or plugin metadata — prefer a small additive capability `formHandoff: true` on the port **or** a convention that `redirectUrl` host equals the shop origin). Exact shape fixed in implementation step after quiz.
- Storefront: handoff page + CSP allow `https://www.liqpay.ua`; keep one `window.location` assigner; source guards updated (form post only on the handoff page, only to allow-listed action URL from the API).
- Matrix: `providers-payment-liqpay`; `providers-deleted` removes `liqpay`; optional dual `monobank,liqpay` start check.
- Docs: contracts, api payments, files, privacy processors, dependencies, CHANGELOG, HANDOFF, admin help note (stub-only until S1).
- Integrations slice 1 secrets manifest (`fluxkit.secrets`) for public/private keys — additive, same pattern as monobank; runtime still env-only until integrations slice 2.

**Out of v1:**

- Hold / subscribe / paydonate / widget / iframe / split / token payments.
- PRRO `rro_info` on pay/refund (same stance as Monobank v1 unless owner says otherwise).
- USD/EUR for LiqPay (docs allow them; enable later by widening `capabilities.currencies`).
- WayForPay / Fondy / cash on delivery.
- Live calls without owner S1 go.
- Changing order totals, auth, or payment state machine beyond handoff + webhook content-type.

## Steps (after approval)

| # | Work | Owns |
|---|---|---|
| 0 | This plan + ADR note (short additive ADR 0059 or a "refines 0032" ADR: LiqPay plugin, form handoff, form-urlencoded webhooks) | Architect / orchestrator |
| 1 | Core: optional capability / handoff contract if needed; amount major-unit helpers kept inside the plugin | Developer |
| 2 | API: webhook content-type; handoff redirect URL builder; `GET` store handoff payload; OpenAPI + api-client | Developer |
| 3 | Plugin `packages/providers/liqpay` + stub + tests (no network) | Developer |
| 4 | Storefront handoff page + CSP + guards + unit/e2e (fake can stay the e2e provider; LiqPay covered by matrix + plugin specs) | Developer |
| 5 | Config, matrix, privacy/dependencies, docs, HANDOFF, CHANGELOG | Docs + Developer |
| 6 | Independent QA review (different agent) | QA |
| S1 | Owner live test with sandbox keys + public https webhook URL | Owner |
| S2 | Production merchant activation | Owner |

No migration expected (payment tables already generic). If a durable "form handoff" flag on `payment` is needed, that is a **red-zone migration** and needs a separate go — prefer deriving handoff from `provider_code` + registry capability so no schema change.

## Red zones (need explicit approval)

1. **Payments** — new live money path (plugin + handoff + refunds).
2. **Public contracts** — config vars; webhook accepted content-types; optional port capability; store handoff route; CSP `form-action` hosts (`docs/contracts/`).
3. **Auth / public surface** — unauthenticated webhook still; new store handoff read must be order-token / session protected like other payment status routes.
4. **External processor** — LiqPay in `docs/dependencies.md` and `docs/privacy/processors.md`.
5. **No new npm dependency** (recommended). If a LiqPay SDK were proposed later: refuse — use `fetch` + `node:crypto` like Monobank.
6. **No migration** (recommended). Stop if implementation discovers a schema need.

## Privacy

Callback and status payloads may include card mask, amounts, `order_id`, `payment_id`, err codes. Keep system + last4 only (same as Monobank). Do **not** send shopper email/phone/name in checkout v1 (`customer` / invoice email omitted). Description = order number text only (existing pattern). Personal-data inventory: no new tables; processor row for LiqPay.

## Risks

| Risk | Mitigation |
|---|---|
| Form handoff + CSP change is a security surface | Allow only `https://www.liqpay.ua`; handoff fields only from API; no provider name/host hardcoding in generic payment modules beyond CSP allow-list; source guards |
| `order_id` uniqueness blocks retries | One live attempt per order already; reuse same attempt id; invalidate/replace attempt creates a new UUID |
| Refund settle-from-status without refund id | Start with single refund tracking; mark UNKNOWN; S1; if status does not list partial refunds, set `multipleRefunds: false` and settle by amount |
| Create is local → `create_unknown` semantics differ | Local create that never left the process is `ok` with handoff URL; network starts at browser POST; lost browser post = unpaid attempt, job 11 status may be `error`/`failure`/not found |
| Dual providers UX | Existing: storefront shows choice when more than one enabled; no change |
| Integrations admin still env-only at runtime | Same as Monobank; secrets fields declared for later slice 2 |

## Owner quiz (answer before coding)

Recommended option first. Marked **[OWNER]** where judgement / money / legal is involved.

1. **[OWNER] Proceed with LiqPay v1 as the second payment plugin?**
   - **(Recommended) Yes**, plan above (form handoff + form-urlencoded webhook + UAH-only + stub tests; live S1 later).
   - Plan only for now; implement after a separate go.
   - No; prefer WayForPay / Fondy / wait.

2. **[OWNER] Checkout handoff?**
   - **(Recommended) A — same-origin auto-POST bridge + CSP `form-action` adds `https://www.liqpay.ua`.** Fits current `redirectUrl` model.
   - B — extend `PaymentCreated` with explicit handoff fields (larger contract).
   - C — `invoice_send` email invoice with `href` (sends email to LiqPay).

3. **[OWNER] Currency?**
   - **(Recommended) UAH only** in v1 (`capabilities.currencies: ["UAH"]`).
   - UAH + USD + EUR as documented.
   - Follow `SHOP_CURRENCY` if it is one of UAH/USD/EUR.

4. **[OWNER] Run alongside Monobank?**
   - **(Recommended) Allow both** via `PAYMENT_PROVIDERS_ENABLED=monobank,liqpay` (already designed); shopper picks when both on.
   - LiqPay replaces Monobank as the documented default; Monobank remains available.
   - Exactly one payment provider at a time (change loader — against ADR 0032).

5. **[OWNER] PRRO / fiscal data on LiqPay?**
   - **(Recommended) Omit `rro_info` in v1** (same as Monobank v1).
   - Include when the merchant enables PRRO (later step).

6. **Webhook content types?**
   - **(Recommended) Accept JSON and `application/x-www-form-urlencoded` on `/webhooks/payments/{provider}`; plugin verifies.**
   - Separate path `/webhooks/payments/liqpay` with its own parser middleware only (more special cases).

7. **Invalidate unpaid?**
   - **(Recommended) `invalidateUnpaid: false` until S1 proves a safe cancel for unpaid checkout.**
   - Call `invoice_cancel` / equivalent from day one (may be wrong for non-invoice checkout).

8. **Admin Integrations secrets?**
   - **(Recommended) Declare `fluxkit.secrets` for public_key + private_key like Monobank; runtime still env-only.**
   - Env only, no integrations manifest yet.

**[OWNER] outside the quiz:** sandbox public/private keys for S1 (env only, never in chat); public `https` URL for callbacks; production merchant activation and privacy notice naming LiqPay; accountant PRRO decision.

## Assumptions (approving the recommended answers approves these)

- Payments stay core; providers stay removable packages.
- No new dependency; no migration in v1.
- Card data never touches Fluxkit.
- Return URL query is never trusted.
- Monobank behaviour and tests stay green and unchanged in spirit.
- Feature matrix gains `providers-payment-liqpay`.
- Nothing is live-verified until S1.

## Verification (when implementing)

- Plugin: contract suite, signature vectors, stub ops, secrets, no-network.
- API: form-urlencoded webhook accept/reject matrix; handoff route auth; Monobank JSON webhook still works.
- Storefront: CSP unit test; handoff source guards; payment e2e still on `fake`.
- Matrix: `providers-payment-liqpay`, `providers-payment-none`, `providers-payment-monobank`, `providers-deleted`.
- Docs checks: `check:env`, `check:docs`, privacy processor row, dependencies entry.
- Not claimed without running: live LiqPay, production settlement, PRRO.

## Report template (implementation PR)

What changed; quiz answers recorded; commands run and results; S1 not run / run; open UNKNOWNs; docs updated.
