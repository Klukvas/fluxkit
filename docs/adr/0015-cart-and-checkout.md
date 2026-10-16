# 0015. Cart and checkout

Status: accepted 2026-10-17 (owner decisions of 2026-10-16 and the owner quiz of 2026-10-17; the assumptions of `docs/plans/2026-10-17-cart-and-orders.md`, approved with the plan). Refines the cart and checkout parts of ADR 0004; builds on ADR 0011 (money, stock, reservations).

## Context

- ADR 0004 says a cart becomes an immutable order and that cart, order items and stock reference `variant_id`. It leaves open how a cart is identified, what it holds, how long, and how checkout turns it into reserved stock without overselling.
- The money module (ADR 0011) and `ReservationsService` exist; nothing yet creates a cart or an order. Guests and signed-in customers both order (owner decision), and the storefront is not built, so the API contract must be safe by itself: never trust a client price, total or stock.
- The shop is sold as a template: no payment, shipping, discount or tax provider exists yet, so checkout leaves hooks (ADR 0017, ADR 0018) and no provider code.

## Decision

### The cart
- **A cart holds no stock.** Adding a line reserves nothing. The cart shows the CURRENT catalog price and availability, recomputed on every read, and never a quantity.
- **Notices, not silent changes.** Each line stores the unit price the shopper last saw (`seen_unit_amount`, `seen_currency`), set when the line is added or its quantity changes and by `POST /store/cart/acknowledge`. A read compares it with the current price: `price_changed {previousAmount}`; a variant that is no longer sellable (shared rule `isVariantSellable`) or has no price in the shop currency is `unavailable` (line kept, left out of the subtotal); `out_of_stock` comes from the availability status. A line priced in another currency (after a `SHOP_CURRENCY` change) shows `price_changed`. The cart is `purchasable` when it has a line and no `unavailable` line.
- **Pricing is core.** `priceCart` computes unit price, line total (`multiplyByQuantity`) and subtotal (`addMoney`); overflow is a typed refusal (`line_total_out_of_range`, `subtotal_out_of_range`), never a clamp.
- **Limits** (core constants, not contract): `MAX_CART_LINES` = 100 lines, `MAX_LINE_QUANTITY` = 999 per line, one line per variant. Adding to an existing line past 999 is refused (`quantity_limit`) and a 101st line is `too_many_lines`: the shopper typed the number, so it is never silently capped. A variant that is not sellable cannot be added (`variant_not_sellable`).
- **Token and cookie.** A guest cart is created lazily by the first write (a read never creates a row). Token: 32 random bytes (base64url); only its SHA-256 is stored (`cart.token_hash`), as for admin sessions. Cookie `fluxkit_cart`: `HttpOnly`, `SameSite=Lax`, `Path=/store`, `Secure` unless `STORE_COOKIE_SECURE=false`, `Max-Age` = `CART_TTL_DAYS` (default 30). `Lax` keeps the cart when a shopper arrives from a link on another site; `Strict` would show an empty cart on that first navigation. There is no cart id in any URL, so there is nothing to guess.
- **Signed-in customers** have one cart bound to the account (`cart.customer_id`, unique); the cart cookie is ignored while a customer session is present.
- **TTL.** A cart expires `CART_TTL_DAYS` after its last write (customer carts too). The scheduler deletes expired carts (ADR 0018); no stock is held, so nothing to release.
- **Merge at login or registration** (ADR 0016): guest lines are added to the customer's cart in one transaction (both carts locked in id order). Quantities add up and are capped at 999 with a `quantity_capped` notice (here capping is right: the shopper did not type the sum); guest-only lines beyond 100 are dropped with `lines_dropped`; the guest cart is deleted. `seen` keeps the older customer price, or takes the guest one when the customer had none, so a change still shows.

