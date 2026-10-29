# 0033. Personal data: inventory, export, erasure, retention and audit

Status: accepted 2026-10-29 (the owner's standing instruction to take the recommended options, recorded in `docs/plans/2026-10-29-privacy.md` section "Owner answers"; questions 1 to 15 are all taken as recommended). The legal points (plan questions 2, 3, 9, 10 and tasks O1 to O8) still need a lawyer or an accountant before a production launch in the EU; nothing here is legal advice.

Builds on ADR 0009 (admin users are deactivated, never deleted), 0016 (customer accounts, "Privacy"), 0017 ("Personal data and retention"), 0018 (events carry ids only), 0019 (append-only journals, `pg_trigger_depth()` exceptions, the foreign keys ready for a customer delete), 0023 and 0031 (HMAC labels on `ORDER_TOKEN_SECRET`), 0026 and 0027 (storefront and admin architecture), 0028 to 0032 (media, shipping, email, payments: the processors). It changes none of them; it fulfils the promises in ADR 0017 ("A privacy plan comes before the EU launch") and ADR 0019 Consequences.

Only the decisions marked **built in step N** are implemented when this ADR is merged (steps 1 to 3 of the plan: this ADR, the data inventory with its guards, the pure rules in core). Everything else is a requirement for the later steps.

## Context

- Personal data is stored in `customer`, `sales_order` (contact fields, addresses), `email_message`, `customer_auth_token`, `admin_user`, and as free text in several journals; it is sent to Resend, Nova Post and Monobank (plan "Data inventory"). Nothing lists it in code, so a later column can store personal data unnoticed.
- Customers are deactivated, never deleted; no route exports, erases or anonymises anything; orders keep their contact snapshot forever; there is no audit log for customer or admin-user changes (`docs/HANDOFF.md` Next steps 2 and 4).
- The log, event and error-code rules are followed today, but each area proves them alone (`captureLogs` specs); there is no shared sentinel guard and no list of the cookies and origins the storefront may use.
- `sales_order` contact columns are `NOT NULL` with format CHECKs; `shipment` and `payment` rows keep an order undeletable (`ON DELETE RESTRICT`), so erasure of a buyer cannot mean deleting the order.

## Decision

### 1. Scope and boundaries (core, no feature flag; plan questions 1, 4, 5, 12, 14, 15 as recommended)
- Privacy is a core module: export and erasure must reach every core table. Features join through the inventory rule of decision 3.
- v1: data inventory and guards, customer export (self-service) and admin export by email, self-service account deletion (immediate after password re-entry, refused while a blocker exists), admin erasure of a subject, order anonymisation with a configurable retention job (off by default), a minimal admin audit log, a Privacy admin area, legal page placeholders, privacy documents.
- Guests are handled by the shop owner in v1 (admin lookup by email, identity checked off-band, the way recorded in the request note without copying documents). Later: guest self-service by emailed link, marketing consent, automatic deletion of inactive accounts, email rectification, restriction of processing, forwarding erasure to processors by API, a cookie consent manager.
- Export is a synchronous JSON download capped at 10 000 orders. No mail is sent after an account deletion.
- Non-goals: legal conclusions; client-specific legal text in master (AGENTS.md section 15); deleting orders, payments, refunds or shipments (accounting records); deleting admin users (they are deactivated; the employer handles staff requests).
- Where things live: pure rules in `packages/core/src/privacy/` (TDD, no I/O, enforced by dependency-cruiser); the inventory registry and its guard specs in `apps/api/src/privacy/inventory/`; services, jobs and routes in `apps/api/src/privacy/` and `apps/api/src/jobs/` (later steps); documents in `docs/privacy/` (step 11). No new dependency and no new dependency-cruiser rule: the existing core-purity rules cover the new folder.

### 2. Personal-data classes
Every database column gets exactly one class:

| Class | Code | Meaning |
|---|---|---|
| `personal` | P | identifies a person directly (email, name, phone, address) |
| `pseudonymous` | Q | identifies through another table or a third party (ids, order numbers, tracking numbers, card last four) |
| `staff` | S | personal data of an admin user |
| `secret_hash` | H | not personal alone, but linkable (token and password hashes, unsalted request hashes) |
| `free_text` | F | admin or shopper free text that MAY contain personal data typed by a person |
| `none` | - | no personal data |

### 3. The data inventory is code and a guard (**built in step 2**)
- `apps/api/src/privacy/inventory/` holds one entry per table and column of the Drizzle schema (`apps/api/src/database/schema/index.ts`): class, purpose reference to the plan's inventory row (`D1`...), export action, erasure action, and a short reason where the choice is not obvious.
- Export actions: `included`, `excluded` (a reason is required), `not_applicable` (class `none` only). Erasure actions: `delete_row`, `cascade`, `anonymise`, `set_null`, `clear`, `keep` (a reason is required and the class must not be `personal`), `out_of_scope` (a reason is required; admin and media data).
- The guard spec fails when a schema table or column has no entry, when an entry names something that no longer exists, when a non-`none` column lacks an export or erasure decision, when a `personal` column is kept or has no erasure action, when a `secret_hash` column is exported, and when the registry lists a class `none` column with a personal-looking name (`email`, `phone`, `first_name`, `last_name`, `address`, `recipient`). A new column therefore fails CI until someone classifies it.
- Additional source guards (built in step 2): no seed writes a `personal` or `staff` table; test and e2e data uses only reserved example domains; no package under `packages/features/` or `packages/providers/` declares a database table (so the feature rule below cannot be bypassed unnoticed); the API sets only the cookies of decision 11; the storefront CSP names no origin beyond `'self'`, `data:` and the configured image hosts.
- **Feature rule (public contract once a feature has tables):** a feature that stores personal data in its own tables must add them to the inventory. Until a feature has tables there is nothing to register; the first feature that adds one extends `featureModule` with an optional `personalDataInventory` (the same entry shape, merged by the loader only for enabled features, deleted with the feature folder) in the same change, listed in `docs/contracts/`. Until then the source guard above refuses a feature table.
- The human-readable copy `docs/privacy/data-inventory.md` is written in step 11 from the registry (a spec in that step compares them).

### 4. Pure rules in core (**built in step 3**)
`packages/core/src/privacy/`:
- `decideErasure(facts)`: blockers and the action per order (decision 6).
- The anonymisation plan as data: for each personal or free-text column of `sales_order` what it becomes; the kept set; a helper checking the plan covers every column the inventory marks `anonymise`.
- `buildPersonalDataExport(facts)` and the format `fluxkit.personal-data-export/v1` (decision 7).
- `retentionCutoff(now, days)`, `orderFinalDate`, `isClosedForRetention`.
- Request statuses, kinds, transitions and `requestDueAt(receivedAt)` (30 days, extendable with a reason).
- The audit action list (decision 9) and the code pattern for audit details.
All of it is deterministic: time and randomness are parameters.

### 5. How an erased order contact is stored (plan question 6, schema; **requirement for step 4, red zone**)
- `sales_order` gets `contact_erased_at timestamptz NULL`; `email`, `phone`, `first_name`, `last_name` become nullable with a CHECK "all four NOT NULL unless `contact_erased_at` IS NOT NULL, and all four NULL when it is set"; the existing format CHECKs stay for non-NULL values; a CHECK that an erased order has no guest access.
- Placeholder values in the old columns and a separate contact table are rejected: placeholders leak into UIs, exports and mail handlers unless every reader checks a flag, and a separate table makes every reader join.
- Consequence: `OrderReadPort`, the order views, the mail handlers, shipment create and the api-client see nullable contact fields. That is a breaking type change of a public contract (pre-1.0, `CHANGELOG.md`, a migration note in `docs/migrations/`). The order mail handler and shipment create refuse an erased order with `no_recipient` and `contact_erased`, without a status change.
- The down migration refuses to run while any row has `contact_erased_at` set (it cannot restore erased data; an explicit error, never a silent fill).

### 6. Erasure and anonymisation rules (plan section 3; plan questions 2, 3, 4; **requirement for step 7, red zone: destructive and irreversible**)
- **Orders of a deleted account** are anonymised at once and are never deleted: email, phone, names become NULL; `shipping_address` and `billing_address` shrink to `{countryCode}`; `cancellation_reason` becomes NULL; `access_token_hash` and `access_expires_at` become NULL (the guest link stops working); `request_fingerprint` is replaced by a hash of random bytes (the old unsalted value could confirm a guess of the erased data); `contact_erased_at` is set. Kept: number, status, dates, locale, currency, amounts, lines, adjustments, the shipping snapshot, shipments, payments, refunds and all journals. `payment_reference` is kept (a bank reference for accounting).
- **Blockers** (core `decideErasure`; a blocker refuses everything and changes nothing; an admin cannot override one in v1): an order `awaiting_payment`; an order `paid` and not yet `fulfilled` or `cancelled`; a payment attempt that is live or `create_unknown`, or a refund that is not final; a shipment that is active (`pending`, `created`, `in_transit`, `arrived`, `returning`, `unknown`). The reason codes are `open_order`, `payment_in_progress`, `refund_in_progress`, `active_shipment`.
- **Account deletion** runs in one transaction: lock the customer row first, then the orders in id order, then the mail rows; re-check the blockers under the locks; anonymise; delete the customer's `email_message` rows (by `customer_id` or `to_address`; a row `sending` under a live lease is handled in step 7); delete the customer row (sessions, cart and tokens cascade; `sales_order.customer_id` becomes NULL); record a `privacy_request` and, for an admin, an audit row; clear the session cookie.
- **Guest orders** are erased by the admin by email with the same blockers and steps.
- **What erasure cannot reach**, documented in the runbook: data already at processors, backups (erased order numbers and customer ids are kept in `privacy_request.result`, never contact data, so erasures can be re-applied after a restore), edge proxy logs.

### 7. Export format (plan section 2; **built in step 3 as a pure builder; routes in step 6**)
- Document `{format: "fluxkit.personal-data-export/v1", generatedAt, subject: {kind: "customer" | "email"}, account?, orders[], mail[], sessions[], cart?, processors[]}`, UTF-8 JSON, `Cache-Control: no-store`, `Content-Disposition: attachment`.
- Never exported: password and token hashes, `request_fingerprint`, idempotency keys, provider ids only the shop can use (`provider_ref`, `provider_payment_id`), admin ids, admin free text that names staff. The builder takes already-selected facts and copies only allowed keys; a recursive key scan in its tests fails on any key from the forbidden list.
- The format version string is a public contract: a change of an existing key is a new version (`v2`) next to `v1`.

### 8. Retention (plan question 3; **requirement for step 8**)
- `ORDER_CONTACT_RETENTION_DAYS` is unset by default (job 12 off, one production startup warning "order contact data is kept without a retention period"). No legal period is baked into the template; the owner sets it with an accountant.
- Job 12 `anonymise-orders` anonymises closed orders whose final date (`fulfilled_at`, `cancelled_at`, `expired_at`, or the last refund) is older than the period, in pages of 100 inside the job budget, one short transaction per order, skipping any with a blocker. The same job purges old `privacy_request` (3 years after completion) and `admin_audit_event` rows (1 year). Both periods are proposals for the lawyer.

### 9. Request and audit tables, permission (plan questions 7, 8; **requirement for step 4 and 5, red zones**)
- `privacy_request` (kind `export` or `erasure`, subject kind, customer id without a foreign key, HMAC of the normalised email under a privacy label of `ORDER_TOKEN_SECRET`, channel, status `received`, `in_progress`, `completed`, `rejected`, `due_at` = received + 30 days, a `result` of counts, codes and erased order numbers only, a note of at most 500 characters labelled "no personal data").
- `admin_audit_event` (append-only trigger as ADR 0019): admin id (SET NULL), an action code from the core list (`customer.deactivated`, `customer.activated`, `customer.unlocked`, `admin_user.created`, `admin_user.role_changed`, `admin_user.deactivated`, `admin_user.password_reset`, `privacy.lookup`, `privacy.exported`, `privacy.erased`, `privacy.request_changed`), a target kind and uuid, a `detail` of codes and counts, at most 2 KiB. Never an email, name, phone or address. Reads of customer or order details are not logged in v1 (a recorded gap).
- New permission `privacy.manage`, owner only by default. The audit list needs `users.manage` (owner). Every new admin route needs a permission (default deny) and a route-walk spec.

### 10. API surface (plan section 8; **requirement for steps 5 to 7, public contract**)
Routes: `GET /store/account/data-export`, `POST /store/account/delete`, `POST /admin/privacy/lookup` (a body, never a query string: emails must not reach proxy logs), `GET|POST /admin/privacy/requests`, `GET /admin/privacy/requests/{id}`, `POST .../export`, `.../erase-preview`, `.../erase`, `.../reject`, `GET /admin/audit-events`. New problem rules `erasure_blocked` (with `reasons[]`), `export_too_large`, `request_closed`. Additive only; exact shapes in `docs/api/privacy.md` and OpenAPI when built. Account deletion needs the current password (scrypt outside the transaction, `verifyDummy` timing), the CSRF header and a rate limit; erasure is idempotent per request id and has a preview and a typed confirmation in both UIs.

### 11. Cookies, legal pages and notices (plan questions 9, 10, 11; step 2 guard, step 10 pages)
- The only cookies are first-party HttpOnly and strictly necessary: `fluxkit_cart`, `fluxkit_customer_session`, `fluxkit_admin_session`. There is no consent banner (the lawyer confirms the exemption). A guard fails when the API sets another cookie name or when the storefront or admin source touches `document.cookie`, `cookies()` or a `Set-Cookie`.
- Legal pages (`/{locale}/legal/privacy`, `terms`, `cookies`) are i18n placeholder content with the visible marker `TODO(fluxkit): replace with the shop's own legal text`; the controller identity comes from new variables (`SHOP_LEGAL_NAME`, `SHOP_LEGAL_ADDRESS`, `PRIVACY_CONTACT_EMAIL`); a production storefront build refuses the marker. Registration and checkout show a sentence with links, no checkbox, nothing stored. TODO(fluxkit): legal review of all texts, retention periods and the processor roles before an EU launch (tasks O1 to O8).

### 12. Guards against leaks (**built in step 2**)
- A shared sentinel list (`pii-sentinel-<n>@example.test`, `+380000000123`, `Sentinelfirst`, `Sentinellast`, `Sentinel street 1`) and a world that registers, checks out as guest and as customer, creates a payment and a shipment with the fake providers and reads the order, then scans the captured logs, `domain_event.payload`, every `*_error_code` / `failure_code` / `last_error_code` column and the problem bodies of a request for another subject. Findings of an existing leak are reported, not fixed silently.
- Log, event, job-payload, error-code and audit rules for new code: ids and codes only.

### 13. Security
Re-authentication for deletion; export only for the signed-in customer (a guest link is a bearer link to one order, never to a person's data); lookups by body; default deny; rate limits `dataExport`, `accountDelete`, `privacyExport`; no IP address or user agent is stored by any privacy feature.

## Consequences

- **Cost.** One core folder, one inventory folder with five guards in step 2 and 3; later one migration (`0009_privacy`, three tables changed or added), one job, about ten routes, two admin areas, three storefront pages and a document set.
- **Contracts once built.** The export format, the routes and problem rules, `privacy.manage`, `ORDER_CONTACT_RETENTION_DAYS` and the legal variables, nullable contact fields in `OrderReadPort` and the order views, the feature inventory rule. Pre-1.0, recorded in `CHANGELOG.md`.
- **Retention is off by default**, which is the opposite of storage minimisation until the owner sets a period: the production warning and the runbook say so.
- **Erasure is irreversible.** It is protected by TDD in core, blockers, a preview, a typed confirmation, idempotent requests, mutation checks and an independent review (plan step 13).
- **Admin free text** in append-only journals cannot be erased; the UI warns staff, the inventory classes it as `free_text`.
- **What would supersede this ADR (in part):** a guest self-service flow, a consent log, a different erased-contact representation, a retention period fixed by law for a market, a feature with its own tables.

## Open questions (not decided by the owner's answers)

1. **Which order fields accounting law requires and for how long** (tasks O5): the plan keeps number, lines, totals, dates, shipping and payment records and anonymises the rest; an accountant confirms.
2. **Retention of `privacy_request` (3 years) and `admin_audit_event` (1 year):** proposals for the lawyer.
3. **Mail rows `sending` under a live lease at erasure time:** wait for the lease or refuse with `erasure_blocked mail_sending`; decided in step 7.
4. **Whether any shopper-supplied text reaches `order_status_change.reason` or `sales_order.cancellation_reason`:** step 3 checks the writers (result in the plan's step 3 row).
5. **A wrong password on account deletion** and the lockout counter: decided in step 7.
6. **Processor roles and data locations** (Resend, Nova Post, Monobank, the host): tasks O2, O7.
