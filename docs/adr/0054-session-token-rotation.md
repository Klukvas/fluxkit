# ADR 0054: Session token rotation on password change

- Status: accepted (owner, 2026-11-14; session-token-rotation plan R1, R2, R3 and R5).
- Supplements [ADR 0009](0009-admin-auth.md), [ADR 0010](0010-admin-lockout-and-recovery.md) and [ADR 0016](0016-customer-accounts-and-sessions.md).

## Context

Changing a password previously kept the caller's token unchanged. Admin login also left the presented session valid. A copied token could therefore survive the security-relevant change.

## Decision

- Admin and customer password changes replace the caller's token inside the existing user-row-locked transaction, together with the password update and other-session revocation. Customer reset-token invalidation remains in that transaction.
- Update the existing session row only when both its id and the token hash authenticated for this request still match. No matching row means `401`; the transaction rolls back the password and other revocations. Never recreate a deleted session.
- Keep the session id, `created_at` and `expires_at`. Rotation never extends the absolute lifetime. The resolved principal carries the hash, never the raw token; neither is logged or returned in a response body.
- Successful `change-password` remains `204` and sends a fresh `Set-Cookie` using the login cookie's path, HttpOnly, SameSite and configured Secure flag, with Max-Age computed from the remaining absolute lifetime. Failures send no cookie.
- Successful admin login revokes the session cookie presented in the request, including one belonging to a different user; failed login leaves it alone. This closes ADR 0010's "Older cookie at login" limitation. Customer sign-in already follows this rule.
- Password reset and deactivation continue to revoke all sessions. Static CSRF headers need no replacement.

## Consequences

- Browsers store the replacement cookie automatically. Clients managing cookies manually must consume `Set-Cookie` after password changes (additive, minor release).
- In-flight requests with the previous token may receive `401` after the change commits. There is no grace window for a security-triggered rotation.
- A proxy must preserve `Set-Cookie` on `204`; otherwise the caller must sign in again. A post-deployment browser check remains necessary.
- No schema, dependency or environment changes.

## Deferred alternative

Periodic rotation (R4) is deferred. Supporting parallel tabs would need a previous-token grace window, additional columns and another lookup. A possible later design uses `previous_token_hash`, `rotated_at` and a 60-second grace period on the existing minute touch; none is implemented here.
