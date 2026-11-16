# Brevo transactional email

`@fluxkit/provider-brevo` implements the email port for one recipient per request. Select `EMAIL_PROVIDER=brevo` as primary or include `brevo` in ordered `EMAIL_FALLBACK_PROVIDERS`, set `EMAIL_FROM`, `STOREFRONT_PUBLIC_URL`, optional `EMAIL_REPLY_TO`, and provide `BREVO_API_KEY` through the runtime environment. The key is required, 1–1024 visible ASCII characters without whitespace, with no assumed prefix. Use an API key, not an SMTP password. Missing/unsafe keys fail startup with the variable name only.

- Verify the sender/domain and activate transactional email in Brevo. Use the dashboard's DKIM/DMARC records and check SPF alignment in received headers; keep tracking off.
- One Node fetch POST to `https://api.brevo.com/v3/smtp/email`, `api-key` header, no redirects, 64 KiB streamed response cap, caller abort/timeout. No SDK, startup network request or internal retry. Runtime Nest/zod dependencies use existing workspace pins.
- Body: `sender`, one `to`, `subject`, `htmlContent`, `textContent`, optional `replyTo`, category `tags`, and JSON `headers.idempotencyKey` containing the unchanged message UUID. No recipient-supplied custom headers, attachments, cc or bcc.
- Capabilities: `maxRecipients=1`, **`idempotencyKeys=false` until the inline request is live-verified**. Sending the UUID does not prove remote protection.
- Free adds **"Sent with Brevo" to every mail**; removing it requires a **paid Brevo plan**. Free excess mail may be accepted into a remote queue and arrive after Fluxkit's deadline. `sent` means acceptance, not inbox delivery.

## Result mapping and retry safety

| Answer | Result |
|---|---|
| Local invalid payload/key UUID or pre-abort | `not_sent`, no request |
| 201 with a validated `messageId` | success; preserve the reference verbatim |
| Valid 401/403 `unauthorized`/`permission_denied`; 400/402/403 `account_under_validation` | `misconfigured` |
| 400 `invalid_parameter`, `missing_parameter`, `out_of_range` | `rejected` |
| 400 `duplicate_parameter` | `idempotency_conflict` → `unknown`, never a manufactured success; remote protection stays unverified |
| Recognizable 429 envelope | `rate_limited`; bounded seconds `Retry-After` only |
| Credit-looking `not_enough_credits`, bare 402, unknown code/status, malformed/unreadable/oversized response, 408, all 5xx, transport/timeout/throw | `unavailable` until non-acceptance is proven |

Only documented allowlisted `code` values survive; free-form `message` is discarded. Credit periods/reset timezone are never guessed. Unverified `x-sib-ratelimit-reset` units are ignored; a verified seconds-based reset can be added after evidence, using the longer valid Retry-After.

An `unavailable` attempt or reclaimed lease permanently pins the row to that provider and original claim time. With current Brevo capabilities it ends `unknown`, **without automatic replay**. After authorized B2 verification, declare `idempotencyKeys=true` and `idempotencyWindowSeconds=1800`: pinned retries then stop strictly before `min(deadline_at, pinned_at + 30 minutes - 5 minutes)`. A restart never resets the pin/window. Unpinned safe refusals retain ADR 0031 backoff. Later rejection/render failure/deadline cannot disprove earlier acceptance, so a terminal pinned outcome is `unknown`; only authoritative success is `sent`. Cancellation stops local retries and cannot recall earlier mail; manual resend can duplicate it.

Step 1 introduced the plugin and step 1b its optional suppression webhook verifier; core owns suppression and receipt storage. Step 2 now supports an ordered chain and requires authenticated webhooks/valid secrets for every selected provider, including primary, whenever a fallback is configured. Changing configuration never unpins mail. A missing pinned provider holds the row with `pinned_provider_unavailable` and rechecks configuration every minute, bounded by the deadline. Restoring the same provider retries the same UUID only before its original safe cutoff; expiry becomes `unknown`. While the provider is absent its replay window is unknown; restored capabilities enforce it before any call.

