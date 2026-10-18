# 0024. Open-order limit per email and customer, and trusted proxy hops

Status: accepted 2026-10-18 (owner decision in the quiz of `docs/plans/2026-10-18-cart-orders-review-fixes.md`; review findings High 2 and Medium 4). Extends ADR 0015 (checkout lock order) and ADR 0016 (customer rate limits); changes nothing else in them.

## Context

- **Stock hoarding (review Medium 4).** Checkout needs no account and no payment, and an order reserves its stock for the payment TTL (30 minutes) plus a grace. A guest could place order after order for all on-hand units, let them expire and start again. The IP rate limit (10 checkouts per 10 minutes) slows this down but does not bound the stock one shopper holds at once.
- **Rate limits behind a proxy (review High 2).** Every limit keys on `request.ip`. With the storefront calling the API from its Next.js server, or a reverse proxy in front, `request.ip` is the proxy's address, so all shoppers share one window (10 checkouts, 10 registrations, 20 logins per window for the whole shop). Turning on Express `trust proxy` carelessly lets a client pick its own key with `X-Forwarded-For`.

## Decision

### Open-order limit

- `MAX_OPEN_ORDERS`, whole number 1 to 50, default 3. A customer, or a guest email, may hold at most that many orders in `awaiting_payment`. The checkout that would exceed it is refused with `409 too_many_open_orders` (the same status as the other checkout refusals), nothing reserved, the cart untouched.
- **Guest key.** The normalized email (the checkout already lower-cases and trims it; the column has a CHECK for that) among orders whose `customer_id` is NULL. **Customer key.** The customer id. A signed-in customer's orders never count against a guest with the same address and the other way round; a customer checkout counts only that customer's orders.
- **Status.** Only `awaiting_payment` counts: paid, fulfilled, cancelled and expired orders do not. Orders can only leave that status, so a count read without locking them can refuse one checkout too early but never let one through too many.
- **Order of checks.** The replay check comes first: a repeat of an idempotent checkout that already made an order returns that order (200) even at the limit. Then the empty-cart check, then the limit, then the catalog locks and the stock. The limit therefore never turns a harmless double submit into an error.
- **Race safety.** A customer has exactly one cart, and every checkout holds that cart row `FOR UPDATE` before it counts, so a customer's checkouts run one after the other. Guests have one cart per browser, so the cart lock does not order them: a guest takes `pg_advisory_xact_lock(hashtextextended('fluxkit:open-orders:guest-email:' || email, 0))` right after its cart row and holds it to the commit that inserts the order. The count that follows sees every order committed by a checkout that held the lock before. Two parallel checkouts at count `limit - 1` cannot both pass.
- **Lock order** (replaces the one in ADR 0015 for placement; nothing else changes): customer row (`FOR KEY SHARE`, customers only) -> cart row `FOR UPDATE` -> guest email advisory lock (guests only) -> product rows `FOR SHARE` -> variant rows `FOR SHARE` -> inventory level rows `FOR UPDATE` -> inserts. The email lock is taken after the cart and before the catalog, and by no other code, so no cycle can include it: a holder of the email lock only waits for catalog and level locks, which no holder of those locks waits on it for. A hash collision of two different emails only makes them wait for each other.
- **Index.** No migration. The guest count is served by `sales_order_email_idx` (`email` equality), the customer count by `sales_order_customer_id_placed_at_idx` (first key `customer_id`); the status and `customer_id IS NULL` conditions are filters over the few rows of one address or customer. Checked with `EXPLAIN` (index scans).
- **What the refusal says.** The same generic text for a guest and a customer: unpaid orders exist, pay or cancel one or wait until it expires. No order number, count, email or other data. A guest meets it only after presenting that email in their own checkout.

### Trusted proxy hops

- `TRUST_PROXY`, whole number 0 to 10, default 0 (today's behaviour: `request.ip` is the connecting address, `X-Forwarded-For` ignored). `createApp` hands it to Express as `trust proxy` (a hop count: the last `n` addresses of the chain are the trusted proxies, the next one to the left is the client). That one place serves the API process, the specs and the OpenAPI export. Both the store limiter (`RateLimitGuard`) and the admin `LoginThrottle` read `request.ip`, so both follow; IPv6 clients are still grouped per /64.
- A wrong value is not detected by the API: it is an operations setting. The README tells the operator to set the exact hop count and to check it from two networks.

## Consequences

- Accepted gaps, recorded in `docs/HANDOFF.md`:
  - **Per-IP open orders are not counted.** That would need an IP column on `sales_order` (a schema change). One attacker can use many emails; this is bounded by the per-address rate limit on checkout and by the TTL, not by this limit. Three unpaid orders per email still multiplies with the number of emails an attacker makes up.
  - **The limit reveals, to someone who presents an email, whether it already holds `MAX_OPEN_ORDERS` unpaid orders.** Anyone can type any address into a checkout, so a probe can learn "this address has at least N unpaid orders" for N = the limit, nothing else (no numbers, no contents). Accepted by the owner; it needs a full checkout request per probe and the checkout is rate limited per address.
  - **A guest at the limit blocks a customer's guest checkout with the same address and not a signed-in one**, by design of the two keys. A shopper who forgot to sign in may have to wait for their orders to expire (30 minutes by default).
  - **Misconfigured `TRUST_PROXY` degrades every limit.** Too high: a client chooses its address with `X-Forwarded-For` and dodges the IP limits (the email and customer limits still hold). Too low: one shop-wide window per limit. Leaving the API reachable around the proxy while `TRUST_PROXY > 0` has the same effect as too high.
- Config: two optional variables (`docs/contracts/config.md`). Public contract: the new problem code `too_many_open_orders` (`docs/contracts/api.md`, `docs/api/orders.md`, `docs/api/openapi.json`).
- No schema change, no migration, no new dependency. The test app (`startApp`) sets the limit out of reach by default so existing specs may place many orders for one address; `checkout-open-orders.spec.ts` sets it explicitly.
