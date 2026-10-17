# API: customer accounts

Customer accounts of the store (`/store/account/*`) and customer management for admins (`/admin/customers/*`), plan step 3b of `docs/plans/2026-10-17-cart-and-orders.md`, on the infrastructure of step 3a. Decisions: `docs/adr/0016-customer-accounts-and-sessions.md`. Admin counterpart: `docs/api/auth.md`. Source of truth for routes and schemas: `docs/api/openapi.json`. No feature flag: accounts are core. The cart (`docs/api/cart.md`) is built and register and login merge the guest cart (below); checkout and the customer's order history are in `docs/api/orders.md` (`POST /store/checkout`, `GET /store/account/orders`, `GET /store/account/orders/{number}`, `POST /store/account/orders/{number}/cancel`); no password reset or email verification exists (`TODO(fluxkit): needs the email provider plan`).

Every state-changing request needs `X-Fluxkit-CSRF: 1` and, with a body, `Content-Type: application/json` (otherwise `403 forbidden`, before authentication and rate limiting). Every response under `/store/account`, errors and public routes included, carries `Cache-Control: no-store`. Auth levels below: `public` (no session) and `customer` (a valid customer session cookie).

## Store endpoints

A customer is `{id, email, firstName, lastName, phone, createdAt}`; `phone` is `null` when not set. The response never contains the password hash, the lockout state, the activity flag or any other column.

| Endpoint | Auth | Purpose | Request | Response | Errors |
|---|---|---|---|---|---|
| `POST /store/account/register` | public; rate limit `registration` | Create an account and sign in with a NEW session; a session cookie the request carried is revoked | `{email, password, firstName, lastName, phone?}` (strict). Email: core `validateEmail` (trimmed, lower-cased). Password: core policy, 12 to 128 characters, not equal to the email, no NUL (checked against the normalized email). Names: 1 to 100 characters, no control characters. Phone: optional, 7 to 15 digits, optional leading `+`, stored as `+digits` or `digits` | `201 {customer, cartNotices}` and the session cookie in `Set-Cookie`; the guest cart cookie is cleared when the request carried one | `400` structure or fields (all errors at once: `email`, `password`, `firstName`, `lastName`, `phone`; codes of core, e.g. `too_short`, `equals_email`, `empty`, `invalid_format`); `409 conflict` with `field: "email"` for a taken email in any case or spacing (accepted trade-off while no email can be sent, ADR 0016); `429` |
| `POST /store/account/login` | public; rate limit `login` | Sign in; always a NEW session and token; a session cookie the request carried is revoked after success | `{email, password}` (strict; both at most 1024 characters) | `200 {customer, cartNotices}` and the session cookie; the guest cart cookie is cleared when the request carried one | `400` structure; `401 unauthorized` for EVERY failure (unknown email, wrong password, locked account, inactive account: same status, headers and body, no cookie); `429` |
| `POST /store/account/logout` | customer | End this session only and clear the cookie | none | `204` | `401` |
| `GET /store/account/me` | customer | The own profile, read from the database | none | `200 {customer}` | `401` |
| `PATCH /store/account/me` | customer | Change own names and phone | `{firstName?, lastName?, phone?}` (strict: any other field, the email, `id`, `isActive` and the rest, is `400 unknown_field`); `phone: null` removes the phone; an empty body changes nothing | `200 {customer}` | `400`; `401` |
| `POST /store/account/change-password` | customer | Change the own password; every OTHER session of the customer ends, this one stays | `{currentPassword, newPassword}` (strict) | `204` | `400` with `path: "newPassword"` (`too_short`, `too_long`, `equals_email`, `contains_nul`, `same_as_current`) or `path: "currentPassword"`, `code: "incorrect"` (wrong, or the account is locked); `401` |

### Sign-in rules (same as the admin sign-in, `docs/api/auth.md`, on the customer tables)

