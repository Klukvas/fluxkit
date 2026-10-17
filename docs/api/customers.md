# API: customer accounts (infrastructure)

What exists of customer authentication after plan step 3a (`docs/plans/2026-10-17-cart-and-orders.md`): the session, cookie, guard, CSRF and rate-limit machinery that later steps use. **No customer endpoint exists yet**: register, login, logout, me and change-password are step 3b, `/admin/customers` is step 3b, the cart and orders are steps 4 and 5. This page lists the endpoints when they are built; it documents no route that is not in `docs/api/openapi.json`. Decisions: `docs/adr/0016-customer-accounts-and-sessions.md`. Admin counterpart: `docs/api/auth.md`.

## Principal

- A customer is a separate principal from an admin: tables `customer` and `customer_session` (no link to `admin_user`), its own cookie, guard and session service. The same email may exist as an admin and as a customer; they are unrelated accounts. No admin role or permission applies to a customer.
- A route that handles a customer's own data is marked `@CustomerAuthenticated()` (method or controller). **The store is public by default**: an unmarked route under `/store` needs no session. A route under `/store/account` that is neither marked nor on the explicit public list (register and login, step 3b) fails `customer-routes.spec.ts`.
- `@CurrentCustomer()` gives the route `{customerId, email, sessionId}`. It is set only by the guard (a request-keyed `WeakMap`, not a property a client could send). A route must never take the customer id from a body, query or header.

## Session and cookie

| Item | Rule |
|---|---|
| Cookie | `fluxkit_customer_session`: `HttpOnly`, `SameSite=Lax`, `Path=/store`, `Secure` unless `STORE_COOKIE_SECURE=false`, `Max-Age` = `CUSTOMER_SESSION_MAX_HOURS` in seconds. `Path=/store` means a browser never sends it to `/admin`; the admin cookie (`fluxkit_admin_session`, `Path=/admin`, `SameSite=Strict`) is never read by the customer guard |
| Token | 32 random bytes (base64url, 43 characters), a NEW one for every session; only its SHA-256 is stored in `customer_session.token_hash`. The raw token exists in the cookie only |
| Authentication | The customer guard reads only that cookie. An `Authorization` header, a query parameter, a body field or any other cookie name never authenticates |
| Lifetime | Idle `CUSTOMER_SESSION_IDLE_MINUTES` (default 43 200 = 30 days) and absolute `CUSTOMER_SESSION_MAX_HOURS` (default 2 160 = 90 days), the admin rules of `evaluateSession` (a limit reached exactly is expired). `last_seen_at` is touched at most once a minute. An expired session is deleted when it is presented |
| Checked on every request | The session row, its expiry and `customer.is_active` are read from the database each time; deactivating a customer takes effect on the next request |
| Revocation (service) | Revoke one session by token or by id, all sessions of a customer, all except one (password change). Used by step 3b |
| Failure | Missing, malformed, unknown, expired, revoked and inactive all answer the identical `401 unauthorized` (same status, headers and body, no `Set-Cookie`) |
| Caching | Every response of a customer-authenticated route, `401` included, carries `Cache-Control: no-store`. Public store routes are unchanged |
| Server failure | A database or authenticator failure is a logged `500`, never a `401` and never access |

Whoever sits behind the same browser profile has the cookie: sign-out and "end all sessions" are the remedies (step 3b).

## CSRF on the store

Every `POST`, `PUT`, `PATCH` and `DELETE` under `/store` (matched like Express: case-insensitive, trailing slash included), signed in or not and whatever module serves the route, must send `X-Fluxkit-CSRF: 1` and, when it has a body, `Content-Type: application/json`; otherwise `403 forbidden`. The check runs before authentication and before rate limiting, so a request without the header is `403` also when it would have been `401`. `GET`, `HEAD` and `OPTIONS` are exempt. The API sends no CORS headers, so a page on another origin cannot add the header. The store was GET-only, so no existing request changes.

## Rate limits

`@RateLimit(name)` limits a route per client address (`request.ip`, IPv6 counted per /64, in memory, single process: each API instance counts alone and a restart forgets; behind a reverse proxy configure Express `trust proxy`). Over the limit: `429 too_many_requests` with `Retry-After`. Internal defaults, not contract:

| Name | Limit | Used by |
|---|---|---|
| `login` | 20 per 10 minutes | customer login (step 3b); the admin login keeps its own window of the same size |
| `registration` | 10 per hour | register (step 3b) |
| `checkout` | 10 per 10 minutes | checkout (step 5) |
| `orderLookup` | 20 per 10 minutes | guest order lookup (step 5) |
| `guestCancel` | 20 per 10 minutes | guest cancel (step 5) |
| `cartWrite` | 120 per minute | cart writes (step 4) |

## Not built yet

Register, login, logout, me, change-password, lockout of customer accounts, the password hasher for customers (it reuses the admin scrypt hasher), `/admin/customers` (step 3b); email verification and password reset (a later email plan, `TODO(fluxkit): needs the email provider plan`).
