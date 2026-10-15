# 0010. Admin lockout, recovery and the limits of the session design

Status: accepted 2026-10-16 (owner decision). Extends ADR 0009 after the independent security review of the admin auth (`docs/plans/2026-10-16-auth-and-roles.md`, step 5).

## Context

- ADR 0009 locks an account for 15 minutes after 5 failed logins (stored in the database, so it spans API instances).
- The review noted that this lets anyone who knows an owner's email keep that owner locked out, including the last owner (a targeted denial of service), and that the IP limit keys on the exact address, so one IPv6 /64 (2^64 addresses) is not limited at all.
- The review also listed properties of the session design that are deliberate or deferred. They are recorded here so nobody has to rediscover them.

## Decision

- **The lockout stays as designed.** 5 failures lock the account for 15 minutes; failures during a lock neither count nor extend it. The owner chose brute-force resistance over availability for an attacker who knows an email: a 12-character minimum password policy and no unlimited guessing matter more for a shop back office than the risk that an attacker can lock an owner out for 15 minutes at a time.
- **Accepted trade-off (denial of service by lockout).** An attacker who knows an admin's email can keep that account locked by failing logins every 15 minutes. Mitigations that exist: the per-IP limit slows a single source; sessions that already exist are not ended by a lock; recovery needs no session (below). Mitigations NOT built: CAPTCHA, per-IP-and-account counters, progressive delays.
- **Recovery without a session.** `pnpm admin:unlock --email <address>` sets `failed_login_count = 0` and `locked_until = null` for that user and nothing else (never the password, role, active flag or sessions). It is a command-line tool run on the server with `DATABASE_URL`, like `pnpm admin:create`; it prints only `Unlocked <email>` or `<email> was not locked`, and exits with 1 for an unknown email. The other ways out: wait 15 minutes, or another owner resets the password (which also clears the lock).
- **IPv6 is limited per /64.** The in-memory login limit keys an IPv6 client by its /64 prefix (canonical form: case, compression and zone ids do not matter) and an IPv4-mapped address (`::ffff:a.b.c.d`) by its IPv4 address. Cost: clients that share a /64 (some mobile networks, one office) share a window of 20 attempts per 10 minutes. Text that is not an IP address is counted under its raw value.
- **Expired sessions are removed without timers.** At login the user's expired sessions are deleted in the login transaction; once at application start all expired sessions are deleted (a failure is a logged warning, not a startup failure). Rows of users who never return are therefore removed at the next restart; a long-running process that never restarts keeps them until that user signs in.
- **The session is issued inside the login transaction**, under the user row lock, so a password reset or change that revokes sessions cannot be followed by a session for the old password.
- **No store for admin responses.** Every response under `/admin`, errors included, carries `Cache-Control: no-store`.

## Known limits, accepted or deferred

| Topic | State |
|---|---|
| Password reset needs no current password | By design: an owner resets another user's (or their own) password with `users.manage`; there is no email-based self-service reset yet. |
| Audit log | None. Logs carry reason codes and the user id of a successful login only. A table of sign-ins and user changes is a follow-up (own plan, schema). |
| Token rotation | `change-password` ends all OTHER sessions but keeps the caller's token; the token is not rotated. |
| Concurrent sessions | Unlimited per user. |
| Older cookie at login | Logging in does not revoke a session that the same browser already holds; it only issues a new one. |
| Cookie tossing | A sibling subdomain that can set cookies for the parent domain could plant a session cookie. The cookie has no `Domain` attribute and `Path=/admin`; a `__Host-` prefix is not used because of that path. Deploy the admin on a host that no untrusted subdomain can write cookies for. Not mitigated in code. |
| Feature-module middleware | A feature module may register middleware that runs before the guard (middleware runs before guards) and reads the request. The guard protects routes, not middleware; feature authors must not put sensitive behaviour in middleware under `/admin`. The `no-store` header is set by middleware registered in the auth module, and also by the problem filter for errors raised earlier. |
| Swagger UI and `/docs-json` | Public and they describe the admin routes. Whether they stay public in production is an OPEN owner decision. |
| Per-process IP limit, `trust proxy` | Unchanged from ADR 0009: in memory, single process; behind a reverse proxy configure Express `trust proxy` or all clients share one window. |
| `seed` at start | `pnpm seed` builds the full application module, so it also runs the one-time expired-session cleanup at start; `admin:create` and `admin:unlock` switch it off. |

## Consequences

- Operators have a documented, session-free way out of a lockout (README, Admin sign-in).
- A /64 shared by many legitimate admins can be throttled together; the numbers (20 per 10 minutes) are internal, not contract.
- The deferred items above need their own plans: audit log, session rotation, Redis-backed throttle with `trust proxy`, the Swagger decision.
