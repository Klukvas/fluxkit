# API: privacy (personal data export, requests)

Personal data of customers and guest buyers: the self-service export of a signed-in customer and the admin Privacy area (lookup by email, privacy requests, export of a request's subject). Privacy plan step 6, ADR 0033 decisions 1, 7, 9, 10 and 13. Source of truth for routes and schemas: `docs/api/openapi.json`; the export document is the contract `docs/contracts/personal-data-export.md`. No feature flag: privacy is core. Erasure (plan step 7) and the retention job (plan step 8) are not built yet. TODO(fluxkit): legal review of the export content and the request periods before an EU launch (plan tasks O1 to O8).

## Rules

- **Emails never travel in a URL.** The lookup and the request routes take the address in a POST body, so it cannot reach an edge proxy log (plan risk R2).
- **A request never stores the address.** `privacy_request` keeps an HMAC-SHA256 of the normalized email under `ORDER_TOKEN_SECRET` with the label `fluxkit:privacy-subject-email:v1:` (its third use, after the guest order token and the auth tokens). An export of an email subject therefore takes the address again in the body; a different address is `400 validation_failed` with `path: "email"`, `code: "subject_mismatch"`. Rotating `ORDER_TOKEN_SECRET` makes the hashes of open email requests unmatchable: reject and open them again.
- **Who the subject is.** A customer subject is the account and its email; an email subject is the address and, if an account has that address, the account too. The subject's orders are those of the account plus every order whose `email` is the subject's address (guest orders); its mail rows are those of the account plus those sent to the address.
- **The export** is `fluxkit.personal-data-export/v1`, JSON, `Content-Disposition: attachment; filename="personal-data-<YYYY-MM-DD>.json"`, `Cache-Control: no-store`, read in one transaction. The service scans the finished document with core `findForbiddenExportKeys` and fails (500) rather than send a hash, a token or an internal id. Above 10 000 orders the answer is `409 rule_violation` with rule `export_too_large` and nothing changes. Titles of lines, adjustments and the shipping method are in the order's locale (fallback: `DEFAULT_LOCALE`); the cart's titles in `DEFAULT_LOCALE`. In v1 an adjustment without a recorded source shows `source: ""` and a cart line never priced shows `seenUnitAmount: 0`, `seenCurrency: ""` (TODO(fluxkit): format v2 may make them nullable).
- **Requests** are due 30 days after they are received (`dueAt`); `overdue` is true for an open request past its due time. Statuses: `received`, `in_progress`, `completed`, `rejected` (transitions from core). A closed request answers `409 rule_violation` with rule `request_closed`.
- **Audit:** the lookup (`privacy.lookup`, target the account, or the admin who looked when no account has the address), a new request (`privacy.request_changed`) and an export (`privacy.exported`) are recorded in the admin audit log in the same transaction (`docs/api/audit.md`); details are counts and codes only.
- **Rate limits** (in memory, per process): `dataExport` 5 per customer per 24 hours; `privacyExport` 30 per admin user per hour; `429 too_many_requests` with `Retry-After`.

## Store endpoint

| Endpoint | Auth | Purpose | Request | Response | Errors |
|---|---|---|---|---|---|
| `GET /store/account/data-export` | customer | Download the own personal data | none | `200` the export document (`subject.kind` `customer`); also records a completed self-service export request (no contact data) | `401`, `409 rule_violation` (`export_too_large`), `429` |

A guest token never exports: it opens one order, not a person's data. Guests ask the shop, which uses the admin routes below.

## Admin endpoints (all `privacy.manage`, owner only)

| Endpoint | Purpose | Request | Response | Errors |
|---|---|---|---|---|
| `POST /admin/privacy/lookup` | What the shop holds for an email | `{email}` (strict) | `200 {customer \| null, guestOrders: [{id, number, status, placedAt, contactErased}], mailCount, openRequests: [request]}`; `customer` is `{id, email, firstName, lastName, isActive, createdAt, orderCount}`; `guestOrders` are the orders with this email that belong to no account | `400` |
| `GET /admin/privacy/requests` | List requests: open ones first by due date, then closed ones, newest first | `?limit` (1 to 100, default 50), `?offset`, `?status` | `200 {items: [request], total, limit, offset}` | `400` |
| `POST /admin/privacy/requests` | Record a request | `{kind: "export" \| "erasure", subject: {customerId} \| {email}, note?}` (strict; `note` 1 to 500 characters, trimmed: how the identity was checked, no personal data) | `201` request, `Location: /admin/privacy/requests/{id}` | `400`, `404` (unknown customer) |
| `GET /admin/privacy/requests/{id}` | One request | path `id` | `200` request | `400`, `404` |
| `POST /admin/privacy/requests/{id}/export` | Download the personal data of the request's subject | `{email?}` (strict; required for an email subject) | `200` the export document; an `export` request becomes `completed` with `result {orders, mail, sessions}`, an `erasure` request becomes `in_progress` | `400` (missing or different email), `404`, `409 rule_violation` (`request_closed`, `export_too_large`, `subject_not_found`: the account of a customer request no longer exists), `429` |

A request is `{id, kind, subjectKind, subjectCustomerId | null, channel: "self_service" | "admin", status, receivedAt, dueAt, completedAt | null, overdue, result | null, note | null, handledBy | null}`; `result` holds counts, codes and (after an erasure) erased order numbers, never contact data.
