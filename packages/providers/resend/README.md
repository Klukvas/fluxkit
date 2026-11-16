# @fluxkit/provider-resend

Purpose: the Resend email provider (code `resend`), ADR 0031 decision 17. It implements `EmailProviderPort` with one call: `POST https://api.resend.com/emails`, one transactional mail per request, the outbox message id as the idempotency key. Plan: `docs/plans/2026-10-26-email.md` (section 2 lists every Resend fact used, R1 to R18, with the pages they come from). **Built and tested against a local stub only: no request has reached Resend yet.** The live check is S1 below.

- Selection: `EMAIL_PROVIDER=resend` as primary or `resend` in ordered `EMAIL_FALLBACK_PROVIDERS` (with `EMAIL_FROM` on a domain verified in Resend; `STOREFRONT_PUBLIC_URL`, `https` in production).
- Manifest: `"fluxkit": { "provider": "resend", "kind": "email" }` in `package.json`.
- Entry: `src/index.ts` exports `providerModule`, loaded dynamically by `apps/api` only when `resend` is selected as primary or fallback.
- Dependencies: `@fluxkit/core`, `zod` 4.6.7 (the version the workspace pins); Node 22 `fetch`. No HTTP library, no Resend SDK.
- Plugin-owned routes, DB tables, migrations: none. Extension points used: the email provider loader/registry and optional raw-byte webhook verifier (`apps/api/src/email/registry`). Core owns the shared suppression storage and webhook route.

## Variable (read by this package, never by `loadEnv`)
| Variable | Rule |
|---|---|
| `RESEND_API_KEY` | Required whenever `resend` is selected as primary or fallback: `re_` followed by 16 to 256 visible ASCII characters (trimmed). Missing or malformed: the API refuses to start, naming the variable, never the value. Never logged, stored or returned; it travels only in `Authorization: Bearer <key>`. Use a **sending-only** key (the plugin calls no other route). Rotating it needs a restart. |
| `RESEND_WEBHOOK_SECRET` | Required when a nonempty fallback chain selects `resend`, including as primary. For a legacy single provider it is optional: blank disables `POST /webhooks/email/resend`. Nonblank must be `whsec_` plus canonical base64 of 16–128 bytes, otherwise startup fails without showing the value. Read once through `readResendWebhookSecret`; restart after rotation. |

There is no URL variable: the endpoint is the constant `https://api.resend.com/emails` (Resend documents no other region, R17), redirects are refused, and only a test can point `ResendHttp` at a stub on `127.0.0.1`.

## The request
`POST /emails` with `Authorization: Bearer <key>`, `User-Agent: fluxkit-provider-resend/1` (R6: required), `Idempotency-Key: <email_message.id>` (R4), `Content-Type: application/json` and the body:

| Member | Value |
|---|---|
| `from` | `EMAIL_FROM` written by core `formatMailbox`: `"Display Name" <address>` or the bare address (R2 shows `Name <address>`; the quoted form is the RFC 5322 equivalent, S1 confirms Resend takes it) |
| `to` | an array of ONE mailbox (R2 allows 50; v1 sends one) |
| `subject`, `html`, `text` | as rendered by the API; `text` is always sent |
| `reply_to` | `EMAIL_REPLY_TO` when set. **UNVERIFIED (R3):** Resend's page shows the parameter without its JSON key; `reply_to` is assumed and pinned by the stub. If S1 shows the received mail without that `Reply-To`, the member name is wrong and must change here |
| `tags` | `[{"name": "category", "value": <template category>}]` |

No `headers`, `cc`, `bcc` or attachments. The message passed core `validateOutgoingEmail` before the call (the plugin runs it again and answers `not_sent` without a request when it fails), and the body is JSON, so no value can add a header or a recipient.

## Answers and results
Mapped by HTTP status first (R8: `validation_error` appears on 400, 401 and 403); a documented error `name` refines it. Codes: the documented name (if any), then the status. Error `message` texts and unknown names are never kept (they can echo an address).

