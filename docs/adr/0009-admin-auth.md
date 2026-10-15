# 0009. Admin authentication and roles

Status: accepted 2026-10-16 (owner decisions: server sessions, fixed roles, first owner by CLI). Plan: `docs/plans/2026-10-16-auth-and-roles.md`.

## Context

- Until now every `/admin` route answered 401 (default-deny authenticator). The catalog admin API must become usable by a client's team.
- The template is sold to clients: simple to hand over, no external identity service, no new dependency, roles that fit most shops.
- Customer accounts, SSO, two-factor authentication and password reset by email are separate plans.

## Decision

- **Sessions**: server sessions in Postgres, carried by an HttpOnly cookie. The token is 32 random bytes; only its SHA-256 is stored, so a database leak does not yield usable sessions. Idle timeout and absolute lifetime are configurable; `last_seen_at` is refreshed at most once a minute. Sessions are revocable (logout, password change or reset, deactivation).
- **Roles**: fixed roles (`owner`, `manager`, `viewer`) with permissions defined in code (`packages/core/src/auth/roles.ts`), no role or permission tables. The `role` column is text with a CHECK; adding a role is a code change, a test and a one-line migration.
- **Role changes apply per request**: role and `is_active` are read from the database on every request, nothing is cached in the session. The last active owner cannot be demoted or deactivated.
- **Passwords**: `node:crypto` scrypt with a random salt per password; the parameters are part of the hash string (`scrypt$N$r$p$salt$hash`) so they can be raised later with a rehash at login; `timingSafeEqual` for comparison; a dummy hash for unknown emails. Policy: 12 to 128 characters, no composition rules, not equal to the email.
- **CSRF**: `SameSite=Strict` plus a required header `X-Fluxkit-CSRF: 1` (and `application/json` with a body) on state-changing admin requests. The API sends no CORS headers, so a cross-site page cannot set the header.
- **Throttling**: per account, 5 failed logins lock it for 15 minutes (stored in the database, spans instances); per IP, an in-memory window (single process). All login failures answer identically.
- **First owner**: CLI `pnpm admin:create`; no public sign-up or setup endpoint.
- **Pure rules in core**: permissions, password and email checks, lockout, session expiry and the last-owner rule are pure functions (time passed in), tested first. The API only performs I/O.

## Alternatives rejected

- **JWT**: cannot be revoked without a server-side list, which brings back sessions; role changes would lag until expiry.
- **Static API keys**: no per-person identity or expiry, hard to rotate; scripts get their own plan if needed.
- **Role and permission tables**: runtime-editable roles are not needed for the first clients and make every route's access harder to review; code is reviewable and testable.
- **A third-party auth library or identity service**: a new dependency and hosting burden for a small, well-understood problem.

## Consequences

- Every admin route must declare one permission or be explicitly public; a missing declaration is denied and a route-walking test fails the build.
- New public contract items: the `forbidden` (403) problem code, the CSRF header, the session cookie, the auth and users endpoints.
- IP throttling is lost on restart and not shared between instances (documented limit); account lockout is not.
- No self-service password reset until email delivery exists; an owner resets passwords, and the CLI can create another owner.
- A client-specific role needs a code change and a migration of the CHECK constraint.
