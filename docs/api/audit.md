# API: admin audit log

What admins did to customer accounts, admin users and (from privacy plan step 6) privacy requests: privacy plan step 5, ADR 0033 decision 9. Source of truth for routes and schemas: `docs/api/openapi.json`. No feature flag: the audit log is core. Every response under `/admin` carries `Cache-Control: no-store`.

## Endpoints

| Endpoint | Auth | Purpose | Request | Response | Errors |
|---|---|---|---|---|---|
| `GET /admin/audit-events` | `users.manage` (owner) | List audit events, newest first (`createdAt`, then `id`, descending) | `?limit` (1 to 100, default 50), `?offset` (0 to 10 000), `?action` (one of the actions below), `?adminUserId` (uuid), `?targetKind` (`customer`, `order`, `admin_user`, `privacy_request`), `?targetId` (uuid), `?from` (inclusive) and `?to` (exclusive): ISO 8601 with `Z` or an offset, between 2000-01-01 and 2200-01-01, `from` not after `to`. Filters combine (AND); an unknown parameter is `400` | `200 {items, total, limit, offset}`; item `{id, createdAt, adminUserId \| null, action, targetKind, targetId, detail}` | `400`, `401`, `403` |

There is no write route: events are written by the services they audit, in the same transaction as the change, so an event exists exactly when the change committed (a refused or failed change writes none).

## Events

| Action | Written by | Target | `detail` |
|---|---|---|---|
| `customer.deactivated`, `customer.activated` | `PATCH /admin/customers/{id}` (every successful call, by the value sent) | `customer` | `{}` |
| `customer.unlocked` | `POST /admin/customers/{id}/unlock` | `customer` | `{}` |
| `admin_user.created` | `POST /admin/users`; `pnpm admin:create` (no acting admin: `adminUserId` is `null`) | `admin_user` | `{role}`; from the command `{role, source: "cli"}` |
| `admin_user.role_changed` | `PATCH /admin/users/{id}` when the role really changes | `admin_user` | `{fromRole, toRole}` |
| `admin_user.deactivated` | `PATCH /admin/users/{id}` when an active user is deactivated | `admin_user` | `{}` |
| `admin_user.activated` | `PATCH /admin/users/{id}` when an inactive user is activated (an already active user records nothing) | `admin_user` | `{}` |
| `admin_user.password_reset` | `POST /admin/users/{id}/reset-password` | `admin_user` | `{}` |
| `privacy.lookup`, `privacy.exported`, `privacy.erased`, `privacy.request_changed` | the privacy routes (`docs/api/privacy.md`, later steps) | `privacy_request` or `customer` | codes and counts |

- `detail` holds codes, counts, flags and lists of codes only (core `buildAdminAuditEvent`, at most 2 KiB); never an email, name, phone, address or free text. An audit row therefore survives the erasure of the person it is about.
- `adminUserId` is the signed-in admin; `null` once that admin user is deleted (the foreign key's SET NULL), and for `pnpm admin:create` (`detail.source` is `cli`). The table is append-only (row trigger in migration 0009; `TRUNCATE` refused by a statement trigger since migration 0011); rows older than 365 days may be purged (job 12, privacy plan step 8).
- Not audited (recorded gaps): reads of customer or order details (ADR 0033 decision 9), the command-line tool `pnpm admin:unlock` (the core list has no action for unlocking an admin user; only `admin_user.activated` was approved for migration 0011), and order, shipment, payment and stock writes (they have their own journals with the acting admin).