### Checkout
- **One transaction, all or nothing.** `POST /store/checkout` locks the cart row `FOR UPDATE`, then the product rows `FOR SHARE` (by id), the variant rows `FOR SHARE` (by id), the `inventory_level` rows `FOR UPDATE` (by variant id), then inserts. Order transitions lock `sales_order` `FOR UPDATE`, then levels, then reservations. Admin writes keep product -> level and product -> variant; reservations keep variant -> level. There is no cycle. A deadlock that still happens (Postgres `40P01`) is retried once, then answers 503 with a log.
- **Re-validation.** The locks make an unpublish, a price write or a variant switch-off either finish before checkout reads (and be seen) or wait until the order is committed. Once placed, the snapshot is the contract: `markPaid` does not re-check sellability or price. This closes the race left open in `docs/api/inventory.md`.
- **Reservation.** Lines are evaluated against the locked levels first and reserved only when all pass; the response lists every refused line (`409 checkout_refused`, `errors[]` with `path: lines.N` and `code`: `insufficient_stock`, `variant_not_sellable`, `reserved_out_of_range`, `line_total_out_of_range`). Untracked variants (`not_tracked`) get no reservation and always pass. v1 reserves at the default location only, one reservation per order line (the link table allows several per line later).
- **TTL.** `expires_at` of the order = placement + `ORDER_PAYMENT_TTL_MINUTES` (default 30, 5 to 1440). Its reservations expire at the order expiry + a fixed 10 minutes, so the order job always expires the order and releases its reservations before the generic reservation sweep could touch them (ADR 0017, ADR 0018).
- **Price drift: consent, not input.** The request carries `expectedTotal {amount, currency}`. The server recomputes everything and never uses it as a price; if it differs, or any line is `unavailable`, checkout answers `409 cart_changed` with the fresh cart and reserves nothing.
- **Idempotency.** `Idempotency-Key` (a UUID per checkout attempt) is required and stored on the order (unique) with a SHA-256 fingerprint of the normalized request plus the cart id. Same key and fingerprint: the same order (`200` instead of `201`); same key, different fingerprint: `409 idempotency_key_reused`. The cart row lock serializes two keys for one cart; the second sees an empty cart (`409 cart_empty`). Keys live as long as the order.
- **Required input** (core rules in `orders/contact.ts`): `email`, `phone`, `firstName`, `lastName`; a shipping address when any line's product type requires shipping. No country-specific rule lives in core.
- **Same-site storefront, no CORS.** The storefront calls the API same-site (Next.js server-side calls or a reverse-proxy path); the API keeps sending no CORS headers (owner quiz 2026-10-17). Store writes need the CSRF header of ADR 0016.
- **Tax.** No tax is calculated. With `PRICES_INCLUDE_TAX=false` checkout still works, `taxTotal` is 0 and the docs warn that tax is not charged until a tax plan exists.

## Alternatives rejected

- **Reserve stock when a line is added.** Abandoned carts would hold stock for days and the cart would need the reservation machinery; the owner chose to reserve at order placement only.
- **Trust a client total, or price from the cart row.** A client can send any number, and a stored price goes stale; prices are recomputed on the server and the client total is only a consent check.
- **Reserve line by line, or place a partial order.** Separate transactions can oversell and strand reservations; a partial order surprises the shopper. All or nothing, with every refusal reported, is predictable.
- **`SameSite=Strict` for the cart cookie.** An empty cart on the first navigation from another site; writes are protected by the CSRF header anyway.
- **CORS with an allow-list of storefront origins, or a separate API host with bearer tokens.** More surface and credentials in the browser for no gain while the storefront is same-site; both can be added later by a plan of their own.
- **Capping a typed quantity.** Silent changes of what the shopper asked for; only the merge caps.
- **Cart id in the URL or a client-side cart.** Guessable ids and client-side prices.

## Consequences

- A shop that adds stock locations by SQL sees `in_stock` but gets `insufficient_stock` at checkout until multi-location allocation is planned (locations are read-only in the API today).
- Crossing carts, parallel checkouts of the last unit and checkout against admin writes are covered by concurrency tests (plan step 5).
- The 999 cap and the rate limits bound stock probing by repeated checkouts; this is accepted and documented.
- Cart and checkout are core: no feature flag. A client who wants guests only or accounts only gets a config flag later by its own plan.
