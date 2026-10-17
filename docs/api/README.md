# API endpoints

One file per module. Format, one line per endpoint:

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `GET /health` | public | Liveness plus Postgres reachability | none | `200 {"status":"ok"}` | 503 | - |

Index: `health.md`, `auth.md` (admin sign-in, logout, me, change-password and the users routes), `catalog.md` (all `/admin/*` and `/store/*` catalog routes, conventions and error codes), `cart.md` (the shopper's cart), `customers.md` (customer accounts), `orders.md` (checkout, guest and customer orders, the order domain service), `pricing.md` (admin price endpoints, money rules, effect on publishing), `features-example.md` (feature `example`), `openapi.json` (generated, core routes only; `pnpm openapi:export`).
Keep it short. Update in the same change as the endpoint (CI checks that controller changes come with docs).
