# Record of processing activities: template

A template for the shop operator. The activities are the ones the template's code performs, taken from the data inventory (`docs/privacy/data-inventory.md`, generated from `apps/api/src/privacy/inventory/`) and `docs/privacy/processors.md`. Copy it into the operator's own records and complete it.

Nothing here is a legal conclusion. Whether a record of processing is required for your shop, who the controller is, the legal bases, the retention periods and the recipients are decisions for the operator's lawyer. TODO(fluxkit): legal review of this whole template (plan tasks O1, O3, O5, O6).

The columns "Data", "Systems" and "Retention in the template" state what exists in the code today, not what is lawful.

## Controller (fill in)

| Field | Value |
|---|---|
| Controller name and contact | TODO(fluxkit): legal review |
| Representative (if required) | TODO(fluxkit): legal review |
| Data protection officer or privacy contact (if any) | TODO(fluxkit): legal review |
| Joint controllers | TODO(fluxkit): legal review |

## Activities R1 to R8

Each activity has the legal fields below, all left for counsel: purpose, legal basis, categories of recipients, transfers outside the country, security measures description (the code's own measures are listed in `docs/privacy/README.md` and the ADRs 0033 and 0035). Value for every one of them: `TODO(fluxkit): legal review`.

### R1 Orders and checkout

- Data subjects: shoppers (guests and account holders).
- Data (inventory rows D6 to D12, D14, D15): order contact snapshot (email, phone, names), shipping and billing address, lines, totals, dates, payment references.
- Systems: `sales_order` and its tables; `apps/api/src/orders`, `apps/api/src/cart`, `apps/api/src/payments`.
- Retention in the template: contact data until `ORDER_CONTACT_RETENTION_DAYS` when set (job 12), else kept; the order record itself is kept.
- Recipients and processors: the payment provider and hosting (`processors.md`).
- Export and erasure: the admin Personal data screen (`docs/privacy/README.md` section 3).
- Purpose, legal basis, transfers, security measures: TODO(fluxkit): legal review

### R2 Customer accounts and sign-in

- Data subjects: account holders.
- Data (rows D1 to D5): email, names, phone, password hash, sign-in state, sessions, reset and verification tokens, cart.
- Systems: `customer`, `customer_session`, `customer_auth_token`, `cart`; `apps/api/src/customers`, `apps/api/src/auth`.
- Retention in the template: until the account is deleted; sessions and tokens expire by their jobs (`docs/api/jobs.md`).
- Recipients and processors: hosting (`processors.md`).
- Export and erasure: self-service at `/{locale}/account/data`.
- Purpose, legal basis, transfers, security measures: TODO(fluxkit): legal review

### R3 Shipping and delivery

- Data subjects: shoppers as recipients.
- Data (rows D7, D13, D22): recipient names, phone, delivery address or pickup point, tracking number; the sender profile of the shop.
- Systems: `shipment`, `order_shipping`, `shipping_provider_setting`; `apps/api/src/shipping`, `packages/providers/nova-post`.
- Retention in the template: shipment records are kept; the carrier's own retention is unknown.
- Recipients and processors: the carrier (Nova Post when enabled, `processors.md`).
- Export and erasure: the erasure removes the order contact; data already at the carrier is not reachable.
- Purpose, legal basis, transfers, security measures: TODO(fluxkit): legal review

### R4 Transactional email

- Data subjects: shoppers.
- Data (row D16): recipient address and the values filled into the template (order lines, totals, tracking number); no body is stored.
- Systems: `email_message`; `apps/api/src/email`, `packages/providers/resend`.
- Retention in the template: job 10 removes mails after 30 days (`failed`, `unknown`: 90).
- Recipients and processors: the mail provider (Resend when enabled, `processors.md`).
- Export and erasure: stored mails to the address are deleted by the erasure.
- Purpose, legal basis, transfers, security measures: TODO(fluxkit): legal review

### R5 Online payments

- Data subjects: shoppers.
- Data (row D14): amount, currency, payment attempt id, order number and basket lines sent to the provider; card system and last four digits stored; card data is entered on the provider's page, never in the shop.
- Systems: `payment`, `payment_event`; `apps/api/src/payments`, `packages/providers/monobank`.
- Retention in the template: payment records are kept.
- Recipients and processors: the payment provider (Monobank when enabled, `processors.md`).
- Export and erasure: payment records hold no contact data and are kept.
- Purpose, legal basis, transfers, security measures: TODO(fluxkit): legal review

### R6 Catalog search

- Data subjects: shoppers.
- Data: the search terms travel in the request URL (`GET /store/search`); the API does not log the query text (`docs/api/search.md`) and stores none; the index holds catalog data only.
- Systems: `apps/api/src/search`; Meilisearch (self-hosted).
- Retention in the template: the API keeps no search terms; proxy and server logs are the host's (see R8).
- Recipients and processors: hosting (`processors.md`).
- Export and erasure: nothing in the database to export or erase.
- Purpose, legal basis, transfers, security measures: TODO(fluxkit): legal review

### R7 Staff accounts and administration

- Data subjects: staff (admin users).
- Data (rows D18 to D20): email, role, password hash, sign-in state, sessions; admin ids on journals.
- Systems: `admin_user`, `admin_session`; `apps/api/src/auth`.
- Retention in the template: until the owner deactivates the user (there is no delete route).
- Recipients and processors: hosting.
- Export and erasure: outside the privacy features (the employer handles staff requests).
- Purpose, legal basis, transfers, security measures: TODO(fluxkit): legal review

### R8 Audit log, privacy requests and logs

- Data subjects: staff, requesters, shoppers (indirectly through logs).
- Data (row D25): audit events and privacy requests hold ids, codes and counts, never contact data; container logs and edge proxy access logs hold client IP addresses and URLs.
- Systems: `admin_audit_event`, `privacy_request`; `apps/api/src/privacy`; the edge proxy and container logs (`docs/deployment.md`, Logs).
- Retention in the template: audit events 365 days and requests 1095 days after completion, only when `ORDER_CONTACT_RETENTION_DAYS` is set; logs are the host's.
- Recipients and processors: hosting.
- Export and erasure: not erased on request (an accountability record without contact data).
- Purpose, legal basis, transfers, security measures: TODO(fluxkit): legal review

## Not covered by the code

- Marketing, newsletters, analytics and reviews are not part of the core template. A feature module that stores personal data must add its tables to the inventory.
- The operator's own processes (accounting, support mailbox, telephone): TODO(fluxkit): legal review.
