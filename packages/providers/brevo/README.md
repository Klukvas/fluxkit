# Brevo transactional email

`@fluxkit/provider-brevo` implements the email port for one recipient per request. Select `EMAIL_PROVIDER=brevo`, set `EMAIL_FROM`, `STOREFRONT_PUBLIC_URL`, optional `EMAIL_REPLY_TO`, and provide `BREVO_API_KEY` through the runtime environment. The key is required, 1–1024 visible ASCII characters without whitespace, with no assumed prefix. Use an API key, not an SMTP password. Missing/unsafe keys fail startup with the variable name only.

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

No suppression/webhook or fallback is implemented here (plan steps 1b and 2). Changing configuration never unpins mail. A missing pinned provider holds the row with `pinned_provider_unavailable` and rechecks configuration every minute, bounded by the deadline. Restoring the same provider retries the same UUID only before its original safe cutoff; expiry becomes `unknown`. While the provider is absent its replay window is unknown; restored capabilities enforce it before any call.

## Live-check list

Every item is **TODO(fluxkit): not live-verified**; no key or live send was used. Local models do not establish remote behaviour.

- B1: inline sender/to/subject/HTML/text, replyTo/tags and exact message ID format/length.
- B2: UUID header casing/context, same body twice, concurrent duplicate, changed body, response loss and 30-minute expiry. A duplicate is not a replayed success. Correlation headers/log absence do not prove non-send.
- B3/B4: send-endpoint throttle envelope/status/code combinations, reset units and Retry-After; auth/domain/recipient refusals; credit refusal versus acceptance; 5xx envelopes remain ambiguous regardless of code.
- B5/B6: daily/monthly allowance/reset timezone, queue admission/expiry/cancellation and late delivery; actual Free HTML/text branding and tracking disabled.
- B7: sender/domain/account activation, reply-to, delivery to two mailbox services with SPF/DKIM/DMARC results.
- B8: current entity/terms/DPA, subprocessor locations/transfers and content/log retention. Documented EU database hosting does not establish EU-only processing.
- B9: tag/event visibility and reconciliation limits; absence from logs is not proof of non-send.
- Later step 1b: webhook bearer authentication, subscriptions/event shapes, stable tuple/timestamps/retries and historical-block reconciliation before fallback.

Live sends require a separate owner key and explicit recipient/send authorization. Do not call the real API from automated tests.

## Tests and removal

`pnpm --filter @fluxkit/provider-brevo test` runs the core contract, local HTTP recorder/model, request shapes, duplicates/TTL/lost responses, transport, hostile values, config/module and secret-redaction suites. Every file installs a guard that rejects external fetches; no-network wiring is checked separately. Matrix mode: `pnpm feature-matrix providers-email-brevo` (real services required).

Before deleting the package, stop old senders and reconcile/drain pinned Brevo rows; do not clear pins or resend through another provider. Select `none` or another provider, remove `BREVO_API_KEY`, delete `packages/providers/brevo`, and relink the workspace. No plugin-owned table/migration exists; core migration 0016 keeps the evidence. Its down script refuses active pins or new-format IDs rather than deleting/truncating them.

References: [approved plan](../../../docs/plans/2026-11-15-brevo-email-failover.md), [ADR 0056](../../../docs/adr/0056-email-brevo-suppression-and-fallback.md), [send](https://developers.brevo.com/reference/send-transac-email), [idempotency](https://developers.brevo.com/docs/heterogenous-versions-batch-emails), [errors](https://developers.brevo.com/docs/how-it-works).
