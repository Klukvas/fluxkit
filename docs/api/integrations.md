# Integrations API (provider credentials)

Core, no feature flag (ADR 0058; plan `docs/plans/2026-11-16-admin-integrations.md`, slice 1). Every route needs `integrations.manage` (owner only), the admin session, and for changes the CSRF header and JSON (`docs/api/auth.md`). Responses are `no-store`; errors are `application/problem+json`.

A stored credential is a **candidate**: it is encrypted and kept, and nothing uses it at runtime yet. Providers still read their keys from the server environment. No route here calls a provider, and no route returns a secret, a part of one, a ciphertext or a key id.

| Endpoint | Auth | Purpose | Request | Response | Errors |
|---|---|---|---|---|---|
| `GET /admin/integrations` | `integrations.manage` | Installed provider packages that declare secrets (`fluxkit.secrets`), enabled or not; test-only providers are left out in production | none | `{revision, storage, items: Integration[]}` | 401, 403 |
| `GET /admin/integrations/{id}` | `integrations.manage` | One integration | none | `{revision, storage, integration}` | 400, 401, 403, 404 |
| `PUT /admin/integrations/{id}/secrets/{field}` | `integrations.manage` + current password | Encrypts the value into a new candidate version; an earlier candidate of the same credential is retired | `{expectedRevision, value, currentPassword}` | `{revision, storage, integration}` | 400, 401, 403, 404, 409, 429, 503 |
| `POST /admin/integrations/{id}/retire-secret` | `integrations.manage` + current password | Deletes the encrypted value of a candidate version; the version stays as a tombstone. Works without `SECRETS_ENCRYPTION_KEY` | `{expectedRevision, versionId, currentPassword}` | `{revision, storage, integration}` | 400, 401, 403, 404, 409, 429, 503 |

## Shapes

- `revision`: whole number, rises with every change; send it back as `expectedRevision`.
- `storage`: `ready`, or `disabled` when the server has no `SECRETS_ENCRYPTION_KEY` (nothing can be saved).
- `Integration`: `{id, kind, providerCode, secrets: Secret[], updatedAt}`; `kind` is `email`, `payment` or `shipping`.
- `Secret`: `{field, purpose, envVariable, state, last4, versionId, generation, savedAt, keyAvailable}`.
  - `purpose`: `outbound` (calls to the provider) or `webhook` (verifying what the provider sends).
  - `state`: `env` (the server variable `envVariable` is set: it wins and the field is read-only here), `set` (a value is stored), `not_set`.
  - `last4`: always `null`.
  - `versionId`, `generation`, `savedAt`: the stored version, `null` when nothing is stored. A value stored before the variable was set is still reported while `state` is `env`.
  - `keyAvailable`: `false` when this server does not hold the master key that sealed the value (enter it again); `null` when nothing is stored.
- `value`: 1 to 4096 printable ASCII characters without spaces, then the provider's own format rule. `currentPassword`: the signed-in owner's password. Both are `writeOnly` in OpenAPI.

## Order of checks for a change

1. Session, permission, CSRF, body shape.
2. The integration and field exist; storage is on; the field is not set on the server; the value passes the format rules; the revision is current. A refusal here costs no password attempt.
3. Shared strict limits: 5 attempts in 15 minutes per admin and 20 per client address, counted for every attempt of save and remove together, successful and refused ones alike (so a sixth credential within fifteen minutes waits). They live in Redis and fail closed.
4. The current password. A locked account is refused like a wrong password.
5. One transaction: the owner and the acting session are re-checked under their row locks (a session signed out meanwhile: `401`), the revision moves (compare and set), the version and envelope are written, the audit event is recorded.

## Errors

| Status | `code` | `rule` / detail |
|---|---|---|
| 400 | `validation_failed` | `value`: `required`, `too_long`, `invalid_characters`, `invalid_format` (the plugin's rule; the message never contains the value); body and path shape errors |
| 403 | `forbidden` | no `rule`: the role lacks `integrations.manage` or the CSRF header is missing. `rule: current_password_incorrect`: wrong password, locked account, or the account changed during the check; nothing was saved |
| 404 | `not_found` | unknown integration, undeclared field, or a version of another integration |
| 409 | `rule_violation` | `integration_storage_disabled`, `integration_env_override`, `integration_revision_stale`, `integration_unavailable` (the provider package could not be loaded, so its format rule is unknown) |
| 409 | `invalid_transition` | `integration_version_not_retirable`: only a candidate can be retired |
| 429 | `too_many_requests` | the step-up limits; `Retry-After` |
| 503 | `service_unavailable` | `rule: step_up_unavailable`: the shared limits (Redis) cannot be reached; no password was checked and nothing was saved; `Retry-After` |

## Audit

- `integration.secret_changed` (target `integration`): `kind`, `provider`, `field`, `purpose`, `generation`, `version`, `replaced`.
- `integration.secret_retired` (target `integration`): `kind`, `provider`, `purpose`, `generation`, `version`.
- `admin_user.step_up_failed` (target `admin_user`, the actor): `operation`. Written in its own transaction, so it stays although the change was refused.

## Provider packages

- Manifest: `"fluxkit": {"provider", "kind", "secrets": [{"field", "purpose", "env"}]}`; a purpose and a variable appear once per provider, and `env` starts with the provider code in upper case plus `_` (a package that names another variable is not offered).
- Optional export `validateIntegrationSecret(field: string, value: string): string | undefined` next to `providerModule` (synchronous; any other answer refuses the save with `integration_unavailable`). The store imports the package entry only when a value is saved for it.
- Declared today: `resend` and `brevo` (`api_key`, `webhook_secret`), `monobank` (`token`), `nova_post` (`api_key`), test-only `fake` email (`api_key`, `webhook_secret`).

## Not in this slice

Activation and runtime use, connection checks, test sends through a candidate, settings (sender, route, limits), emergency revocation, key rotation rewrap (plan sections 9 and 12).
