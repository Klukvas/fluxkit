# 0031. Transactional email

Status: accepted 2026-10-26 (owner's quiz answers on `docs/plans/2026-10-26-email.md`, recorded in its section "Owner answers"; the questions not marked for the owner are taken as recommended by the orchestrator, the owner may revisit any of them). The red-zone items named in that plan's "Needs approval" section are approved by those answers: the customer password reset and email verification routes, the token table and rules, session revocation on reset and the new rate limits (auth); migration `0007_email` with `email_message` and `customer_auth_token` (schema); the new store and admin routes, the additive `emailVerified` and `emailDelivery` members, `EmailProviderPort`, the template contract and its override rule, the template keys and the new `rule_violation` rules (public contracts); `EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `STOREFRONT_PUBLIC_URL` read by the API, `RESEND_API_KEY`, `FAKE_EMAIL_CAPTURE_FILE` and the second use of `ORDER_TOKEN_SECRET` (config schema); the permission `email.manage`; the CI matrix modes `email-on|off|deleted` and `providers-resend` and jobs 9 and 10; Resend as an external service and processor; the internal refactor of the shipping provider manifest scan. No new dependency. What needs the owner's own action waits for it: the live test send S1 (plan step 6) needs the owner's `RESEND_API_KEY` and go, production needs a verified sending domain and the processor terms (R16, R18). Builds on ADR 0009 and 0010 (admin auth, kept apart), 0016 (customer accounts; this ADR closes its `TODO(fluxkit): needs the email provider plan`), 0018 (events and ports; the "email notifier" it named), 0021 and 0025 (bounded jobs, claim and lease, `DiscoveryService`), 0023 (derived tokens), 0026 and 0027 (one origin, typed client, the admin never retries a write), 0028 (port in core, driver in a package), 0029 and 0030 (provider loader, typed provider result, contract suite, no-network guard). Changes none of them; supersedes nothing.

Nothing described under Decision is built yet. Each item is a requirement for the implementation steps 2 to 13 of the plan. Resend facts carry the plan's R-numbers (plan section 2, read 2026-10-26, never called); UNKNOWN marks what the documents read do not state.

## Context

- **No mail exists.** There is no mail port, provider, loader, outbox, template, mail i18n catalog, auth token table, reset or verification route, order mail, API-side public URL or admin email screen. ADR 0016 shipped without password reset and verification ("needs the email provider plan"); `customer.email_verified_at` exists and is always null so that this work needs no column for it; customers have no locale column.
- **Admin recovery exists without mail:** the owner resets an admin password (`POST /admin/users/{id}/reset-password`) and `pnpm admin:unlock` clears a lockout (ADR 0010). There is no invitation flow.
- **The `domain_event` outbox** (ADR 0018, 0021, 0025) carries ids-only payloads, at least once; a retry calls ALL handlers of the event; 30 s handler timeout; at most 10 attempts with backoff anchored to `created_at`; dispatched rows are deleted after 7 days. `order.placed|paid|cancelled|expired|fulfilled` and `shipment.created|status_changed|cancelled` are written; `customer.registered` is reserved and never written.
- **Reusable pieces:** `OrderReadPort.getOrder` (contact data, `shipments[]` with `trackingNumber`), `sales_order.locale`, the guest order token derived from `ORDER_TOKEN_SECRET`, `order_id` and `idempotency_key` (ADR 0023) with the link `/{locale}/order/{number}#t={token}`, eight bounded scheduler jobs (job 8 is the precedent for network calls outside transactions), the shipping provider loader and its manifest scan, `ProviderResult` and `ProviderAbortSignal` in core, the Nova Post plugin as the reference for `http.ts`, a stub server, a no-network guard and a contract suite, core `validateEmail`, the named in-memory rate limit windows, `GET /store/config` and `GET /admin/config`.
- **Configuration:** `STOREFRONT_PUBLIC_URL` is read by the storefront only; the API has no public base URL; no shop name setting exists.
- **Theme tokens** are CSS variables; mail clients do not support CSS variables.
- **Resend** is the owner's choice for the first provider. No key was available when the plan was written; nothing was sent.

## Decision

### 1. Scope (owner answers 1 to 3; plan questions 4, 5, 10 to 12 as recommended)
- In v1: the core port and outbox, the Resend plugin and a test-only fake, customer password reset with a "password changed" notice, optional customer email verification, order mails (`order.placed`, `order.paid`, `order.cancelled`, `order.expired`, `shipment.created`), admin status, test send, outbox list with resend and cancel, template preview; storefront pages for forgot password, reset password and verify email.
- Later, each with its own plan or step: Resend webhooks with a local suppression list (plan question 5); admin password reset and invitations by email (owner answer 3: none in v1; `pnpm admin:unlock` and the owner reset stay); a staff "new order" notification (question 12); attachments; per-shop template editing in the admin; a second provider; `customer.registered` emission; a customer locale column; scheduled sends; a preview CLI (question 11).
- Non-goals: marketing or bulk mail, newsletters, consent management, open or click tracking (no pixels, no rewritten links; Resend tracking stays off), any provider key or call in a browser, storing rendered bodies or raw tokens.
- `order.fulfilled` and `shipment.status_changed` send nothing in v1.

### 2. Boundaries (core, no feature flag)
- **Email is core** (plan question 1 and "Assumptions to confirm"): auth needs it. The "off" state is `EMAIL_PROVIDER=none` (decision 11); there is no feature flag beyond it.
- `packages/core/src/email/` (pure, TDD, no I/O, enforced by dependency-cruiser): `EmailProviderPort`, `EmailProviderResult`, the metadata key `fluxkit:email-provider`, the kind `"email"`, the contract suite `checkEmailProviderContract`, address and display-name checks, subject sanitizing, the retry schedule and deadline, status transitions (data), the dedupe key builder, auth-token rules (`evaluateAuthToken`: expiry, single use, purpose, email match, active customer), the token derivation message layout (the HMAC itself is behind a port, as ADR 0023), `escapeHtml`, the `html` tagged-template helper and the template contract.
- `apps/api/src/email/` (core module): loader and registry, outbox repository, sender, jobs 9 and 10, template registry, built-in templates and their uk/en catalogs (`templates/`), order and shipment event handlers (`handlers/`), the auth token service (`auth/`), store and admin controllers (`admin/`).
- `@fluxkit/theme` exports `emailTheme` (decision 13).
- Providers: `packages/providers/resend` (code `resend`) and `packages/providers/_fake-email` (code `fake`, test only). The existing dependency-cruiser rules `core-must-not-import-providers` and `apps-must-not-import-providers` cover them; nothing imports a provider statically.
- Store and admin client methods live in `packages/api-client` (ADR 0026, 0027).

### 3. `EmailProviderPort` and `EmailProviderResult`
Internal until the first external plugin; then listed in `docs/contracts/`. Shape (exact types fixed in plan step 2):

```ts
interface EmailProviderPort {
  readonly code: string;                                  // "resend"
  readonly capabilities: { idempotencyKeys: boolean; maxRecipients: number };
  send(message: OutgoingEmail, options: { idempotencyKey: string }, signal: ProviderAbortSignal):
    Promise<EmailProviderResult<{ providerMessageId: string }>>;
}
interface OutgoingEmail { from: EmailAddress; replyTo?: EmailAddress; to: EmailAddress; subject: string; html: string; text: string;
  tags: { category: string } }                            // one recipient per message in v1; no cc/bcc; no attachments
// EmailProviderResult<T> = {ok: true, value: T}
//   | {ok: false, reason: "unavailable" | "rate_limited" | "rejected" | "misconfigured" | "quota_exceeded" | "idempotency_conflict" | "not_sent",
//      retryAfterSeconds?: number, providerCodes: string[]}
```

- `not_sent`: the provider proves nothing left the process (local validation, abort before the request); always safe to retry. `unavailable`, a timeout, a thrown error and a malformed answer may have sent: retried with the SAME idempotency key.
- Codes only, never provider message text (it can echo addresses).
- The API, not the plugin, decides the timeout (10 s per send, through the abort signal), logging and retries. `ProviderAbortSignal` is the core type of ADR 0029.
- No `checkConnection` member: a Resend sending-only key cannot call other endpoints (R8 `restricted_api_key`), so the admin "test" is a real test send (decision 15).
- A reusable contract suite in core (typed results, codes not messages, abort honoured, idempotency key passed through, one recipient) runs in both provider packages.

### 4. Provider selection and loading (plan question 8)
- **One provider**, selected by `EMAIL_PROVIDER`: exactly `none` (default), `resend` or `fake`. Not a list, no failover.
- **Generalized manifest scan:** the scan in `shipping-provider-loader.ts` becomes `loadProviderPackages({kind, enabled, providersDir})`, an internal refactor with no behaviour change (the shipping loader specs stay unchanged and green). The email loader calls it with `kind: "email"` and `[EMAIL_PROVIDER]`. A package declares `"fluxkit": {"provider": "<code>", "kind": "email"}`; other kinds are skipped. Codes are unique per kind (`fake` exists for shipping and for email).
- `none` loads nothing and reads no provider folder. An enabled provider that is missing or broken fails startup (ADR 0029 decision 8).
- **Registry:** discovery of the class marked `fluxkit:email-provider` with `DiscoveryService`; port-method and code checks as `ShippingProviderRegistry`.
- `fake` is refused when `NODE_ENV=production` (`TEST_ONLY_EMAIL_PROVIDERS`).
- **CI:** matrix modes `email-on` (fake), `email-off`, `email-deleted` (folder removed); the observable is the startup log line `Email provider loaded: <code|none>`. Mode `providers-resend` runs with the stub and checks that no request goes to Resend at startup.

### 5. Dedicated outbox `email_message`, not `domain_event` (red zone: schema)
- **Decision:** mail is delivered from its own table `email_message`, fed by domain-event handlers and by auth flows.
- **Why not `domain_event`:** a `domain_event` retry calls every handler of the event again (ADR 0021), so a slow or failing provider would re-run unrelated handlers; delivery state per mail (sent, provider id, dead, resend, cancel) has no home there; its retries are anchored to `created_at` (ADR 0025 known gap) and capped at 10; dispatched rows are deleted after 7 days; auth mails (reset, verification) have no domain event.
- **What is reused:** an event handler only INSERTS an `email_message` row, idempotent by the unique `dedupe_key = <eventId>:<templateKey>` with `ON CONFLICT DO NOTHING` (a fast database write inside the 30 s handler budget; a redelivered event makes no second row). Auth flows insert the row in the SAME transaction as the token row.
- **Columns** (migration `0007_email`, hand-written `0007_email.down.sql` that also deletes its `drizzle.__drizzle_migrations` row; up, down, up, down tested; exact types and CHECK texts fixed in plan step 3 within these rules):

| Column | Rule |
|---|---|
| `id` uuid PK | also the provider idempotency key |
| `template_key` text, `template_version` int | key `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`; the version the template had at enqueue |
| `locale` | `LOCALE_PATTERN`; the order's locale, else the locale the shopper used on the page, else `DEFAULT_LOCALE` |
| `to_address` | normalized, `EMAIL_MAX_LENGTH`, CHECK no control characters; one recipient |
| `recipient_kind` | `customer`, `guest`, `admin` (test sends) |
| `customer_id`, `order_id`, `admin_user_id` | -> `customer`, `sales_order`, `admin_user`, each ON DELETE SET NULL |
| `variables` | JSONB object, CHECK `pg_column_size < 16 KiB`, validated by the template's schema at enqueue and at render |
| `dedupe_key` | text UNIQUE NULL (event mails); NULL for auth mails and manual resends |
| `status`, `attempts`, `next_attempt_at`, `lease_until`, `deadline_at` | CHECK lists; partial index `(next_attempt_at) WHERE status IN ('pending','sending')` |
| `provider_code`, `provider_message_id`, `last_error_code` | codes only, `^[A-Za-z0-9_.:-]{1,64}$` |
| `resend_of` -> `email_message`, `created_by_admin_id` | both SET NULL; manual resend and test send |
| `created_at`, `sent_at`, `updated_at` | |

- **Statuses:** `pending`, `sending`, `sent`, `failed`, `unknown`, `cancelled` (admin, only from `pending`); transitions are data in core. `sent` means accepted by the provider, not delivered.

### 6. Claim, send, record: no transaction around a network call
1. **Claim** (short transaction, committed before any network call): `UPDATE email_message SET status='sending', attempts=attempts+1, lease_until=now()+interval '2 minutes'` for rows that are `pending` with `next_attempt_at <= now()` or `sending` with `lease_until < now()`, chosen with `FOR UPDATE SKIP LOCKED LIMIT n`, `RETURNING` the rows.
2. **Render and send with NO transaction open:** render from the stored template key, version, locale and frozen variables; derive any auth token or guest order link at render time; call `send` with `Idempotency-Key = email_message.id` and a 10 s timeout.
3. **Record** (short transaction, guarded by `status='sending' AND attempts = <claimed>`): `sent` with `provider_message_id`; or back to `pending` with `next_attempt_at` from core `nextEmailAttempt(attempts, reason, retryAfter)`; or `failed` or `unknown` with `last_error_code`.
- The claim and record transactions carry the `withJobTransaction` limits. No mail is sent from inside a transaction.
- **Who sends:** job 9 `send-emails`, after job 3 `dispatch-events` in the same tick (an order mail created by a handler goes out in that tick), pages of 20, budget 30 s, a pause when the provider reports `rate_limited`, at most 8 sends per second per process (R7). Plus an **immediate attempt** after the commit of a reset or verification request: the request process claims that one row through the same claim statement, outside the request's transaction, without blocking the answer (fire and forget with its own error log); a lost attempt is picked up by the job after the lease.
- **Multi-instance:** `SKIP LOCKED` and the lease keep several API instances and `pnpm jobs:run-once` from sending one row at the same time; the scheduler lock runs job 9 on one instance per tick.
- **Reasons to status:**

| Result | Status |
|---|---|
| `rejected` (400 field errors, 422) | `failed` at once |
| `idempotency_conflict` (409 `invalid_idempotent_request`: an earlier attempt reached Resend with another body, a mail may have gone out) | `unknown`, never retried automatically |
| `misconfigured` (401, 403) | `pending`, hourly retry until the deadline; one error log per process and code |
| `rate_limited`, `quota_exceeded` (429) | `pending` after `retry-after`; daily quota: next 00:05 UTC; capped by the deadline |
| `unavailable` (timeout, network, 5xx, 409 `concurrent_idempotent_requests`, `resource_locked`, thrown error, malformed answer), `not_sent` | retry |
| template missing or variables invalid at render | `failed` `template_unavailable` / `variables_invalid`, error log |

- Process crash after a claim: the lease expires after 2 minutes and the next claim retries with the same key.

### 7. Idempotency key, retry schedule and deadlines
- The idempotency key is `email_message.id` (a UUID, within R4's 1 to 256 characters). Every attempt of one row sends the same key; a manual resend is a new row and a new key.
- Retry schedule (core `nextEmailAttempt`): 1, 2, 5, 10, 20, 40 minutes, then hourly; `retry-after` is honoured.
- **Deadline:** a message is never sent after `deadline_at`; past it the next claim marks it `failed` `deadline_passed`. `deadline_at = created_at + 12 hours`; auth mails: the token's expiry, at most 1 hour (see open question 1). 12 h stays inside Resend's 24 h idempotency window (R4), so every retry of one message is deduplicated by Resend.
- Rendering is pure, deterministic and synchronous: the same stored input gives the same bytes, because Resend refuses a changed body under the same key (R4). A template changed between attempts ends in `unknown`; the admin decides (resend makes a new row and key).

### 8. Retention and personal data (plan question 7)
- The outbox keeps the template key, version, locale, the address and frozen minimal variables (order number, line titles, quantities, totals, method title, tracking number; for auth mails only the token row id).
- **Never stored:** rendered HTML or text, raw tokens, guest order tokens or links, passwords, keys, provider message texts, IP addresses or user agents, open or click data.
- Job 10 `purge-email-messages` deletes rows in a final status older than 30 days; `failed` and `unknown` after 90 days.
- Logs carry the message id, template key, status, provider codes and durations; never addresses, tokens, links, variables, subjects or provider text (a log-capture spec proves it).
- A customer deletion sets `customer_id` NULL; the privacy plan must also delete or anonymize that customer's rows (an erasure query is documented).
- Transactional only: every mail is caused by an action of its recipient or by their order. No unsubscribe link and no `List-Unsubscribe` header in v1; a short footer says why the person received it.

### 9. Auth tokens (plan question 9; red zone: auth and schema)
- **Table `customer_auth_token`** (customers only; admin tokens would get their own table, ADR 0016 keeps the principals apart): `id` uuid PK (random; input of the derivation), `customer_id` -> `customer` ON DELETE CASCADE, `purpose` (`password_reset`, `email_verification`, CHECK), `token_hash` (SHA-256 hex, UNIQUE), `email` (the address the token was sent to), `created_at`, `expires_at`, `used_at`; index `(customer_id, purpose, created_at)` for the per-address limit.
- **Derivation:** `token = base64url(HMAC-SHA256(ORDER_TOKEN_SECRET, "fluxkit:customer-auth-token:v1\n" + purpose + "\n" + tokenId))`, the ADR 0023 technique with its own domain-separation label. The row stores only `SHA-256(token)`; the outbox stores only `tokenId`; the sender derives the token while rendering. A database leak alone yields no usable token (the secret is not in the database) and the outbox never holds a bearer secret.
- 256-bit output; lookup by the hash index (no early-exit compare on user input). Core `evaluateAuthToken` checks existence, purpose, not used, not expired, customer active and `email = customer.email`.
- Lifetimes (constants in core): reset 60 minutes, verification 48 hours. A token is single use and is invalidated by a newer token of the same purpose, by a password change, by deactivation and by deletion of the customer.
- Rotating `ORDER_TOKEN_SECRET` invalidates unclicked reset and verification links (at most 48 h) and guest order links (documented).

### 10. Flows v1
**Password reset** (owner answer 1; plan question 10):
- `POST /store/account/password-reset {email, locale}` (public, CSRF header, strict body): always `202 {}` with the same body and headers whether or not an account exists, is active or is locked. For an active customer with that email, one transaction marks earlier unused reset tokens used, inserts a token and an `email_message` (`customer.password_reset`, `variables {tokenId}`, deadline as decision 7); then the immediate attempt. Unknown emails send nothing (no relay to arbitrary addresses).
- Limits: `passwordReset` 5 per 15 minutes per address; at most 3 tokens per email per hour counted in the database (spans instances; over the limit nothing is created and the answer is the same `202`). Both branches run the email validation and one indexed select; the answer is sent after a fixed floor of 400 ms.
- `POST /store/account/password-reset/confirm {token, newPassword}` (public, CSRF, limit `passwordResetConfirm` 10 per 10 minutes per address): every token failure is ONE answer `400 validation_failed` at `path: "token"` with code `invalid_or_expired`; the password policy is the registration's. scrypt runs outside the transaction; then one transaction locks the customer row, re-checks the token and the hash it saw, sets the password and `password_changed_at`, clears the lockout, marks the token used, invalidates the customer's other reset tokens, **revokes every session** of the customer and enqueues `customer.password_changed` (no token). Answer `204`; no automatic sign-in.
- Link: `{STOREFRONT_PUBLIC_URL}/{locale}/account/reset-password#t={token}`.

**Email verification** (owner answer 2: optional):
- Sign-in at registration stays as today; registration keeps `201` and `409 conflict` on a taken email (ADR 0016 trade-off, rate limited). When a provider is configured, the register transaction also inserts a verification token and `customer.verify_email`.
- `POST /store/account/verify-email {token}` (public, CSRF, the shared `passwordResetConfirm` window): sets `email_verified_at` and marks the token used; the single `400 invalid_or_expired` for every failure; `204` again for an already verified customer presenting a valid used token.
- `POST /store/account/verify-email/resend` (customer session, `verificationResend` 3 per hour per customer, invalidates older tokens): `204`; `409 rule_violation already_verified`.
- `GET /store/account/me` gains `emailVerified: boolean` (additive). Verification unlocks nothing in v1; it is the prerequisite for attaching guest orders by email later.

**Order and shipment mails** (plan question 4):

| Event | Template | Content (frozen variables) |
|---|---|---|
| `order.placed` | `order.placed` | number, lines (title, variant title, quantity, line total), subtotal, shipping, total, method and pickup point or address city, "awaiting payment" with the payment deadline; for a guest the order link with the token derived at render time from `order_id` and `idempotency_key` (ADR 0023); for a customer the account order link |
| `order.paid` | `order.paid` | number, total, "being prepared" |
| `order.cancelled` | `order.cancelled` | number; no reason text |
| `order.expired` | `order.expired` | number, "not paid in time, stock released" |
| `shipment.created` | `shipment.created` | number, carrier name (method title snapshot), tracking number from `OrderReadPort` |

- Recipient: the order's email, also for a deactivated customer or a customer without an account (the mails concern the order).
- Handlers in `apps/api/src/email/handlers/` read the order through `OrderReadPort` only and insert with the dedupe key; with `EMAIL_PROVIDER=none` they do nothing.
- The guest link is a bearer link to one order (read, and cancel while unpaid), accepted because the same address placed the order; never stored in the outbox.

### 11. No provider configured (`EMAIL_PROVIDER=none`)
- No provider package is read. Jobs 9 and 10 run and find nothing. Event handlers return at once: no rows, no side effects; turning mail on later never sends mails for old events.
- `GET /store/config` and `GET /admin/config` gain `emailDelivery: boolean` (additive). With `false` the storefront hides "Forgot password?", the verify banner and "send again"; the admin Email area shows "No email provider configured" with the setup steps and no actions.
- `POST /store/account/password-reset`, `.../confirm`, `POST /store/account/verify-email` and `.../resend` answer `404 not_found` (as a feature that is off), so no client can believe a mail was sent. Registration keeps today's answer and creates no token.
- Admin: status answers `200 {configured: false}`; test send and resend answer `409 rule_violation email_not_configured`; the list and the preview work.
- Startup logs `Email provider loaded: none`; a production start with `none` logs one warning ("customers cannot reset passwords").

### 12. Configuration (red zone: config schema)

| Variable | Read by | Required | Default | Rule |
|---|---|---|---|---|
| `EMAIL_PROVIDER` | `loadEnv` | no | `none` | `none`, `resend` or `fake`; `fake` refused in production |
| `EMAIL_FROM` | `loadEnv` | when the provider is not `none` | none | `Display Name <local@domain>` or a bare address; no CR, LF, NUL, no `<>` inside the name, at most 200 characters |
| `EMAIL_REPLY_TO` | `loadEnv` | no | none | one address, same checks |
| `STOREFRONT_PUBLIC_URL` | `loadEnv` (new reader; same variable and format as `loadStorefrontEnv`) | when the provider is not `none` in production | `http://localhost:3001` outside production | `https` required in production |
| `RESEND_API_KEY` | `packages/providers/resend` (own parser) | when `EMAIL_PROVIDER=resend` | none | `re_` followed by 16 to 256 visible ASCII characters; never logged, stored or returned; errors name the variable only |
| `FAKE_EMAIL_CAPTURE_FILE` | `packages/providers/_fake-email` | no | none | absolute path of a JSON Lines file the fake appends rendered mails to (e2e only) |

- The token secret is `ORDER_TOKEN_SECRET` with a separate label (decision 9); no new secret.
- No base-URL variable for Resend (decision 17).
- The display name of `EMAIL_FROM` is the shop name in mail; no shop name setting is added.

### 13. Links
- Every link in a mail is built from `STOREFRONT_PUBLIC_URL` + a fixed path + encoded segments; never from the request's `Host` or `X-Forwarded-Host` (a spec sends forged headers and asserts the links ignore them).
- Bearer secrets travel in the **fragment** (`#t=<token>`) only, as the guest order link of ADR 0023: never in access logs, `Referer` or the Next.js server. The storefront pages read the fragment once and remove it with `history.replaceState`, set `<meta name="referrer" content="no-referrer">`, load no third-party resources and are `no-store`.

### 14. Templates and theming
- **Contract (core; public once listed in `docs/contracts/email-templates.md`):** `EmailTemplate<V> = {key, version, category: "account" | "order", variablesSchema (zod), sampleVariables, render(vars, ctx)}` with `ctx = {locale, messages, theme, links, shopName}`; output `{subject, html, text}`. Plain text is mandatory: a template without it fails registration. Rendering is pure, deterministic and synchronous (decision 7).
- **Registry:** built-ins in `apps/api/src/email/templates/`; a feature or plugin registers more, or overrides a built-in, with a Nest provider marked `fluxkit:email-template` (metadata `{key, override?: true}`), discovered at startup. A duplicate key without `override`, a missing locale catalog or a schema-less template stops startup. A feature's templates disappear with the feature (feature-matrix `deleted` stays green).
- **Template keys v1:** `customer.password_reset`, `customer.password_changed`, `customer.verify_email`, `order.placed`, `order.paid`, `order.cancelled`, `order.expired`, `shipment.created`, `admin.test`.
- **i18n:** catalogs `templates/messages/uk.json` and `en.json`, parity checked by a spec; locale fallback in the `resolveTextWithFallback` order (requested, default, first). Dates and money via `Intl` and core money helpers in the mail's locale; product titles from the order snapshot maps.
- **Theming:** one table-based layout with inline styles from `emailTheme` (resolved light-mode values of `tokens.css`, guarded by a spec; dark mode not attempted), system font stack, no web fonts, no external images, no scripts, no tracking pixel. No client branding in master; the demo `EMAIL_FROM` display name is `Fluxkit Demo Shop`. A client delivery changes tokens, catalogs or overrides templates, never core files.
- **Escaping:** every variable passes core `escapeHtml` in HTML; subjects pass a header-safe check (no CR/LF, at most 200 characters); the `html` tagged template escapes by default and a lint or spec forbids raw string concatenation into HTML in `templates/`; a spec renders every template with hostile sample values and asserts escaped output.
- **Preview:** `POST /admin/email/templates/{key}/preview {locale}` renders `sampleVariables` (no database, no send); the admin shows it in an `iframe srcdoc` with `sandbox=""` next to the text part.

### 15. Admin API, UI and permission (plan question 6)
- New permission **`email.manage`**, granted to owner and manager (addresses are personal data; the viewer has no customer data either).
- Routes, all `email.manage`: `GET /admin/email/status` (`{configured, providerCode, from, replyTo, counts by status for the last 24 h, oldestPendingAt}`, never the key); `POST /admin/email/test` (limit `emailTest` 5 per hour per admin; sends `admin.test` to the CALLER's own address only, no address in the body; `202 {messageId}`); `GET /admin/email/messages` (newest first; filters `status`, `template`, `orderId`, `customerId`, exact `email`; cursor paging 50); `GET /admin/email/messages/{id}` (codes, no body); `POST /admin/email/messages/{id}/resend` (a new row copying template, version, locale and variables with `resend_of`; `409 rule_violation not_resendable` for `customer.*` auth templates); `POST /admin/email/messages/{id}/cancel` (`pending` -> `cancelled`, else `409 invalid_transition`); `GET /admin/email/templates`; the preview route above.
- Problem codes: `invalid_or_expired` (validation code), rules `email_not_configured`, `not_resendable`, `already_verified` of `rule_violation`; no new top-level code. Exact shapes go into `docs/api/email.md` and OpenAPI at build time.
- Admin area "Email" (`apps/admin/src/areas/email/`): status card, "Send test to my address", outbox table with the address masked as `a***@domain` and a "show" action, translated error codes, resend and cancel with confirmation (writes never retried, ADR 0027), template preview; empty, loading and error states; i18n uk/en.

### 16. Security limits
- New in-memory windows per address: `passwordReset` 5 / 15 min, `passwordResetConfirm` 10 / 10 min (shared with verify-email), `verificationResend` 3 / hour per customer, `emailTest` 5 / hour per admin; plus the per-email database count for reset requests.
- Enumeration and timing: the reset request answer is identical for every case and padded to a fixed floor; confirm and verify have one error for every token failure; registration enumeration stays as ADR 0016 accepted it (owner answer 2).
- Session invalidation: a reset revokes every customer session and clears the lockout.
- Header injection: one recipient per message; addresses validated in core (no CR, LF, NUL, commas, angle brackets in the local part); `EMAIL_FROM` and `EMAIL_REPLY_TO` checked at startup; subjects sanitized; no custom headers from data; JSON to Resend, no SMTP header assembly.
- SSRF: the Resend base URL is a constant; the plugin calls one path; the response is capped at 64 KiB before parsing.
- The mailbox owner is trusted (no two-factor); the "password changed" mail tells the person to contact the shop if it was not them.

### 17. Resend plugin (`packages/providers/resend`)
- Node 22 `fetch` and zod 4.6.7 (already pinned in the workspace); no new dependency. Base URL constant `https://api.resend.com` (R17: no other region documented); tests inject a stub origin through the module's test factory only, never through the environment.
- Facts the plugin codes against (plan section 2):

| # | Fact | Verdict |
|---|---|---|
| R1 | `POST https://api.resend.com/emails`, `Authorization: Bearer re_...`, JSON body, HTTPS only | confirmed |
| R2 | Body `from` (`Name <addr>`), `to`, `subject`, `html`, `text`, `headers`, `tags[]{name,value}` (ASCII letters, digits, `_`, `-`, at most 256 characters) | confirmed |
| R3 | Reply-to field name (`reply_to` assumed) | **UNKNOWN**: the stub pins `reply_to`; S1 verifies it |
| R4 | `Idempotency-Key` header, 1 to 256 characters, expires after 24 h; `409 concurrent_idempotent_requests`, `409 invalid_idempotent_request`, `400 invalid_idempotency_key` | confirmed |
| R5 | Success `{ "id": "<uuid>" }` | confirmed |
| R6 | `User-Agent` required, else `403` | confirmed |
| R7 | 10 requests per second per team, `429`, `retry-after` in seconds | confirmed |
| R8 | Error statuses and names (`validation_error` on 400, 401 and 403; `restricted_api_key`; testing mode sends only to the own address until a domain is verified; daily and monthly quota `429`) | confirmed; mapping is by HTTP status first |
| R9 | Error body `{statusCode, name, message}` | **LIKELY**, not in the official reference: the plugin reads `name` only through a lenient schema and falls back to the status |
| R10 to R14 | Webhook events, payload, Svix signing, retries | confirmed in outline; not used in v1 (webhooks later); R13 tolerance and R14 success statuses **UNKNOWN** |
| R15 | Resend's own suppression list | **UNKNOWN** how long it holds and whether a suppressed send answers `200` |
| R16 | Domain DNS records | **UNKNOWN** in detail; taken from the Resend dashboard (owner checklist) |
| R17 | EU region or another base URL | **UNKNOWN**; none documented |
| R18 | Data location and DPA | **UNKNOWN**; owner to obtain for the privacy plan |

- The plugin sends `User-Agent`, `Idempotency-Key` and the `Bearer` header; never logs the key, request or response bodies or provider text; maps every R8 status to an `EmailProviderResult` reason (decision 6).
- Tests: a local stub HTTP server (`test-support/stub-resend.ts`) for R5, R7 and every R8 status, the contract suite, and a no-network guard spec.
- **S1** (plan step 6): one live test send with the owner's key and go verifies R3, R5, R6 and the headers; findings go into the plan.
- **Owner checklist before production:** verify the sending domain in Resend (SPF and DKIM as the dashboard lists them), publish DMARC (`p=none` with a reporting address, then `quarantine`), send from a subdomain, use a sending-only key, set `EMAIL_FROM` on the verified domain, leave open and click tracking off, send the admin test to two mailbox providers and check SPF, DKIM and DMARC pass.

## Consequences

- **Cost.** Two tables, two jobs, a loader refactor, two provider packages, nine templates in two languages, four store routes and eight admin routes, three storefront pages and an admin area; outbound network calls from the scheduler and from the request process (the immediate attempt), bounded by timeouts, leases and the job budget.
- **Contracts.** New public items once built: the store and admin routes, `emailVerified` and `emailDelivery`, the problem code and rules of decision 15, the template contract and override rule, the template keys, `email.manage`, the configuration of decision 12; later `EmailProviderPort`. Pre-1.0, recorded in `CHANGELOG.md`. The route-walk test that lists the public routes under `/store/account` gains the four new public routes.
- **Docs.** The list in the plan's "Docs to update" applies, including a new `docs/api/email.md` and `docs/contracts/email-templates.md`, `docs/dependencies.md` (Resend as an external service and processor) and the AGENTS.md lines the owner adds (plan section "AGENTS.md edits the owner makes").
- **Risks.** A reset link is an account takeover path (mitigated by derived hashed tokens, single use, short expiry, session revocation, the notice, limits and the review; the mailbox owner is trusted). Registration enumeration remains (owner answer 2). `validation_error` is ambiguous across 400, 401 and 403 (R8): a bad key may look like a bad field and end `failed` instead of retried; full local validation and S1 reduce it. A mail accepted by Resend whose answer was lost and whose retries end `unknown` may be resent by an admin (one duplicate, a human decision). Order mails wait for the tick (up to `SCHEDULER_INTERVAL_SECONDS`). Deliverability depends on the owner's DNS. In-memory limits multiply with instances (the per-email reset limit is in the database). Rotating `ORDER_TOKEN_SECRET` invalidates unclicked links of three kinds.
- **What would supersede this ADR (in part):** Resend webhooks and a local suppression list; admin email flows; a second provider or failover; storing rendered bodies; a customer locale column; verify-first registration; S1 findings that change the plugin or the reason mapping.

## Open questions (not decided by the plan or the owner's answers)

1. **Deadline of verification mails.** Decision 7 copies the plan: "auth mails: the token's expiry, at most 1 hour". For reset (60 min) both readings agree. For verification (48 h token) it is read here as `min(expires_at, created_at + 1 hour)`; the alternative `created_at + 12 hours` (the general rule) would also stay inside R4. Fixed in plan step 5 or 7.
2. **Locale of the verification mail.** The plan says account mails use the locale of the page that asked or of the registration request, without `Accept-Language`; but `POST /store/account/register` is strict and has no `locale` member, and the plan's route table names no body for `verify-email/resend`. An additive optional `locale` member (public contract) or `DEFAULT_LOCALE`: decided in plan step 7.
3. **Locale of `admin.test`.** Not specified (admins have no locale column): proposal `DEFAULT_LOCALE` or a `locale` member in the test request; step 9.
4. **Monthly quota.** The plan sets the daily quota retry (next 00:05 UTC) only; a `monthly_quota_exceeded` answer is read as retried hourly until the deadline (`failed deadline_passed`). Confirm in step 5 or 6.
5. **Pacing across processes.** Job 9 sends at most 8 per second per process, but the immediate attempts of request processes are not counted against it; several instances could exceed R7 in a burst. Accepted for transactional volume unless step 5 measures otherwise.
6. **Mechanism of the "no raw concatenation into HTML" rule** (lint rule or spec) is not chosen; step 5.
7. **`emailTheme` as a contract.** Whether the export joins `docs/contracts/theme-tokens.md` (its values follow the tokens) or stays internal; step 2.
8. **`admin.test` and resend.** The plan refuses resend for `customer.*` templates only; whether `admin.test` may be resent is not said; step 9.
9. **Resend UNKNOWNs** R3, R9, R13 (tolerance), R14 (success statuses), R15, R16, R17, R18: S1 and the step 6 docs pass close what they can; R18 is an owner action for the privacy plan.
10. **Mail to Ukrainian mailbox providers** (delivery time, whether Ukr.net and Meta.ua honour DMARC reports): not known; checked by the owner's test sends.
