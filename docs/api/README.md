# API endpoints

One file per module. Format, one line per endpoint:

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `GET /health` | public | Liveness plus Postgres reachability | none | `200 {"status":"ok"}` | 503 | - |

Index: `health.md`, `auth.md` (admin sign-in, logout, me, change-password and the users routes), `catalog.md` (all `/admin/*` and `/store/*` catalog routes, conventions and error codes), `cart.md` (the shopper's cart), `customers.md` (customer accounts), `orders.md` (checkout, guest and customer orders, the order domain service), `jobs.md` (the scheduler, its jobs, `pnpm jobs:run-once`, event delivery; no HTTP route), `pricing.md` (admin price endpoints, money rules, effect on publishing, `GET /store/config` and `GET /admin/config`), `shipping.md` (admin shipping settings: methods, provider profiles, connection check), `email.md` (admin email: status, test send, outbox list and detail, resend, cancel, template list and preview), `media.md` (image upload `POST /admin/media/uploads`, the public `GET /media/{key}`, attach marking), `payments.md` (online payments: the store create and status routes, the admin payment routes (refunds, resync, attention list), the webhook route `POST /webhooks/payments/{provider}` and the payment service), `privacy.md` (the personal data export of a customer, the admin lookup by email, privacy requests and their export), `audit.md` (the admin audit log `GET /admin/audit-events` and which admin writes record an event), `features-example.md` (feature `example`), `openapi.json` (generated, core routes only; `pnpm openapi:export`).
Keep it short. Update in the same change as the endpoint (CI checks that controller changes come with docs).