## Suppression webhook

Set a dedicated `BREVO_WEBHOOK_SECRET` through the runtime environment: 43–1024 characters from `[A-Za-z0-9_-]`, generated with at least 32 random bytes. With one provider blank disables the route; a nonempty fallback chain requires this secret whenever Brevo is selected as primary or fallback. Invalid nonblank values or a secret equal to `BREVO_API_KEY` fail startup without printing either value. `readBrevoWebhookSecret` is its single accessor; restart after rotation. Do not reuse `BREVO_API_KEY`, use URL credentials or put the token in a query string.

With Brevo selected as primary or fallback and the secret configured, subscribe an HTTPS endpoint `/webhooks/email/brevo` to transactional `hardBounce`, `spam`, `unsubscribed` and `blocked`; configure webhook `auth` as `{type:"bearer", token:<dedicated token>}`. The expected header is `Authorization: Bearer <token>`. The plugin compares SHA-256 digests of bounded header values in constant time before JSON parsing. There is no documented body signature: a leaked token or compromised TLS terminator can forge payloads. Optional edge IP allowlisting, using current official webhook ranges and correct trusted-proxy settings, supplements the bearer token.

One JSON object per delivery is accepted. Actual payload `event` spellings `hard_bounce`, `spam`, `unsubscribed`, `blocked` map to `hard_bounce`, `complaint`, `unsubscribe`, `blocked`; soft bounces, delivered/opened/clicked and all other events are ignored. `email` is normalized through the shared validator; `ts_event` is UTC integer seconds. The receipt key is `v1:` plus SHA-256 of the validated tuple `(id, message-id, normalized email, event, ts_event)`. `id` is a webhook ID, never a unique event key on its own. Raw payloads and vendor text are not stored.

Core enforces at most 7 days old / 5 minutes future, then commits receipts and shared suppression before `204`; transient local failures use retryable `429`. Receipts expire after 8 days, independently of outbox retention. Manual block removal keeps receipts and sends nothing automatically. Configure and test the subscription and reconcile historical remote blocks before production fallback; never remove remote blocks to improve delivery rates.

TODO(fluxkit): not live-verified — exact bearer-header emission, subscriptions and payload event spellings/shapes, tuple stability, timestamps/retries, single-object delivery versus batching, and historical-block reconciliation. Local authenticated fixtures prove none of these remote behaviours.

## Live-check list

Every item is **TODO(fluxkit): not live-verified**; no key or live send was used. Local models do not establish remote behaviour.

- B1: inline sender/to/subject/HTML/text, replyTo/tags and exact message ID format/length.
- B2: UUID header casing/context, same body twice, concurrent duplicate, changed body, response loss and 30-minute expiry. A duplicate is not a replayed success. Correlation headers/log absence do not prove non-send.
- B3/B4: send-endpoint throttle envelope/status/code combinations, reset units and Retry-After; auth/domain/recipient refusals; credit refusal versus acceptance; 5xx envelopes remain ambiguous regardless of code.
- B5/B6: daily/monthly allowance/reset timezone, queue admission/expiry/cancellation and late delivery; actual Free HTML/text branding and tracking disabled.
- B7: sender/domain/account activation, reply-to, delivery to two mailbox services with SPF/DKIM/DMARC results.
- B8: current entity/terms/DPA, subprocessor locations/transfers and content/log retention. Documented EU database hosting does not establish EU-only processing.
- B9: tag/event visibility and reconciliation limits; absence from logs is not proof of non-send.
- Step 1b: webhook bearer-header emission, subscriptions/event shapes, stable tuple/timestamps/retries, single-object delivery versus batching, and historical-block reconciliation before fallback.

Live sends require a separate owner key and explicit recipient/send authorization. Do not call the real API from automated tests.

## Tests and removal

`pnpm --filter @fluxkit/provider-brevo test` runs the core contract, local HTTP recorder/model, request shapes, duplicates/TTL/lost responses, transport, hostile values, config/module and secret-redaction suites. Every file installs a guard that rejects external fetches; no-network wiring is checked separately. Matrix mode: `pnpm feature-matrix providers-email-brevo` (real services required).

