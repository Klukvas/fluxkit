# Integrations API (provider credentials)

Core, no feature flag ([ADR 0058](../adr/0058-managed-integration-credentials.md), [ADR 0060](../adr/0060-managed-provider-runtime-contract.md); [slice 2 plan](../plans/2026-11-27-integrations-slice2-payments-shipping.md), PRs 1–2). Every route needs `integrations.manage` (owner only), the admin session, and for changes the CSRF header and JSON (`docs/api/auth.md`). Responses are `no-store`; errors are `application/problem+json`.

A stored credential is encrypted and never returned. Reads never call a provider. An explicit connection check and a payment credential save for a package exporting `accountIdentity` may perform a bounded read-only provider call. No response returns a secret, a part of one, a ciphertext or a key id. An email credential sends only after `activate`, and only while `EMAIL_PROVIDER` is absent. Payment credentials serve commerce after activation while `PAYMENT_PROVIDERS_ENABLED` is absent; shipping activation remains refused. When Resend and Brevo are both in the send chain, `emailRouteMode` chooses who starts each new message; a chain set with `EMAIL_PROVIDER` follows the same choice.

| Endpoint | Auth | Purpose | Request | Response | Errors |
|---|---|---|---|---|---|
| `GET /admin/integrations` | `integrations.manage` | Installed provider packages that declare secrets (`fluxkit.secrets`), enabled or not; test-only providers are left out in production | none | `{revision, storage, emailRouteMode, items: Integration[]}` | 401, 403 |
| `PUT /admin/integrations/email-route` | `integrations.manage` + current password | `equal` alternates new mail between Resend and Brevo; `resend` starts every message with Resend. A definite non-acceptance is tried on the other. A cooled-down starter is waited on. Applies whenever both are in the send chain | `{mode, expectedRevision, currentPassword}` | `{revision, emailRouteMode}` | 400, 401, 403, 409, 429, 503 |
| `POST /admin/integrations/{id}/activate` | `integrations.manage` + current password | Turns on a stored email or payment credential in delegated mode; complete outbound bundle required. Shipping stays refused | `{expectedRevision, currentPassword}` | `{revision, storage, integration}` | 400, 401, 403, 404, 409, 429, 503 |
| `POST /admin/integrations/{id}/disable` | `integrations.manage` + current password | Stops new work on this integration; bound mail/payments may finish with the draining version | `{expectedRevision, currentPassword}` | `{revision, storage, integration}` | 400, 401, 403, 404, 409, 429, 503 |
| `POST /admin/integrations/{id}/revoke-secret` | `integrations.manage` + current password | Marks a version revoked. It cannot be activated again, and bound work cannot start further transport or local checkout signing. The envelope stays | `{expectedRevision, versionId, currentPassword}` | `{revision, storage, integration}` | 400, 401, 403, 404, 409, 429, 503 |
| `GET /admin/integrations/{id}` | `integrations.manage` | One integration | none | `{revision, storage, integration}` | 400, 401, 403, 404 |
| `PUT /admin/integrations/{id}/secrets/{field}` | `integrations.manage` + current password | Encrypts a new candidate bundle for this purpose and environment; an earlier candidate of the same purpose is retired | `{expectedRevision, value, currentPassword, environment?}` | `{revision, storage, integration}` | 400, 401, 403, 404, 409, 429, 503 |
| `POST /admin/integrations/{id}/check` | `integrations.manage`, CSRF + JSON; no password | Explicit read-only check of a complete candidate, active or draining version; no activation | `{expectedRevision, versionId}` | `{versionId, code, checkedAt, retryAfterSeconds?}` | 400, 401, 403, 404, 409, 429, 503 |
| `POST /admin/integrations/{id}/retire-secret` | `integrations.manage` + current password | Deletes the encrypted value of a candidate version; the version stays as a tombstone. Works without `SECRETS_ENCRYPTION_KEY` | `{expectedRevision, versionId, currentPassword}` | `{revision, storage, integration}` | 400, 401, 403, 404, 409, 429, 503 |

