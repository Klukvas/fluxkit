# 0016. Customer accounts and sessions

Status: accepted 2026-10-17 (owner decisions of 2026-10-16 and the assumptions of `docs/plans/2026-10-17-cart-and-orders.md`, approved with the plan). Reuses the rules of ADR 0009 and ADR 0010 for a second principal.

## Context

- Guests and customer accounts both order (owner decision). Customers register, sign in and see their order history; guests reach their order with a private link (ADR 0017).
- ADR 0009 built admin authentication (hashed session token in Postgres, `HttpOnly` cookie, scrypt, CSRF header, lockout, throttle); ADR 0010 recorded its limits. Customers need the same ideas, but an admin session must never be reachable from the storefront and a customer session must never reach `/admin`.
- No email delivery exists, so email verification and password reset cannot be built in this plan.

## Decision

- **A separate principal.** Tables `customer` and `customer_session` (no link to `admin_user`), cookie `fluxkit_customer_session`: `HttpOnly`, `SameSite=Lax`, `Path=/store`, `Secure` unless `STORE_COOKIE_SECURE=false` (exactly `true` or `false`). The admin guard reads only `fluxkit_admin_session` (`Path=/admin`); the customer guard reads only the customer cookie. A customer cookie on any `/admin` route is `401` and an admin cookie on customer routes is `401`; route-walking tests prove it. The same email may exist as an admin and as a customer; they are unrelated accounts. No admin role or permission applies to customers.
- **Rules reused from admin auth, with customer lifetimes.** scrypt hasher with the parameters in the hash string and a dummy hash for unknown emails; password policy 12 to 128 characters and not equal to the email; email normalization (`customer.email` has `CHECK email = lower(btrim(email))`); token of 32 random bytes with only its SHA-256 stored; expiry rules of `evaluateSession` with customer limits: idle `CUSTOMER_SESSION_IDLE_MINUTES` (default 43 200 = 30 days, at most 525 600) and absolute `CUSTOMER_SESSION_MAX_HOURS` (default 2 160 = 90 days, at most 8 760).
- **Session hygiene.** A new token at every login and registration (no session fixation; a pre-existing customer cookie is replaced and the cart cookie is cleared after the merge, ADR 0015). A password change revokes the other sessions; deactivation by an admin revokes all.
- **Lockout and limits.** 5 failed logins lock the account for 15 minutes (as ADR 0010); the answer is an identical `401` for an unknown email, a wrong password, a locked or an inactive account. Per-IP limits use the in-memory window class generalized from the admin login limit (single-process, documented): login 20 per 10 minutes, registration 10 per hour, checkout 10 per 10 minutes, order lookup and guest cancel 20 per 10 minutes, cart writes 120 per minute. The numbers are internal, not contract. Answer: `429 too_many_requests` with `Retry-After`. A Redis-backed limiter is a separate plan (launch blocker already listed in `docs/HANDOFF.md`).
- **Store CSRF.** Every `POST`, `PUT`, `PATCH` and `DELETE` under `/store` needs `X-Fluxkit-CSRF: 1` and, with a body, a JSON content type: the admin rule extended to the store. The store was GET-only, so nothing breaks. The API sends no CORS headers. All new store routes send `Cache-Control: no-store`.
- **No email verification and no password reset in v1.** Marked `TODO(fluxkit): needs the email provider plan`. `customer.email_verified_at` exists (always null) so the email plan needs no migration for it. No mail port is built now: an unused port is speculative and the email plan defines it. A customer who forgets the password can still check out as a guest; an admin cannot set a customer's password, only deactivate or unlock.
- **Registration discloses a taken email.** Without email delivery, registering with a taken email answers `409 conflict` on `email`, which reveals that the email has an account. Accepted for v1 and mitigated by the registration rate limit; the email plan switches to "check your inbox". Login stays non-enumerating.
- **Guest orders are never attached to an account by email** in v1: the email is unverified (ADR 0017).
- **Profile.** `firstName`, `lastName`, optional `phone`. No address book in v1; the order stores its own addresses.
- **Privacy.** Customers store email, names and an optional phone. No IP address, user agent or device data is stored. Logs never contain emails, phones, addresses or tokens. Deactivation only, no automatic deletion (ADR 0017).

## Alternatives rejected

- **Sharing the admin session table, cookie or guard.** One bug would open the back office to shoppers. Separate names, paths, tables and guards make confusion a test failure.
- **Bearer tokens or JWT for customers.** Needs a separate API host or token storage in the browser, and the storefront is same-site; cookies with a hashed server-side session reuse what is already reviewed.
- **`SameSite=Strict`.** The customer would look signed out on the first navigation from an email link or another site. `Lax` plus the CSRF header covers writes.
- **Disabling registration until email delivery exists.** Rejected by the recommended default; guest checkout stays available but accounts are wanted from the start.
- **An admin-issued one-time reset link that the shop sends by hand.** Possible later; not built now.
- **Attaching guest orders by email.** An unverified email would let anyone claim another person's orders.

## Consequences

- Registration and login need no email provider; the cost is the enumeration trade-off above and no self-service recovery until the email plan.
- The in-memory limiter does not span instances; behind several API instances the limits are per instance.
- Admin permissions for customer data are `customers.read` and `customers.write` (owner and manager; the viewer has neither, ADR 0017).
- Both cookies live under different paths, so the browser never sends the customer cookie to `/admin`.