- **Same answer for every failed login.** Unknown email, wrong password, locked account and inactive account all answer the identical `401 unauthorized` (body `The email or password is not correct.`) and do exactly one scrypt computation each (a dummy one when there is no hash to check or the account may not sign in). A wrong password also writes the failure count, so a small response-time difference can exist; do not rely on timing. The log gets only a reason code (`unknown_account`, `wrong_password`, `locked`, `inactive`), never the email, password, token or an id.
- **Lockout** (database, spans API instances): 5 failed logins lock the account for 15 minutes. Failures during a lock neither count nor extend it; an expired lock starts a fresh count; a successful login resets the count. Sessions that already exist are not ended by a lock. An admin can clear a lock (`POST /admin/customers/{id}/unlock`).
- **`change-password` failure counting.** A wrong `currentPassword` counts toward the same lockout like a failed login, and a locked account cannot be used to guess the current password there either (the right password is also refused while the lock lasts). This is what the admin `change-password` does; it is deliberate and tested.
- **Per-address limits** (memory, per API process, internal numbers): `login` 20 per 10 minutes, `registration` 10 per hour, each its own window and separate from the admin login limit. Over the limit: `429 too_many_requests` with `Retry-After`, answered before validation, lookup or hashing. Behind a reverse proxy configure Express `trust proxy` (otherwise all clients share one window).
- **Fresh session every time, no fixation.** Register and login create a new random token. If the request carried a customer session cookie, that session is deleted after the new one is created, also when it belongs to another customer; a FAILED login revokes nothing. A password change deletes all other sessions of the customer.
- **Success** also stamps `last_login_at`, stores a fresh hash when the stored scrypt parameters are not the current ones, and issues the session, in one transaction under the customer's row lock (a concurrent deactivation or password change therefore wins or waits; no session can outlive a deactivation).
- **Guest cart merge** (ADR 0015). The request's `fluxkit_cart` cookie names the guest cart. Inside the register and login transaction, after the password check and under the customer's row lock, that cart is merged into the customer's cart with the core `mergeCarts`: both cart rows are locked lower id first; a variant in both carts adds up (capped at 999, notice `quantity_capped`); guest-only lines are appended in guest order and those beyond 100 lines are dropped (notice `lines_dropped`); the price the shopper last saw (`seen`) stays the customer's older one, or is the guest's when the customer had no such line, so a price change still shows; the guest cart is deleted; the cart cookie is cleared in the response (same flags as when it was set). A cart expired at that moment is not merged (and removed); a customer cart that expired starts empty.
  - `cartNotices` is always present: `[]` when nothing was capped or dropped, no cart cookie was sent, or the cookie matched no cart (then nothing is merged and no cart is created); otherwise `[{code: "quantity_capped"}]`, `[{code: "lines_dropped"}]` or both, in that order. The merged cart is read with `GET /store/cart`.
  - **A refused sign-in never touches the guest cart or its cookie**: wrong password, unknown email, locked or inactive account, an invalid body and a taken email all leave the cart, the cookie and the customer's cart as they were. The merge and the new session commit together or not at all.
  - Races: two sign-ins that share a guest cookie merge it once (the second finds no cart); two accounts signing in with one cookie give the lines to exactly one; a merge never deadlocks with the same customer's cart writes from another session (the lock order is customer row, then carts by id).
- **Ownership.** Every customer route acts on the principal the session produced; no id, email or customer field in a path, query, header or body can select another customer.

## Admin endpoints

All need an admin session; the permission is the default pair of the controller (`@AdminController("customers", {read: "customers.read", write: "customers.write"})`): `GET` needs `customers.read`, every other method `customers.write`. Owner and manager hold both, the viewer neither (`403 forbidden`). Anonymous callers get `401`, a state-changing request without the CSRF header `403`. Every response is `no-store`. There is no create, delete, email change or password route: an admin can only read, deactivate/activate and unlock (ADR 0016).

| Endpoint | Auth | Purpose | Request | Response | Errors |
|---|---|---|---|---|---|
| `GET /admin/customers` | `customers.read` | List customers ordered by email, then id | `?limit` (1 to 100, default 50), `?offset`, `?q` (start of the email, case and surrounding spaces ignored; `%` and `_` are literal; at most 254 characters) | `200 {items, total, limit, offset}`; item `{id, email, firstName, lastName, isActive, lastLoginAt, createdAt}` | `400` |
| `GET /admin/customers/{id}` | `customers.read` | One customer with the number of their orders | none | `200` item plus `{phone, isLocked, orderCount, updatedAt}`; `orderCount` is a real `COUNT` over `sales_order`; `isLocked` is true while a lock is in force | `400` malformed id; `404` |
| `PATCH /admin/customers/{id}` | `customers.write` | Activate or deactivate. Deactivating deletes ALL sessions of the customer in the same transaction, so their cookies stop working at once and sign-in is refused with the identical `401` | `{isActive}` (boolean, required, strict) | `200` detail as above | `400`; `404` |
| `POST /admin/customers/{id}/unlock` | `customers.write` | Clear the failure counter and the lock; sessions are untouched | none | `204` | `400`; `404` |

Responses never contain the password hash, the failure counter or `lockedUntil`.