## Shapes

- `revision`: whole number, rises with every change; send it back as `expectedRevision`.
- `storage`: `ready`, or `disabled` when the server has no `SECRETS_ENCRYPTION_KEY` (nothing can be saved).
- `emailRouteMode`: `equal` or `resend`. A missing or other stored value fails the read (`email_route_mode_invalid`), it is not treated as `equal`.
- `Integration`: `{id, kind, providerCode, enabled, secrets: Secret[], versions: Version[], environmentSource, environment, environments?, updatedAt}`; `kind` is `email`, `payment` or `shipping`. `enabled` is true when new work uses the stored outbound credential.
- `Version`: `{id, purpose, generation, state, environment, createdAt, fields: string[]}`; at most 20 recent non-retired versions (`candidate`, `active`, `draining`, `revoked`), metadata only. `fields` contains stored field codes, never values. Older versions can be revoked by their known ID even when outside this display bound.
- Optional `environments`: `{values: string[], default: string, envVariable: string}` from trusted installed-package metadata. No descriptor means the fixed environment `default`. There is no separate environment or version-history route.
- Optional save `environment`: a declared value. Absent selects the current candidate's environment, else the manifest default. A different environment starts a fresh bundle without carrying fields across environments. When the declared environment variable is present, it locks the environment (blank means manifest default). Invalid values make the integration unavailable at discovery. Saves that explicitly request or would inherit a different environment and checks of mismatched versions answer `409 integration_env_override` before step-up, decryption or network. Reads expose `environmentSource: "env" | "store"` and effective `environment`; the admin selector is locked for source `env`.
- All declared fields for a purpose belong to one version. A save replaces the submitted field and clones other fields only from a candidate or active bundle of that purpose in the same environment. Retained fields are decrypted and resealed with fresh row IDs, nonces and generation AAD; unreadable material fails the whole save. Activation requires the complete bundle; saving a LiqPay public key alone does not enable payments.
- `Secret`: `{field, purpose, envVariable, state, last4, versionId, generation, savedAt, keyAvailable, versionState}`.
  - `purpose`: `outbound` (calls to the provider) or `webhook` (verifying what the provider sends).
  - `state`: `env` (the server variable `envVariable` is set: it wins and the field is read-only here), `set` (a value is stored), `not_set`.
  - `last4`: always `null`.
  - `versionId`, `generation`, `savedAt`: the stored version, `null` when nothing is stored. A value stored before the variable was set is still reported while `state` is `env`.
  - `keyAvailable`: `false` when this server does not hold the master key that sealed the value (enter it again); `null` when nothing is stored.
  - `versionState`: `candidate` (saved, not used), `active` (new mail uses it), `draining` (turned off; mail already bound may finish), `revoked` (unusable). `null` when nothing is stored.
- `value`: 1 to 4096 printable ASCII characters without spaces, then the provider's own format rule. `currentPassword`: the signed-in owner's password. Both are `writeOnly` in OpenAPI.

## Order of checks for a change

Activation validates the candidate's environment against the installed manifest and its current server environment lock before step-up, then repeats both checks on the locked candidate inside the activation transaction before decryption or client construction. Either mismatch answers `409 integration_env_override`; revision, enabled state, active pointer, candidate, audit and owner alerts remain unchanged.

1. Session, permission, CSRF, body shape.
2. The integration and field exist; storage is on; the field is not set on the server; the value passes the format rules; the revision is current. A refusal here costs no password attempt.
3. Shared strict limits: 5 attempts in 15 minutes per admin and 20 per client address, counted for every attempt of save and remove together, successful and refused ones alike (so a sixth credential within fifteen minutes waits). They live in Redis and fail closed.
4. The current password. A locked account is refused like a wrong password.
5. One transaction: the owner and the acting session are re-checked under their row locks (a session signed out meanwhile: `401`), the revision moves (compare and set), the version and envelope are written, the audit event is recorded.

