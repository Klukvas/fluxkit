# Plan: admin authentication and roles

Status: proposed 2026-10-16; the three main decisions are taken by the owner (see "Decisions"); waiting for plan approval (red zones: auth, schema and migration, public contract).
Roles: Architect step is covered by this plan and a short ADR 0009 written in step 1; Developers (Sonnet); independent Reviewer (Opus, a different model than the authors); Docs inside each step.
Follows: `docs/plans/2026-10-14-catalog.md` (completed). Replaces the temporary default-deny authenticator promised there ("a separate small auth and roles plan follows right after").

## Goal
Real login for the admin API: admins sign in, get a revocable server session, and every `/admin` route is allowed only for roles that hold the route's permission. After this plan the catalog admin API is usable in production by a client's team.
Customers' accounts (storefront login) are a different plan.

### Out of scope (each gets its own plan)
Customer accounts and storefront login, OAuth or SSO or two-factor authentication, password reset by email (needs email delivery), admin UI login screen (`apps/admin` is a placeholder), an audit log table, API keys for scripts, multi-instance rate limiting (needs Redis or a dependency; same follow-up as the store rate limit).

## Existing functionality found
- `AdminGuard` + global `AdminPathGuard` (deny by default for every `/admin` path), `ADMIN_AUTHENTICATOR` provider token and `DenyAllAdminAuthenticator` in `apps/api/src/auth/`. The comment on `admin-authenticator.ts` already reserves the seam: a real authenticator replaces the provider, controllers stay as they are.
- Tests inject an allow-all authenticator through `startApp({ adminAuthenticator })`; a route-walking test proves every `/admin` route answers 401 under deny-all (`admin-default-deny.spec.ts`).
- Problem+json errors with codes `unauthorized` (401) exist; there is no `forbidden` (403).
- No users, sessions, password hashing, cookie handling, CORS or CSRF code exists. `node:crypto` (scrypt, randomBytes, timingSafeEqual) is available, so no dependency is needed. `ioredis` is a dependency but not used for this plan.
- The seed runner creates data through services, bypassing HTTP auth; it stays that way.

## Decisions (owner, 2026-10-16)
1. **Login**: server sessions stored in Postgres, carried by an HttpOnly cookie. (Not JWT, not static API keys.)
2. **Roles**: fixed roles with their permissions defined in code (`owner`, `manager`, `viewer`). No role or permission tables.
3. **First admin**: a CLI command `pnpm admin:create` creates the first owner. No public sign-up or setup endpoint.

## Design

### Roles and permissions (pure, in `packages/core/src/auth`)
Permissions: `catalog.read`, `catalog.write` (create, update, delete, dictionaries, variants, media, categories), `catalog.publish` (publish, unpublish, archive, restore), `users.manage`.

| Role | Permissions |
|---|---|
| `owner` | all four |
| `manager` | `catalog.read`, `catalog.write`, `catalog.publish` |
| `viewer` | `catalog.read` |

Adding a client-specific role later is a code change in one file plus a test, without a schema migration (the role column is a plain text with a CHECK; extending the list needs a one-line migration, noted in the ADR).

### Data (migration `0002_admin_auth`, up and down)
- `admin_user`: `id` uuid, `email` text (stored lower-cased, unique), `password_hash` text, `role` text CHECK in the role list, `is_active` boolean, `failed_login_count` int, `locked_until` timestamptz null, `last_login_at`, `password_changed_at`, `created_at`, `updated_at`.
- `admin_session`: `id` uuid, `user_id` FK to `admin_user` ON DELETE CASCADE, `token_hash` text unique (SHA-256 of a 32-byte random token; the raw token exists only in the cookie), `created_at`, `last_seen_at`, `expires_at`. No IP address or user agent is stored.
- Down migration drops both tables and removes its row in `drizzle.__drizzle_migrations` (repo convention); tested up, down, up, down.

### Passwords
`node:crypto` scrypt with a per-password random salt, parameters stored in the hash string (`scrypt$N$r$p$salt$hash`) so they can be raised later with rehash on login; comparison with `timingSafeEqual`. Policy: 12 to 128 characters, no composition rules, rejected if it equals the email. Login for an unknown email still performs a dummy hash so timing does not reveal accounts.

### Sessions and cookie
- Cookie `fluxkit_admin_session`: `HttpOnly`, `SameSite=Strict`, `Path=/admin`, `Secure` unless `ADMIN_COOKIE_SECURE=false` (local plain-HTTP development only).
- Idle timeout `ADMIN_SESSION_IDLE_MINUTES` (default 720) and absolute lifetime `ADMIN_SESSION_MAX_HOURS` (default 168); `last_seen_at` is refreshed at most once a minute.
- Role and `is_active` are read from the database on every request, so a role change or deactivation applies immediately. Password change, password reset and deactivation delete the user's sessions.

