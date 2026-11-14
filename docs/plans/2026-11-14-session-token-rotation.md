# Session token rotation (admin and customer)

- Status: APPROVED by the owner on 2026-11-14: R1 to R3 as proposed; periodic rotation (R4) deferred. Not started.
- Source: `docs/HANDOFF.md` section 2 item 7 (auth follow-ups, each with its own plan); ADR 0010 "Known limits" rows "Token rotation" and "Older cookie at login".
- Out of scope (own plans later): Redis-backed login throttle and reset/verification limits, two-factor, audit log, a cap on concurrent sessions.

## 1. Goal

A session token that existed before a security-relevant change must stop working after it. Today:

| Event | Admin (ADR 0009, 0010) | Customer (ADR 0016) |
|---|---|---|
| Login with a session cookie already in the request | New session; the OLD one stays valid (ADR 0010 "Older cookie at login") | New session; the old one is revoked after success (already done) |
| `change-password` | Other sessions end; the caller's token is kept unchanged | Same as admin |
| Password reset (`/admin/users/{id}/reset-password`, `/store/account/password-reset/confirm`) | All sessions of that user end (no cookie issued) | All sessions end, no cookie |
| Deactivation | All sessions end | All sessions end |

The two gaps: the caller's token survives a password change (a token stolen before the change keeps working if it is the caller's own), and the admin login keeps the cookie it replaced.

## 2. Existing functionality (reuse, do not reinvent)

- `apps/api/src/auth/session.service.ts` and `apps/api/src/customers/auth/customer-session.service.ts`: `create`, `resolve`, `revoke`, `revokeSession`, `revokeAllForUser`/`revokeAllForCustomer(id, exceptSessionId, executor)`.
- `apps/api/src/auth/session-token.ts`: `generateSessionToken`, `hashSessionToken` (shared by both principals).
- Cookie helpers: `session-cookie.ts` (`Path=/admin`, `SameSite=Strict`), `customer-session-cookie.ts` (`Path=/store`, `SameSite=Lax`).
- `AuthService.changePassword` and `AccountService.changePassword` already run under the user row lock in one transaction (`withTransaction`, `findByIdForUpdate`).
- Customer login already revokes the presented cookie: copy that flow to the admin login.
- CSRF is the static `X-Fluxkit-CSRF: 1` header, not bound to the token, so nothing CSRF-related has to be re-issued.
- The customer cookie has `Path=/store`, so Next.js server rendering never sees it; every customer call is a browser request to `/store/*`, so a `Set-Cookie` on the answer reaches the browser (the login already relies on this).

## 3. Design (proposed)

R1. **Rotate in place, in the same transaction.** New repository method `rotateToken(sessionId, oldTokenHash, newTokenHash, executor)`:
`UPDATE <table> SET token_hash = $new WHERE id = $id AND token_hash = $old` (exactly one row, or the change fails with `401`).
Keeping the row keeps `created_at`, `expires_at` and the session id, so a rotation never extends the absolute lifetime and needs no schema change.

R2. **`change-password` (admin and customer):** inside the existing transaction, after `revokeAllFor…(…, exceptSessionId)`, rotate the caller's session. The answer stays `204` and now carries `Set-Cookie` with the new token and `Max-Age` = the remaining lifetime (`expires_at - now`, as login computes it). Rolled back together with the password on any failure, so the old token stays valid if nothing changed.

R3. **Admin login with a session cookie:** after a successful login, revoke the session the request carried (same as the customer login; a failed login revokes nothing). Closes the ADR 0010 row "Older cookie at login".

R4. **No periodic (time-based) rotation in this plan.** Reasons: it needs a grace window for the previous token (parallel tabs and in-flight requests would otherwise get `401`), which means new columns (a migration) and a second lookup per request; the cookie is `HttpOnly`, the token is hashed at rest, and `SameSite` limits reuse, so the gain is small. Option for later, if the owner wants it: `previous_token_hash` + `rotated_at` with a 60 s grace, rotation on the existing once-a-minute touch. Recorded in the ADR as a deferred alternative.

R5. **The principal carries the token hash it was resolved with** (`sessionId` already exists; add the hash, never the raw token) so R1 can use `AND token_hash = $old` without re-reading the cookie. Nothing new is logged; logs keep session ids only.

## 4. Files and contracts

| Area | Change |
|---|---|
| `apps/api/src/auth/session.repository.ts`, `session.service.ts` | `rotateToken` (repository), `rotate(sessionId, oldHash, executor)` returning `{token, expiresAt}` (service) |
| `apps/api/src/customers/auth/customer-session.repository.ts`, `customer-session.service.ts` | same for customers |
| `apps/api/src/auth/auth.service.ts`, `auth.controller.ts` | change-password rotates and sets the cookie; login revokes the presented session |
| `apps/api/src/customers/account/account.service.ts`, `account.controller.ts` | change-password rotates and sets the cookie |
| `apps/api/src/auth/current-admin.ts`, `customers/auth/current-customer.ts` (principal types) | add the token hash |
| `docs/api/auth.md`, `docs/api/customers.md`, `docs/api/openapi.json` | `Set-Cookie` on change-password; admin login revokes the presented session |
| `docs/adr/0054-session-token-rotation.md` | new ADR; supplements ADR 0009, 0010, 0016 (old ADRs are not edited); 0052 went to the split listing, 0053 to the catalog review drift |
| `CHANGELOG.md`, `docs/HANDOFF.md` | one line each |

- No migration, no new dependency, no new config variable.
- Public contract (AGENTS.md section 17): additive for browsers. A non-browser client that keeps the cookie by hand must take the new `Set-Cookie` after `change-password`, the old token stops working. Minor version and a CHANGELOG line; no migration guide (no shape change).
- The admin SPA and the storefront need no code change (the browser stores the new cookie). Covered by e2e anyway (section 5).

## 5. Tests (real Postgres, AGENTS.md section 13)

Integration (`apps/api`, next to `auth-session-endpoints.spec.ts` and `account-session.spec.ts`):
- change-password: the old token answers `401` on `/me`, the new one `200`; `created_at` and `expires_at` unchanged; other sessions gone; `Set-Cookie` attributes equal to login's (`HttpOnly`, path, `SameSite`, `Secure` per config, `Max-Age` = remaining lifetime).
- change-password that fails (wrong current password, policy error, concurrent password change caught under the lock): the old token still works, no `Set-Cookie`.
- Rotation race: the session deleted (logout in another tab) between resolve and rotate -> `401`, password not changed (the transaction rolls back).
- Admin login with a valid cookie of the same or another user: that session is revoked after success; untouched after a failed login.
- Secrecy: no raw token or hash in logs (extend `auth-secrecy.spec.ts`, `account-secrecy.spec.ts`).
- E2E: admin "change password, then keep working"; storefront account "change password, reload, still signed in".

## 6. Risks

- An admin SPA request already in flight with the old cookie when the change commits gets `401` and shows the sign-in screen. Rare (the user is on the password form) and safe; documented.
- A proxy that strips `Set-Cookie` on a `204` would sign the user out after a password change. The login path shows the proxies pass `Set-Cookie`; checked again by the e2e run and on the test server.

## 7. Steps and verification

One PR (`fix/session-token-rotation`): tests first for R2 and R3, then the code; `pnpm lint`, `typecheck`, `test`, `test:e2e`; after merge a manual check on the test server (change the password in admin and storefront; a cookie copied beforehand answers `401`).

## 8. Owner decisions (approved 2026-11-14)

1. Approve R1 to R3 (rotation on change-password, admin login revokes the presented session).
2. Confirm R4: no periodic rotation now (deferred alternative in the ADR).