## Principal

- A customer is a separate principal from an admin: tables `customer` and `customer_session` (no link to `admin_user`), its own cookie, guard and session service. The same email may exist as an admin and as a customer; they are unrelated accounts (independent passwords, lockout and sessions, tested on the real routes). No admin role or permission applies to a customer.
- A route that handles a customer's own data is marked `@CustomerAuthenticated()` (method or controller). **The store is public by default**: an unmarked route under `/store` needs no session. The route-walk test `customer-routes.spec.ts` lists the only two public routes under `/store/account` (register and login) and fails for any other unmarked one.
- `@CurrentCustomer()` gives the route `{customerId, email, sessionId}`. It is set only by the guard (a request-keyed `WeakMap`, not a property a client could send). A route must never take the customer id from a body, query or header.

## Session and cookie

| Item | Rule |
|---|---|
| Cookie | `fluxkit_customer_session`: `HttpOnly`, `SameSite=Lax`, `Path=/store`, `Secure` unless `STORE_COOKIE_SECURE=false`, `Max-Age` = the session's remaining lifetime in seconds (at most `CUSTOMER_SESSION_MAX_HOURS`). `Path=/store` means a browser never sends it to `/admin`; the admin cookie (`fluxkit_admin_session`, `Path=/admin`, `SameSite=Strict`) is never read by the customer guard. Logout clears it, with the same path and flags |
| Token | 32 random bytes (base64url, 43 characters), a NEW one for every session; only its SHA-256 is stored in `customer_session.token_hash`. The raw token exists in the cookie only. When a request carries the cookie twice, only the first well-formed value is read |
| Authentication | The customer guard reads only that cookie. An `Authorization` header, a query parameter, a body field or any other cookie name never authenticates |
| Lifetime | Idle `CUSTOMER_SESSION_IDLE_MINUTES` (default 43 200 = 30 days) and absolute `CUSTOMER_SESSION_MAX_HOURS` (default 2 160 = 90 days), the admin rules of `evaluateSession` (a limit reached exactly is expired). `last_seen_at` is touched at most once a minute. An expired session is deleted when it is presented; the scheduler job `delete-customer-sessions` deletes the rest once the ABSOLUTE expiry has passed (`docs/api/jobs.md`) |
| Checked on every request | The session row, its expiry and `customer.is_active` are read from the database each time; deactivating a customer takes effect on the next request |
| Failure | Missing, malformed, unknown, expired, revoked and inactive all answer the identical `401 unauthorized` (same status, headers and body, no `Set-Cookie`) |
| Caching | Every response under `/store/account`, `401`, `403`, `429` and a `413` included, carries `Cache-Control: no-store`. Public catalog routes are unchanged |
| Server failure | A database or authenticator failure is a logged `500`, never a `401` and never access |

Whoever sits behind the same browser profile has the cookie: sign-out and "change password" (which ends the other sessions) are the remedies.

## CSRF on the store

Every `POST`, `PUT`, `PATCH` and `DELETE` under `/store` (matched like Express: case-insensitive, trailing slash included), signed in or not and whatever module serves the route, must send `X-Fluxkit-CSRF: 1` and, when it has a body, `Content-Type: application/json`; otherwise `403 forbidden`. The check runs before authentication and before rate limiting, so a request without the header is `403` also when it would have been `401`. `GET`, `HEAD` and `OPTIONS` are exempt. The API sends no CORS headers, so a page on another origin cannot add the header.

## Rate limits

`@RateLimit(name)` limits a route per client address (`request.ip`, IPv6 counted per /64, in memory, single process: each API instance counts alone and a restart forgets). Over the limit: `429 too_many_requests` with `Retry-After`. Internal defaults, not contract:

| Name | Limit | Used by |
|---|---|---|
| `login` | 20 per 10 minutes | `POST /store/account/login`; the admin login keeps its own window of the same size |
| `registration` | 10 per hour | `POST /store/account/register` |
| `checkout` | 10 per 10 minutes | `POST /store/checkout` (`docs/api/orders.md`) |
| `orderLookup` | 20 per 10 minutes | `POST /store/orders/lookup` |
| `guestCancel` | 20 per 10 minutes | `POST /store/orders/cancel` |
| `cartWrite` | 120 per minute | the cart writes (`docs/api/cart.md`) |

## Not built yet

Email verification and password reset (a later email plan). The customer's orders (`docs/api/orders.md`) and the scheduler job that deletes expired customer sessions (`docs/api/jobs.md`) are built.