| Answer | Result |
|---|---|
| 2xx with `{id}` (R5) | success, `providerMessageId` = the id |
| 2xx that cannot be read (no body, not JSON, no id) | `unavailable` `malformed_answer`: the mail may have been accepted, so the outbox retries with the same key (Resend replays the first answer), never fails it |
| 400 / 422 with a documented name (`validation_error`, `invalid_idempotency_key`, `missing_required_field`, `invalid_parameter`, `invalid_attachment`) | `rejected` (the outbox fails the mail). R8 says a 400 `validation_error` may also be a bad key: accepted risk (ADR 0031), reduced by the key format check at startup and local validation |
| 400 / 422 without a documented name | `unavailable` `unnamed_error` (not an answer of Resend's documented shape; a retry with the same key cannot duplicate) |
| 401, 403 (key, testing mode, unverified domain, missing `User-Agent`), 404, 405 | `misconfigured` (the outbox retries hourly until the deadline; the operator acts) |
| 409 `invalid_idempotent_request` | `idempotency_conflict` (the outbox marks the mail `unknown`: an earlier attempt reached Resend with another body) |
| 409 `concurrent_idempotent_requests`, `resource_locked`, unnamed | `unavailable` (retry with the same key) |
| 429 `daily_quota_exceeded` / `monthly_quota_exceeded` | `quota_exceeded` with `quotaPeriod` `daily` / `monthly` |
| 429 otherwise (`rate_limit_exceeded`) | `rate_limited` |
| 408, 5xx | `unavailable` |
| other 4xx | `rejected`; other statuses: `unavailable` `unexpected_status` |
| no answer: network failure, refused redirect, timeout (the caller's signal), answer over 64 KiB | `unavailable` (`network`, `timeout`, `too_large`, `unreadable`) |
| the signal had fired before the request; a message that fails `validateOutgoingEmail` | `not_sent` (`aborted`; `invalid_message` and `<path>.<reason>` codes) |

`retry-after` is passed on as `retryAfterSeconds` when it is whole seconds (R7 documents seconds only; an HTTP-date or other form is ignored and the core schedule applies; at most 31 days). The plugin never repeats a request: one `send` is at most one request. Its only time limit is the caller's signal (the API's 10 s). It logs one warning per failure (`send: HTTP 429 -> rate_limited (rate_limit_exceeded,429) after 12 ms`) and nothing on success; never the key, an address, a subject, a body or Resend's text.

## Unverified (nothing was sent to Resend)
R3 (`reply_to`), R5 (the id is a UUID), R6 (403 without `User-Agent`), R9 (error body `{statusCode, name, message}`, LIKELY), R8's split of a bad key between 400 and 401, the quoted display name in `from`, the `retry-after` and rate-limit headers, R15 (whether a send to an address on Resend's suppression list answers `200`), R17 (no other region), R18 (data location, DPA: an owner action). Webhook live checks are listed below.

## Suppression webhook

With `resend` selected as primary or fallback and `RESEND_WEBHOOK_SECRET` set, configure an HTTPS subscription to `/webhooks/email/resend` for `email.bounced`, `email.complained`, `email.suppressed` and `suppression.added`. Use the endpoint's signing secret, never the API key. Optional edge IP allowlisting may supplement authentication using the provider's current official ranges; it never replaces signature verification. Keep trusted-proxy settings aligned with the actual edge.

The plugin checks `svix-id`, `svix-timestamp` and every supported `v1` in the space-separated `svix-signature` header. HMAC-SHA256 covers the ID, timestamp and original raw bytes; equal-length digests use constant-time comparison. Signed timestamps are within ±5 minutes. Permanent bounces alone become `hard_bounce`; complaints become `complaint`; `email.suppressed` and `suppression.added` become `blocked`. Soft bounces, delivery events and `suppression.removed` are ignored; there is no automatic unsuppression. `email.*` uses bounded `data.to` arrays; `suppression.added` uses `data.email`. Normalized recipients get stable per-recipient receipt keys, independent of array order. Vendor text is discarded.

Core enforces the separate 7-day event-age / 5-minute future policy, commits receipts and suppression atomically, and retains receipts 8 days. Manual removal keeps receipts; replay cannot re-add a removed block. Reconcile older events and existing remote blocks before production fallback. Never remove remote blocks to improve delivery rates.

TODO(fluxkit): not live-verified — subscriptions, exact event shapes (including permanent bounce/suppression), timestamps, stable retry IDs and historical-block reconciliation. Local vectors prove the verifier, not subscription delivery.