## Connection check

- The owner selects a saved version, never supplies credentials in this body. Missing fields, stale revision, a nonblank env-overridden outbound field, and a revoked/retired version are refused before calling the plugin. Unreadable credentials or an unavailable package/hook produce `unavailable`; an absent hook produces `not_supported`. An env override answers `409 integration_env_override`.
- Strict Redis windows atomically consume 10 attempts/minute/admin, 30/minute/client address and 30/minute/provider, plus 30 attempts/10 minutes/admin for shipping in the same atomic attempt. They fail closed with `503 service_unavailable`, `rule: check_unavailable`; no local fallback or provider call. Denial answers `429` with `Retry-After`.
- `code` is `ok`, `invalid_credentials`, `unavailable`, `rate_limited` or `not_supported`. `checkedAt` is an ISO timestamp; optional `retryAfterSeconds` is an integer 0–86400. A missing hook returns `not_supported`. Provider throws, malformed outcomes and the 10-second timeout map to allowlisted outcomes, without provider text. Exceptions log `integration_check_failed` and only the error class name, never message or cause. A successful check neither activates nor guarantees future access.
- Every actual check transport starts synchronously under integration then version `FOR SHARE` locks; the transaction commits before awaiting completion. Revoked versions are terminal and cannot start another call. A call already started may finish after revocation.
- Before decryption or the hook, `integration.check_requested` commits codes/IDs only; failure refuses the call with `503 check_unavailable`. After the check, `integration.check_completed` records the code-only outcome; there is no stored success credential or check-result history. Audit failure logs `integration_check_audit_failed` and answers `503 check_unavailable` rather than return an unaudited success.

## Errors