### CSRF and CORS
The API sends no CORS headers (browsers cannot call it cross-origin with credentials). On top of `SameSite=Strict`, every state-changing admin request (POST, PUT, PATCH, DELETE) must carry the header `X-Fluxkit-CSRF: 1` and, when it has a body, `Content-Type: application/json`; otherwise `403 forbidden`. A cross-site form or fetch cannot set that header without a preflight, which the API never approves.

### Login throttling
Per account: 5 failed attempts lock the account for 15 minutes (columns above); a successful login resets the counter. Per IP: an in-memory fixed window (20 attempts per 10 minutes) with a documented single-process limitation. Failure answers are identical for unknown email, wrong password and locked account (`401 unauthorized`, same body) so accounts cannot be enumerated.

### Authorization in the API
- `AdminAuthenticator` changes from `allows(request): boolean` to `authenticate(request): AdminPrincipal | undefined` with `{ userId, email, role, permissions }`; the guard attaches the principal to the request. Test helpers keep working through an authenticator that returns an owner principal.
- Every admin route declares exactly one permission with `@RequirePermission(...)` or is explicitly `@PublicAdminRoute()` (only `POST /admin/auth/login`). A route that declares neither is denied (`403 forbidden`), and a route-walking test fails the build when any `/admin` route lacks a declaration. The existing `@AdminController` bundles the guard and metadata defaults; the existing global `AdminPathGuard` stays as the safety net.
- New problem code `forbidden` (403): authenticated but the role lacks the permission, or the CSRF header is missing.
- A role/permission matrix test walks all admin routes and checks viewer, manager and owner against the declared permission, with real HTTP calls for a representative route per permission.

### Endpoints (all under `/admin`)
- `POST /admin/auth/login` (public): `{email, password}`; `200` with `{user}` and the session cookie; `401` on any failure.
- `POST /admin/auth/logout` (any signed-in admin): deletes the session, clears the cookie, `204`.
- `GET /admin/auth/me`: current user and permissions.
- `POST /admin/auth/change-password`: `{currentPassword, newPassword}`; revokes the other sessions.
- `GET /admin/users`, `POST /admin/users`, `GET /admin/users/:id`, `PATCH /admin/users/:id` (`role`, `isActive`), `POST /admin/users/:id/reset-password` (`{newPassword}`, revokes sessions): `users.manage` only. No delete: deactivate instead. The last active owner cannot be demoted or deactivated.

### CLI
`pnpm admin:create` (root script calling a built `apps/api` entry like the seed): `--email`, `--role` (default `owner`), password from `ADMIN_PASSWORD` or a prompt, never from a command-line argument. Refuses an existing email, validates the password policy, prints no secret. Documented in the README quick start and `seeds/README.md` (seed data does not create users).

### Configuration
New variables in `.env.example`, `packages/config`, `docs/contracts/config.md`: `ADMIN_COOKIE_SECURE` (default `true`), `ADMIN_SESSION_IDLE_MINUTES`, `ADMIN_SESSION_MAX_HOURS`. No signing secret is needed because tokens are random and stored hashed.

## Steps
1. **ADR 0009** (auth model, short) and the pure core rules, TDD, in `packages/core/src/auth/**`: roles, permissions, `hasPermission`, password policy, lockout decision (attempt counting, window), session expiry decision (idle and absolute), with a fixed clock. No Nest, no I/O. (Developer, Sonnet.)
2. **Schema and migration** `0002_admin_auth` with the Drizzle schema, constraint tests, up/down/up/down. Disjoint paths from step 1, so it runs in parallel. (Developer, Sonnet.)
3. **API**: password hasher, session service, authenticator, guards and decorators, `forbidden` problem, cookie and CSRF handling, auth and users endpoints, annotation of every existing admin controller route with its permission, throttling. Tests first for hashing, sessions, lockout and the guard; HTTP tests for every endpoint and the role matrix. Needs steps 1 and 2. (Developer, Sonnet.)
4. **CLI** `admin:create`, config and `.env.example`, docs: `docs/api/auth.md` (one line per endpoint), `docs/contracts/api.md` (auth, `forbidden`, CSRF header, cookie), `docs/contracts/config.md`, `docs/files/*`, README quick start, ADR index, `CHANGELOG.md`, `docs/HANDOFF.md`. (Developer, Sonnet.)
5. **Independent review** by Opus, a different model than the authors, focused on session handling, timing and enumeration, CSRF, privilege escalation through the users endpoints, the last-owner rule, cookie flags, migration reversibility, and tests that cannot fail. Findings are fixed before the plan is closed.

