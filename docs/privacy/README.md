# Privacy: operator guide

For the shop owner and whoever runs the shop day to day. It says what personal data the template holds, where, how long, and how to answer a person who asks for their data or asks you to erase it. It describes what exists today; the decisions are in `docs/adr/0033-personal-data.md` and `docs/adr/0035-privacy-subject-scope.md`, the plan in `docs/plans/2026-10-29-privacy.md`.

Nothing here is legal advice. TODO(fluxkit): legal review of this guide, the retention periods, the processor roles and every text a customer sees, with a lawyer and an accountant, before an EU launch (plan tasks O1 to O8).

## 1. What the shop holds and where

| Data | Where | Who sees it in the admin |
|---|---|---|
| Account: email, names, phone, sign-in details | PostgreSQL (`customer`, sessions, sign-in and reset tokens) | owner and manager (Customers) |
| Cart | PostgreSQL (`cart`, `cart_item`); the cookie holds a random token only | nobody by name |
| Orders: contact snapshot (email, phone, names), shipping and billing address, lines, totals, payments, refunds, shipments | PostgreSQL (`sales_order` and its tables) | owner and manager (Orders) |
| Mails sent to customers: recipient address and the values filled into the template | PostgreSQL (`email_message`; no body is stored) | owner and manager (Email) |
| Staff accounts: email, role, sign-in details | PostgreSQL (`admin_user`) | owner only (Admin users) |
| Privacy requests and the audit log: ids, codes and counts, never contact data | PostgreSQL (`privacy_request`, `admin_audit_event`) | owner only (Personal data, Audit log) |

The exact list of every column, with its class and what an export and an erasure do with it, is code: `apps/api/src/privacy/inventory/`. A new column fails CI until someone classifies it. Redis and Meilisearch hold no personal data today.

Outside the database: the mail provider, the carrier and the payment provider receive part of the data when you enable them (section 6). Server logs and the edge proxy's access logs are the host's.

## 2. How long it is kept

- **Order contact data** is kept until you set `ORDER_CONTACT_RETENTION_DAYS` (a number of days; `docs/contracts/config.md`). Unset, which is the default, nothing is anonymised automatically and a production API warns at start. Set to a period your accountant gives you, job 12 `anonymise-orders` erases the contact data of closed orders older than that, one order at a time, and never touches an order that still has an open payment, refund or shipment. The order itself (number, lines, totals, dates, payments, shipments) is an accounting record and stays.
- **Privacy requests** are purged 1095 days after completion and **audit events** after 365 days, by the same job, and only when `ORDER_CONTACT_RETENTION_DAYS` is set. These two periods are proposals. TODO(fluxkit): legal review.
- Sessions, carts, tokens and sent mails expire by their own jobs (`docs/api/jobs.md`).

## 3. Answering a request

A request is due 30 days after it is received (the Personal data screen shows the due date and marks an overdue request).

**A customer with an account** uses "Your data" in their account (`/{locale}/account/data`): "Download my data" gives a JSON file at once (limited to a few a day), "Delete my account" deletes the account after the password and a typed word. Nothing needs to be done by you. A deletion that is refused (an open order, payment, refund or shipment) tells the customer what to wait for. The request is recorded without contact data.

**A guest, or anyone who writes to you**, goes through you (owner only, permission `privacy.manage`):

1. Check that the person controls the address, for example by replying to a mail sent from it. Do not copy documents into the system.
2. Admin, **Personal data, Look up by email**: type the address. The address travels in the request body, never in a page address. The lookup shows the account (if any), the guest orders with that address, the stored mails and open requests, and is recorded in the audit log.
3. **Record the request** (export or erasure) and write in the note how you checked the identity (no personal data in the note).
4. Open the request. The request keeps only a hash of the address, so type the address again.
5. **Export**: "Download the personal data" saves `personal-data-<date>.json` (format `fluxkit.personal-data-export/v1`, `docs/contracts/personal-data-export.md`). It holds personal data: send it only to the person, over a channel you trust, and delete your copy.
6. **Erasure** (cannot be undone):
   - "Preview the erasure" shows what would happen and **what is in the way**: an order awaiting payment or paid and not yet fulfilled, a payment or refund still in progress, a shipment still active, a mail being sent right now. Settle those first (finish or cancel the order, wait, or settle the shipment), then preview again. An admin cannot override a blocker.
   - "Erase..." opens a dialog that says what is deleted, what is kept and what cannot be reached, and asks you to type the shown word. Nothing is sent without it.
   - Deleted: the account with its sessions, cart and tokens, and the stored mails to the address. Erased: the contact data of the person's orders (names, email, phone, addresses except the country, the guest link). Kept: order numbers, lines, totals, dates, payments, refunds, shipments and every journal.
