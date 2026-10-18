# API: admin auth and users

Sign-in flow and user management of the admin API (`/admin/auth/*`, `/admin/users/*`). Model and decisions: `docs/adr/0009-admin-auth.md`. Customer accounts and `/admin/customers` (permissions `customers.read` and `customers.write`, owner and manager) have their own page, `docs/api/customers.md`. Conventions shared with the catalog (CSRF header, problem+json, pagination, session cookie): `docs/api/catalog.md`.
Source of truth for routes and schemas: `docs/api/openapi.json`. No feature flag: auth is core.

Every state-changing request needs `X-Fluxkit-CSRF: 1` (and `Content-Type: application/json` with a body), also login. Auth levels used below: `public` (no session), `signed in` (any role, no particular permission), `users.manage` (owner only).

## Sign-in flow

| Endpoint | Auth | Purpose | Request | Response | Errors |
|---|---|---|---|---|---|
| `POST /admin/auth/login` | public | Sign in; a new session on every call, never reusing a token the caller sent | `{email, password}` (strict; email trimmed and lower-cased; both texts at most 1024 characters) | `200 {user: {id, email, role, isActive, lastLoginAt}}` and the session cookie in `Set-Cookie` | `400` structure; `401 unauthorized` for every failure (unknown email, wrong password, locked, inactive: same body, no cookie); `429 too_many_requests` with `Retry-After` |
| `POST /admin/auth/logout` | signed in | Delete the current session and clear the cookie | none | `204` | `401` |
| `GET /admin/auth/me` | signed in | The signed-in user and the permissions of their role, read from the database | none | `200 {user, permissions: [...]}` | `401` |
| `POST /admin/auth/change-password` | signed in | Change the own password; ends all OTHER sessions of the user (the current stays) | `{currentPassword, newPassword}` (strict) | `204` | `400` structure or password policy (`errors[].path` is `newPassword`: `too_short`, `too_long`, `equals_email`, `contains_nul`, `same_as_current`); `400` with `path: "currentPassword"`, `code: "incorrect"` for a wrong or locked-out current password; `401` |

### Login rules

- **Same answer for every failure.** Unknown email, wrong password, locked account and inactive user all answer the identical `401 unauthorized` problem (same status, headers and body, no `Set-Cookie`) and do one scrypt verification each (a dummy one when there is no hash to check). Status, headers and body are identical. The response time is dominated by that one scrypt, so it is similar too, but it is not guaranteed to be equal: a wrong password (and a failed `change-password`) also writes the failure count, which can add a small, measurable difference. Do not rely on timing to hide which case it was. The server log gets only a reason code (`unknown_account`, `wrong_password`, `locked`, `inactive`, `ip_throttled`), and the user id on success; never the email, password or token.
- **Account lockout** (database, spans API instances): 5 failed logins lock the account for 15 minutes. Failures during a lock neither count nor extend it; an expired lock starts a fresh count; a successful login resets the count. A wrong `currentPassword` in `change-password` counts like a failed login, and a locked account cannot be used to guess passwords there either. Sessions that already exist are not ended by a lock.
- **Client IP limit** (memory, per process): 20 login attempts per 10 minutes per client address (`request.ip`), successful ones included. An IPv6 client is counted by its /64 prefix (the whole subnet shares one window); an IPv4-mapped IPv6 address counts as its IPv4 address. The 21st answers `429 too_many_requests` with `Retry-After` (seconds until the window ends) before any account lookup or hashing, so a throttled client learns nothing about accounts. The counter is lost on restart and not shared between API instances; behind a reverse proxy set `TRUST_PROXY` to the exact number of proxy hops (`docs/contracts/config.md`, README Deployment notes), otherwise all clients share one window.
- **Success** also stamps `last_login_at`, stores a fresh hash when the stored scrypt parameters are not the current ones, deletes that user's expired sessions and creates the new session, all in one transaction under the user's row lock (a concurrent password reset or change therefore ends the new session too).
- **Locked out?** Wait 15 minutes, have another owner reset the password (`POST /admin/users/{id}/reset-password` clears the lock), or run `pnpm admin:unlock --email <address>` on the server (README, Admin sign-in; ADR 0010).
- **No caching.** Every response under `/admin`, errors and `401`, `403`, `429` included, carries `Cache-Control: no-store`. `/store/*` catalog routes and `/health` do not (the account, cart, checkout and order routes do, `docs/api/customers.md`).

## Users

All routes need `users.manage` (owner only); a manager or viewer gets `403 forbidden` on every one. Responses never contain the password hash. There is no `DELETE`: deactivate instead. A user is `{id, email, role, isActive, lastLoginAt, createdAt, updatedAt}`.

| Endpoint | Auth | Purpose | Request | Response | Errors |
|---|---|---|---|---|---|
| `GET /admin/users` | `users.manage` | List users ordered by email | `?limit` (1 to 100, default 50), `?offset` | `200 {items, total, limit, offset}` | `400` |
| `POST /admin/users` | `users.manage` | Create a user | `{email, role, password}` (strict; role is `owner`, `manager` or `viewer`; email format and password policy from core) | `201` user, `Location: /admin/users/{id}` | `400` (unknown role, invalid email, password policy under `password`, unknown field); `409 conflict` with `field: "email"` for a duplicate (any case) |
| `GET /admin/users/{id}` | `users.manage` | One user | none | `200` user | `400` malformed id; `404` |
| `PATCH /admin/users/{id}` | `users.manage` | Change role and/or activity; deactivating ends all sessions of the user; a role change applies to the next request | `{role?, isActive?}` (strict: any other field, including email or hash, is `400 unknown_field`) | `200` user | `400`; `404`; `409 rule_violation` with `rule` `last_owner_cannot_be_demoted` or `last_owner_cannot_be_deactivated` |
| `POST /admin/users/{id}/reset-password` | `users.manage` | Set a new password for a user (an owner for themselves too); clears the lockout and ends ALL sessions of that user | `{newPassword}` (strict; policy checked against the user's email) | `204` | `400` (policy errors under `newPassword`); `404` |

- **Last owner**: at least one active owner always remains. The rule runs inside a transaction that holds one database lock for all owner changes (`pg_advisory_xact_lock`), so two simultaneous requests cannot demote or deactivate the last two owners between them.
- **No self-service escalation**: nobody below owner can reach these routes, including for their own account.