| Status | `code` | `rule` / detail |
|---|---|---|
| 400 | `validation_failed` | `value`: `required`, `too_long`, `invalid_characters`, `invalid_format` (the plugin's rule; the message never contains the value); body and path shape errors |
| 403 | `forbidden` | no `rule`: the role lacks `integrations.manage` or the CSRF header is missing. `rule: current_password_incorrect`: wrong password, locked account, or the account changed during the check; nothing was saved |
| 404 | `not_found` | unknown integration, undeclared field, or a version of another integration |
| 409 | `rule_violation` | `integration_storage_disabled`, `integration_env_override`, `integration_revision_stale`, `integration_unavailable` (the provider package could not be loaded, so its format rule is unknown), `integration_runtime_not_ready` (shipping cannot be activated), `integration_sender_required` (`EMAIL_FROM` is unset), `integration_route_unset` (a second email provider is not the Resend/Brevo pair), `integration_not_activatable` (no complete outbound candidate), `integration_version_incomplete` (missing declared fields for a check), `integration_version_not_checkable` (a check selected a revoked/retired version), `integration_merchant_mismatch`, `integration_merchant_not_enrolled`, `integration_legacy_work_open`, `integration_currency_unsupported`, `integration_public_url_required`, `integration_payment_window_too_short`, `invalid_credentials` (merchant enrollment read refused the credential) |
| 409 | `invalid_transition` | `integration_version_not_retirable`: only a candidate can be retired. `integration_version_not_revocable`: the version cannot be revoked. `integration_not_enabled`: disable of an integration that is already off |
| 429 | `too_many_requests` | the step-up or connection-check limits; `Retry-After` |
| 503 | `service_unavailable` | `rule: step_up_unavailable`: the shared limits (Redis) cannot be reached; no password was checked and nothing was saved; `Retry-After`. `rule: check_unavailable`: strict connection-check limits unavailable (no plugin call), or post-check audit failed; `integration_credential_check_unavailable`: enrollment read failed/timed out or its strict budget is unavailable, nothing saved |

## Audit

- `integration.secret_changed` (target `integration`): `kind`, `provider`, `field`, `purpose`, `generation`, `version`, `replaced`.
- `integration.secret_retired` (target `integration`): `kind`, `provider`, `purpose`, `generation`, `version`.
- `integration.route_changed` (target `integration`, a fixed id of the route setting): `{mode}` (`equal` or `resend`).
- `integration.activated`, `integration.disabled`, `integration.revoked` (target `integration`): code-only lifecycle metadata.
- `integration.check_requested` (target `integration`), committed before the hook: `{kind, provider, version}` only.
- `integration.check_completed` (target `integration`), after the hook: `{kind, provider, version, code}` only.
- `admin_user.step_up_failed` (target `admin_user`, the actor): `operation`. Written in its own transaction, so it stays although the change was refused.

## Owner alerts

After `integration.secret_changed`, `integration.activated`, `integration.disabled` and `integration.revoked` commit with their audit, a best-effort adapter enqueues `integration.security_alert` through the existing EmailOutbox, once per active owner (`recipientKind: admin`, existing `adminUserId`, configured `DEFAULT_LOCALE`). Recipients come from active owner records, never request input. Variables are only `action`, `kind`, `providerCode`, `generation`, `occurredAt`; no secret, identity, sender, actor address or provider text. A stable dedupe ID derived from the inserted audit-row ID returned by `AdminAuditWriter.record` and the owner ID prevents duplicate mail and gives each owner a separate message.

Email off means no enqueue. Lookup, rendering or enqueue failure records `integration_alert_failed` and cannot roll back or change the successful mutation. A crash after commit and before enqueue can lose the alert; audit is the durable record. No separate notification table or alert account is used.

## Provider packages

The [managed provider contract](../contracts/integrations.md) defines manifests, complete purpose bundles and pure runtime exports. Repeated purposes are allowed; field and env names remain unique. Declared providers include Resend, Brevo, Monobank, LiqPay (paired public/private outbound fields), Nova Post and the test-only fake email provider. Production excludes test-only packages. The existing one-argument email factories remain compatible.

## Managed payment enrollment and activation

- `accountIdentity` on an installed payment package requires a merchant read whenever an outbound save produces a complete bundle. Incomplete multi-field bundles remain candidates without a probe or enrollment proof. Every save consumes step-up; complete bundles also consume the shared check windows before the read. Monobank has one field, so its first token save performs this read. The read has a 10-second deadline, runs outside the save transaction and grants no commerce authority. Monobank reads `/api/merchant/details` and retains merchantId only, encrypted; no charge or separate webhook secret.
- First successful save commits the encrypted permanent baseline, candidate and audit together. Equal merchant identity permits rotation; a different merchant returns `409 integration_merchant_mismatch`. Invalid credentials return `409 invalid_credentials`; failed/timeout reads return `503 integration_credential_check_unavailable`. Every refusal stores neither a baseline nor a candidate.
- Successful comparison is recorded as `enrollmentMatched: true` on the candidate's `integration.secret_changed` audit event, with its exact version ID. Activation requires that proof and the baseline; it makes no new provider call. If audit retention has removed the proof, save the credential again. No merchant identifier enters responses, logs, audit or alerts. Disable/revoke preserve the baseline permanently.
- Payment activation requires absent `PAYMENT_PROVIDERS_ENABLED`, no outbound env field overrides, a complete bundle, installed factory/locator, supported shop currency, a configured storefront URL (HTTPS in production), and at least eight minutes of order-payment lifetime. Several providers may be active. Null-bound legacy work for that provider must finish/reconcile first (`409 integration_legacy_work_open`). LiqPay has paired keys and no harmless online check (`not_supported`).
- Disable drains the selected version. Re-enable may select that same draining pointer when no candidate exists. Revoke is local and needs neither the provider nor decryption. New work binds a version transactionally; retained work never switches to the newest key. Shipping runtime, test sends, sender/limit settings and master-key rewrap remain later work.


Migration 0022 rollback locks versions and secrets before preflight, refusing non-default environments or any version with multiple secret rows. The alert key uses existing dotted email grammar; no email schema change belongs to 0022.