7. **Reject** a request you cannot or must not act on (identity not confirmed, a duplicate, not applicable) with a reason; it is recorded.
8. The **Audit log** (owner only) lists lookups, exports, erasures and request changes with who did them. It holds codes and ids only.

What the screens say after an action is only what the server confirmed. If the connection drops during an erasure the screen says so and reads the request again: a request marked completed is done; otherwise preview again before you try again.

## 4. What erasure cannot reach

- **Processors** (section 6): data already sent to them is theirs to delete. Ask them under their terms.
- **Backups.** Erasure changes the live database only. A backup taken before an erasure still holds the data until it ages out under your host's retention. After restoring a backup, erase again every subject erased since the backup was taken: each completed erasure request keeps the erased order numbers and the customer id in its result (never contact data), so the list can be rebuilt from the requests. There is no tool that re-applies them for you yet. TODO(fluxkit): a re-apply tool or script.
- **Proxy and server logs.** The admin's list searches put an email into a URL (`?q=`, `?recipient=`); configure the edge proxy not to log the query string for `/admin` (`README.md`, deployment notes). The privacy screens themselves never put an address in a URL.
- **Database privileges.** The append-only audit log and journals and the "erased contact" rule protect against the application, not against a database user with full rights. Run the API with a database role that does not own the tables and has no `TRUNCATE` right; keep the owner role's password out of the application's `.env` (plan risk R11).

## 5. Cookies and the legal pages

The shop sets only the cookies it needs for the cart and for signing in, all first-party and `HttpOnly`: `fluxkit_cart` and `fluxkit_customer_session` for shoppers (and `fluxkit_admin_session` for staff). The storefront itself sets none, loads no third-party script and has no cookie banner; a guard fails CI if the API sets another cookie or the storefront touches `document.cookie`. The cookie page (`/{locale}/legal/cookies`) lists them from one table in `apps/storefront/src/config/legal.ts`. TODO(fluxkit): legal review of the no-banner reading.

The privacy notice, the terms and the cookie statement are **placeholders** that say the shop must supply its own text (marker `TODO(fluxkit): replace with the shop's own legal text`). To publish: put your texts in the `legal.*` messages (both languages), fill the controller identity and the last-updated day in `apps/storefront/src/config/legal.ts`, and build the storefront with `STOREFRONT_REQUIRE_LEGAL_TEXT=true`, which refuses the build while any `legal.*` message still carries the marker.

## 6. Processors (placeholders)

Fill this in with the owner's lawyer. Every cell marked UNKNOWN is unknown to the template.

| Service | Receives | Entity, role, data location, transfer mechanism, DPA | Status |
|---|---|---|---|
| Mail provider (Resend, when `EMAIL_PROVIDER=resend`) | recipient address and the rendered mail (order contents, tracking number, links) | UNKNOWN | TODO(fluxkit): legal review |
| Carrier (Nova Post, when enabled) | recipient names, phone, pickup point or address, the sender profile | UNKNOWN | TODO(fluxkit): legal review |
| Payment provider (Monobank, when enabled) | amount, currency, payment id, the order number as description, basket lines; card data is entered on the provider's page | UNKNOWN | TODO(fluxkit): legal review |
| Hosting | everything: database, files, logs, backups | UNKNOWN (no host chosen) | TODO(fluxkit): legal review |

The export lists which of these the shop uses, so a person sees who received their data.

## 7. Before an EU launch

Ask a lawyer and an accountant: whether the rules apply to your shop and whether an EU representative is needed (O1); processor roles, terms and data locations (O2, O7); the final privacy notice, terms and cookie text (O3); which identity check you accept for requests by email (O4); which order fields tax and accounting law require you to keep, and for how long, to set `ORDER_CONTACT_RETENTION_DAYS` (O5); whether a record of processing or a notification to an authority is required (O6); your breach contacts and procedure (O8).