Before deleting the package, stop all senders including immediate auth/admin/test/resend; reconcile/drain pinned Brevo rows and deferred routes. Never clear pins/change UUIDs or resend through another provider to work around ambiguity. Remove `brevo` from primary/fallback configuration, choose another primary or `none` with an empty fallback list, remove `BREVO_API_KEY`/`BREVO_WEBHOOK_SECRET`, disable the remote subscription, delete `packages/providers/brevo`, and relink the workspace. Missing pinned providers are held under `pinned_provider_unavailable`, then become `unknown` at expiry. No plugin-owned table/migration exists; core migration 0016 retains pin evidence, shared suppression/receipts remain core data, and migration 0018 owns route/cooldown state. Its down refuses pending/sending deferred routes; older guarded downs protect active pins/new-format IDs and suppression/audit evidence. Never delete/truncate evidence to permit rollback. Follow the [cutover/rollback procedure](../../../docs/deployment.md#ordered-email-fallback-and-usage-adr-0056-step-2).

References: [approved plan](../../../docs/plans/2026-11-15-brevo-email-failover.md), [ADR 0056](../../../docs/adr/0056-email-brevo-suppression-and-fallback.md), [send](https://developers.brevo.com/reference/send-transac-email), [idempotency](https://developers.brevo.com/docs/heterogenous-versions-batch-emails), [errors](https://developers.brevo.com/docs/how-it-works).

## Ordered fallback and advisory usage (ADR 0056 step 2)

- Recommended order: Resend primary, Brevo fallback. Brevo can accept excess mail into a remote queue rather than prove a quota refusal; acceptance is `sent`, not timely inbox delivery, and never triggers fallback. Free "Sent with Brevo" branding removal requires a paid plan. Existing `idempotencyKeys=false` stays unchanged until separately authorized exact inline-request verification; no custom header or missing log proves non-acceptance.
- All selected API keys load at startup. A nonempty fallback chain also requires migration 0017/queryable suppression and receipt schema, the shared sender guard, and valid authenticated webhook verifier/secret/route for each primary/fallback. Remote subscriptions, reachability and historical block reconciliation remain operator checks. No startup provider call occurs.
- Only unpinned proven-unsent quota/rate/misconfigured/not-sent results advance in order; rejection, shared suppression, conflict, ambiguity and remote acceptance do not. Brevo credit-looking unknown responses remain ambiguous. The same UUID/pin survives restart/reordering/removal and a later safe refusal cannot unpin it. Budget-deferred next routes survive restart; each provider is considered once per safe pass. PostgreSQL atomically fences outcome/pin/route/cooldown outside HTTP; DB failure permits no unrecorded fallback send. The existing shared 8/s pacer applies to the whole chain.
- Brevo's quota/reset timezone is unknown: no UTC reset is inferred. Proven non-Resend quota or misconfiguration uses an hourly recovery probe; rates use validated delay/backoff. Shared cooldowns only extend until a matching successful DB-time recovery probe clears them; key changes/restarts do not reset them. The Resend daily 00:05 UTC retry margin is specific to Resend.
- The advisory meter reports retained accepted sends by actual provider `sent_at`, across all Brevo accounts, in UTC day/month windows. Default caps: daily 300, monthly null; server `EMAIL_USAGE_LIMITS` can override. Null means no configured cap, not unlimited service; `providerResetAt` remains null. Comparisons at 80%/100% do not prove quota exhaustion or control routing. Counts are a lower bound: cleanup/erasure may reduce them; other applications and ambiguous acceptance are omitted; account changes are untracked and credential-change time is null. Key rotation preserves history. No remaining balance, account identity or credentials appear in status/export.
- TODO(fluxkit): not live-verified — all B1–B9 and webhook checks above, quota/refusal/reset/queue behaviour and a real-host cutover/rollback. Owner/legal review entity/terms/DPA/transfers/content retention for every selected primary/fallback; EU database hosting does not establish EU-only processing. These operator actions and live sends still need separate authorization.