Tests include the [official complete Svix vector](https://docs.svix.com/receiving/verifying-payloads/how-manual) and self-generated raw-byte vectors. The `whsec_MfKQ…` / `msg_p5j…` / `1614265330` / `{"test": 2432232314}` tuple computes `PxHZe96mbQZz2qjqqFruykIqYbPOK6W3bwdPtIj4ocY=`; the documentation's illustrative `g0hM9…` signature does not authenticate that tuple and is tested as a rejection.

## Plan S1: the live check (the owner runs it; needs the owner's go)
One real mail to the owner's own address through `scripts/spikes/resend-verify.mjs` (`scripts/spikes/README.md`). Steps:
1. In the Resend dashboard: verify the sending domain (the DNS records the dashboard lists, R16) or accept testing mode (mail only to the account's own address, R8); create a **sending-only** API key.
2. Self-test the tool (local stub, no network): `node scripts/spikes/resend-verify.mjs --self-test`.
3. Put the inputs in the environment only (never as flags, never in a file in the repository):
   ```bash
   read -rs RESEND_API_KEY && export RESEND_API_KEY
   read -r RESEND_SPIKE_FROM && export RESEND_SPIKE_FROM        # "Shop Name <noreply@mail.your-domain>"
   read -r RESEND_SPIKE_TO && export RESEND_SPIKE_TO            # the owner's own address
   read -r RESEND_SPIKE_REPLY_TO && export RESEND_SPIKE_REPLY_TO  # optional; an address the owner can recognise
   ```
4. Read the plan without sending: `node scripts/spikes/resend-verify.mjs` (exits 2, nothing sent).
5. Send: `node scripts/spikes/resend-verify.mjs --confirm --out resend-findings.json` (one mail; the replay and the changed-subject request must not deliver a second one).
6. Open the received mail's headers: `Reply-To` must be `RESEND_SPIKE_REPLY_TO` (R3), the inbox must hold ONE mail (R4), and SPF, DKIM and DMARC should pass.
7. `unset RESEND_API_KEY RESEND_SPIKE_FROM RESEND_SPIKE_TO RESEND_SPIKE_REPLY_TO`; copy the hypotheses' verdicts (R1 to R9, R3 by hand) into the plan's step 6 row; a `DIFFERENT` verdict changes this plugin before production.

## Tests
`pnpm --filter @fluxkit/provider-resend test`: a local stub Resend on `127.0.0.1` (`src/test-support/stub-resend.ts`, invented data only; it models R4 idempotency, refuses what Resend documents refusing and, as its own rule, unknown body members) and a no-network guard (`src/test-support/no-network.ts`, a Vitest setup file) that fails a spec file on any request to another host (`src/no-network-wired.spec.ts` checks it is wired). Specs: the request shape, every status mapping, `retry-after`, idempotent replay and conflicts, the size cap, transport failures and aborts, hostile values, secrets (no fragment of the key or a personal value in logs or results), configuration, the module, the core contract check `checkEmailProviderContract`, the stub's strictness, and a static check of the sources (only `api.resend.com`, no socket module, no other variable).

How to remove: stop all senders (including immediate auth/admin/test/resend), reconcile/drain pending Resend pins and deferred routes, then remove `resend` from both primary/fallback configuration before deleting `packages/providers/resend`. Set another primary or `none` with an empty fallback list; remove `RESEND_API_KEY`/`RESEND_WEBHOOK_SECRET` and disable the remote subscription. A removed pinned provider never routes elsewhere: it is held with `pinned_provider_unavailable`, then becomes `unknown` at expiry. Never clear a pin/change a UUID or erase attempt evidence to force removal. No static provider import exists in core or `apps/api` (CI: `scripts/feature-matrix.sh providers-deleted`). Shared suppression/receipts remain core and block every sender. Core migration 0018 down refuses pending/sending deferred routes; older guarded downs protect pins and suppression/audit data. See the [cutover/rollback procedure](../../../docs/deployment.md#ordered-email-fallback-and-usage-adr-0056-step-2).

## Ordered fallback and advisory usage (ADR 0056 step 2)

- Recommended primary Resend, fallback Brevo: `EMAIL_PROVIDER=resend`, `EMAIL_FALLBACK_PROVIDERS=brevo`. All selected API keys must load; a nonempty chain requires every selected authenticated webhook/secret, migration 0017/queryable suppression/receipts and the shared sender guard. Configure subscriptions and reconcile historical remote blocks before production. Startup makes no provider call and cannot prove remote readiness.
- Unpinned, proven-unsent quota/rate/misconfiguration/not-sent outcomes may advance in order; rejection/suppression and ambiguous history never advance. A timeout/unavailable result or reclaimed lease pins Resend and the original UUID permanently, including after a later quota refusal. Actual acceptance records Resend; remote queueing/later bounces do not initiate fallback. A deferred next-provider route survives restart, and every provider is considered at most once per safe pass.
- PostgreSQL shares/fences outcome, pin, route and cooldown; no transaction surrounds HTTP. Proven Resend daily quota waits until the next 00:05 UTC; monthly/unknown quota and misconfiguration use an hourly probe, rates use validated delay/backoff. Cooldowns only extend until a matching successful DB-time recovery probe clears them; other instances use fallback or wait. Key rotation/restart does not reset state. One shared 8/s pacer covers the entire chain; DB failure never permits an unrecorded fallback send.
- The status meter counts retained accepted rows by actual provider and UTC daily/monthly `sent_at`, across all Resend accounts (`provider_all_accounts`, lower bound). Defaults are 100/day and 3,000/month, overridable through server `EMAIL_USAGE_LIMITS`; comparisons at 80%/100% are advisory, never exact balance or automatic routing. Cleanup/erasure can reduce counts, other applications/ambiguous acceptance are omitted, and account changes are untracked with null credential-change time. Key rotation does not reset history. Null limits mean no configured cap. Midnight reporting/reset differs from the 00:05 retry margin; no account identity or secret appears in status/export.
- TODO(fluxkit): not live-verified — send/quota/refusal/reset semantics, exact retry/header behaviour, suppression subscriptions and historical reconciliation. Owner-controlled sends and legal/DPA/entity/transfer/content-retention review remain separate prerequisites; local stubs do not establish live semantics. Every configured fallback is also a processor and belongs in the shop's privacy notice/export.
