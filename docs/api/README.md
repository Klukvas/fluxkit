# API endpoints

One file per module (`catalog.md`, `cart.md`, `checkout.md`, `orders.md`, `customers.md`, `admin-*.md`, `features-<name>.md`).

Format, one line per endpoint:

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `GET /store/products` | public | List products (grouped from variants) | query: filters, sort, page | `{ items, facets, total }` | 400 | - |

Keep it short. Update in the same change as the endpoint.