Order: `1 and 2 in parallel -> 3 -> 4 -> 5`. Each step is its own branch and PR into `main`; CI green before merge; merge only on the owner's word.

## Data and API changes
Migration `0002_admin_auth` (two new tables, nothing existing changes). New endpoints above (`docs/contracts/api.md`), new problem code `forbidden`, a new required request header for state-changing admin requests, cookie-based authentication replacing the "401 for everyone" default. Existing catalog routes keep their shapes; they only gain permission annotations.

## Risks
- Authentication bugs are high impact. Mitigations: pure rules tested first, a router-walking test that fails when a route lacks a permission, the matrix test, mutation checks by the orchestrator, an independent reviewer.
- A forgotten permission annotation on a future route: the default is deny plus the failing walk test.
- Scrypt cost versus login latency: parameters are stored in the hash and measured in tests; tunable later without migration.
- In-memory IP throttling does not span instances. Documented limit; the account lockout is in the database and does span instances.
- Without email delivery there is no self-service password reset: an owner resets passwords through `POST /admin/users/:id/reset-password`; the CLI can create a new owner if all owners are locked out.

## Verification
- Per step, from a clean clone: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm check:boundaries`, `pnpm check:licenses`, `pnpm test` (own scratch database when agents run in parallel), `pnpm audit:prod`, `pnpm --filter @fluxkit/api db:drift`, `pnpm check:docs`.
- Step 2: up, down, up, down on real Postgres; constraint tests.
- Step 3: the walk test fails when a permission annotation is removed from a route; the matrix test fails when a role gains a permission it should not; login answers are byte-identical for unknown email and wrong password; cookie flags asserted; session expiry with a fixed clock; the CSRF header is required.
- Orchestrator mutation checks: remove the guard, drop the permission check, drop the CSRF check, skip the lockout, skip session revocation on password change, allow demoting the last owner.

## Docs to update
`docs/adr/0009-admin-auth.md` (new) and index, `docs/api/auth.md` (new), `docs/contracts/api.md`, `docs/contracts/config.md`, `docs/files/api.md`, `docs/files/core.md`, `README.md` quick start, `.env.example`, `CHANGELOG.md`, `docs/HANDOFF.md`, `seeds/README.md`.

## Needs approval (red zones touched by this plan)
- Authentication and permissions (the whole plan).
- Migration `0002_admin_auth`.
- Public contract changes: new endpoints, `forbidden` problem code, the CSRF request header, the session cookie.
- No new dependency is requested.

## Implementation notes

### Step 3a (infrastructure)
- **Deviation: default permission by HTTP method.** The plan says every admin route declares exactly one permission by hand. To keep the 60-odd existing catalog routes untouched, `@AdminController` applies a default: a route without its own `@RequirePermission` needs `catalog.read` for GET and HEAD and `catalog.write` for every other method. Only the four product lifecycle routes (`publish`, `unpublish`, `archive`, `restore`) are annotated explicitly with `catalog.publish`. The safety property of the plan holds: a plain `@Controller("admin/...")` (no `@AdminController`, no metadata) has no default and is denied with `403 forbidden` once signed in (`401` before). `admin-permissions.spec.ts` resolves the permission of every route and fails when one is undeclared or differs from this rule.
- **Check order** in `AdminGuard`: CSRF header (state-changing methods, also for anonymous callers), then `@PublicAdminRoute` short circuit, then authentication (401), then permission (403). CSRF applies to public routes too, so login needs the header.
- **Both public and permissioned on one level** (`@PublicAdminRoute` with `@RequirePermission` on the same route or the same controller) throws, ending as a logged 500; it never silently becomes public. The route's own declaration wins over the controller's.
- **Config bounds** (not in the plan): `ADMIN_SESSION_IDLE_MINUTES` at most 525 600 and `ADMIN_SESSION_MAX_HOURS` at most 8 760 (one year), whole decimal numbers only, so a typo cannot silently mean "never expires". `ADMIN_COOKIE_SECURE` accepts exactly `true` or `false`.
- **scrypt bounds on stored strings**: `verify` treats `N` above 2^17, `r` or `p` above 16, a non power of two `N`, or a salt/hash that is not 16/64 bytes of strict base64 as malformed (returns false, never throws), so a corrupt row cannot make the API allocate gigabytes. Passwords are used as exact UTF-8 text without Unicode normalization.
- `docs/contracts/api.md` (listing the contract items) is left for step 4 as planned; `docs/api/catalog.md` already documents what exists.

