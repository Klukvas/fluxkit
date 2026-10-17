# API: checkout and orders

Placing an order (`POST /store/checkout`), the guest's own order (`/store/orders/*`), the signed-in customer's orders (`/store/account/orders*`) and the order domain service behind them (status transitions, payment, cancellation, expiry). Plan step 5b of `docs/plans/2026-10-17-cart-and-orders.md`; decisions in `docs/adr/0015-cart-and-checkout.md`, `0017-orders.md`, `0018-scheduler-domain-events-and-ports.md`, `0019-orders-schema.md`, `0020-variants-with-order-lines-are-not-deleted.md`. Source of truth for routes and schemas: `docs/api/openapi.json`. No feature flag: orders are core. **Not built yet:** the admin order routes (step 6), the scheduler that expires orders by itself (step 5c, `OrdersService.expireOne` is ready for it), the events contract file and dispatcher (steps 5c and 7), payment and shipping providers.

Every route sends `Cache-Control: no-store` (errors included). Every `POST` needs `X-Fluxkit-CSRF: 1` and a JSON content type (otherwise `403 forbidden`, before anything else). Money is `{amount, currency}` in minor units of the shop currency (ADR 0011). Texts of an order are resolved to `?locale` (one of `LOCALES`, else `400`), by default the locale the order was placed in (or the default locale if that one is no longer configured), with the usual per-field fallback; the stored snapshot keeps every locale.

## Endpoints

| Endpoint | Auth | Purpose | Request | Response | Errors |
|---|---|---|---|---|---|
| `POST /store/checkout` | public (a signed-in customer's cart follows the session, everyone else's the `fluxkit_cart` cookie) | Place the order of the cart | header `Idempotency-Key` (a UUID per attempt); body below | `201 {order, accessToken?}`; `200` for a replay of the same checkout (below). `accessToken` only for guests | `400 validation_failed` (fields, `idempotency_key_required`, `invalid_idempotency_key`, `shipping_address_required`), `409` `cart_empty`, `cart_changed` (`cart` in the body), `checkout_refused` (`errors[]`), `idempotency_key_reused`, `rule_violation` `subtotal_out_of_range`, `429` (limit `checkout`), `503` (below) |
| `POST /store/orders/lookup` | guest token | Read one guest order | `?locale`; body `{number, accessToken}` (strict) | `200` order | `400`, `404` for any mismatch (below), `429` (limit `orderLookup`) |
| `POST /store/orders/cancel` | guest token | Cancel an unpaid guest order | `?locale`; body `{number, accessToken}` | `200` order (status `cancelled`) | `400`, `404` as the lookup, `409 rule_violation` `invalid_transition` (not `awaiting_payment`), `429` (limit `guestCancel`) |
| `GET /store/account/orders` | customer | Own orders, newest first | `?limit` (1 to 100, default 24), `?offset`, `?locale` | `200 {items: [summary], total, limit, offset}` | `400`, `401` |
| `GET /store/account/orders/{number}` | customer | One own order | path `number` | `200` order | `400`, `401`, `404` (not found OR not own: identical) |
| `POST /store/account/orders/{number}/cancel` | customer | Cancel an own unpaid order | none | `200` order | `400`, `401`, `404` as above, `409 rule_violation` `invalid_transition` |

The number is accepted the way a person types it (`7k3m9qx2`, `7K3M-9QX2`, letters `O`, `I`, `L` read as `0`, `1`, `1`); a malformed number is the same `404` as an unknown one. Customer routes read the customer only from the session (`@CustomerAuthenticated()`), never from the request, and the owner filter is in SQL.

## Checkout

Body (strict; an unknown field is `400 unknown_field`; there is no field for a cart, a customer, a price or a total):

```
{ email?, phone, firstName, lastName, shippingAddress?, billingAddress?, locale?,
  expectedTotal: {amount, currency} }
```

- `email`: required for a guest, normalized like admin emails; a signed-in customer may omit it (the account email is used). Never verified. `phone`: optional leading `+`, 7 to 15 digits (spaces, dashes, dots and parentheses allowed), stored as `+digits` or `digits`. `firstName`, `lastName`: 1 to 100 characters. Addresses: `{countryCode (two upper-case letters), region?, city, postalCode?, line1, line2?, recipientFirstName?, recipientLastName?, recipientPhone?}`, `null` means not sent. All content rules are the core rules (`packages/core/src/orders/contact.ts`); every error is reported at once with its path (`shippingAddress.city`, `expectedTotal.amount`, ...).
- `shippingAddress` is required when any line's product type ships physical goods (`product_type.requires_shipping`); an order of digital goods only needs none (it is stored when sent). Checked after the cart is priced, so a changed cart (`cart_changed`) is answered first.
- `locale`: one of the configured locales, stored on the order; default `DEFAULT_LOCALE`.
- `expectedTotal`: the total the shopper saw. A **consent check, never a price**: the server prices the cart itself with core (`priceCart`, `buildOrderLine`, `computeOrderTotals`). A different total, or a line that is unavailable (product unpublished, variant off or without a shop price, or deleted meanwhile), answers `409 cart_changed` with `cart`, the cart exactly as `GET /store/cart` shows it now, and nothing is reserved.

One transaction, all or nothing, lock order **customer row (customers only, `FOR KEY SHARE`) -> cart row `FOR UPDATE` -> product rows `FOR SHARE` -> variant rows `FOR SHARE` -> inventory level rows `FOR UPDATE`** (each pass sorted by id), then the inserts:

1. The cart is found by the session or the cookie and locked; two checkouts of one cart (two tabs, two devices) serialize, and the second sees an empty cart (`409 cart_empty`).
2. The product and variant locks are taken BEFORE the catalog facts are read, so an unpublish, a price write, a variant switch-off or a variant delete either finished before the checkout reads (and is seen) or waits until the order is committed.
3. The cart is priced with the same pass the cart view uses (`CartPricingService.price`), the order lines are built from exactly those facts (full translated texts of the product, variant and option values, SKU, image URL, unit price, compare-at, quantity, line total, `requires_shipping`), and the totals come from `computeOrderTotals`. A line total or subtotal that does not fit is refused, never clamped: `409 checkout_refused` with `lines.N` `line_total_out_of_range`, or `409 rule_violation` `subtotal_out_of_range` (as the cart does).
4. The order row is inserted with a random number `XXXX-XXXX` (a collision of the 40-bit number retries with a new one, at most 5 times, then the request fails loudly with `500`), then the stock is reserved at the default location, one reservation per tracked line, `reference` = the order number, expiring 10 minutes after the order (`ORDER_PAYMENT_TTL_MINUTES`, default 30, plus the fixed grace). Every line is evaluated against the locked levels first; if any is refused nothing is written and `409 checkout_refused` lists EVERY refused line as `errors[] = {path: "lines.<position in the cart>", code}` with `insufficient_stock`, `variant_not_sellable`, `reserved_out_of_range` or `line_total_out_of_range`. The body never carries a stock quantity. (`variant_not_sellable` here is a safety net: a line that is not for sale is answered as `cart_changed` before any reservation.) Untracked variants are not reserved and always pass.
5. The lines, the links to their reservations (`order_item_reservation`), the status journal row `(null -> awaiting_payment, actor customer or guest)` and the outbox row `order.placed` (payload `{orderId, orderNumber, status}`, never personal data) are written.
6. **The cart is emptied in the same transaction: its lines are deleted, the cart row and the cookie stay** (the shopper keeps shopping; a replay of the same key still finds the cart it was made from). A refused or failed checkout leaves the cart as it was.

A deadlock (`40P01`) is retried once by re-running the transaction; a second one answers `503 service_unavailable` with `Retry-After` and is logged by SQLSTATE only. The lock orders are designed so that it does not happen (the concurrency tests assert that no retry was needed).

### Idempotency

`Idempotency-Key` is required (a UUID, stored lower-case on the order, unique) and kept as long as the order. The order stores a SHA-256 **fingerprint** of the normalized request (email, phone, names, addresses, locale, `expectedTotal`) plus the id of the cart it was made from. Compared in constant time.

- Same key, same fingerprint, same principal and the cart still reachable: `200` with the same order (its current status). A guest gets a **NEW access token** (the raw token is never stored) and the old one stops working; the new one is valid `ORDER_GUEST_ACCESS_DAYS` from now. A replay changes nothing else: no new reservation, journal row or event, and the cart is not touched.
- Anything else with that key (another body, another cart, a lost cart cookie, a customer using a guest's key or the other way round) is the same `409 idempotency_key_reused`, which never says which part differed and never returns an order or a token. The cart id in the fingerprint is on purpose: only whoever can still reach the cart can obtain a fresh token.
- Parallel requests with the same key and the same body make ONE order (one `201`, the rest `200`); the same key from two different carts makes one order and the other gets `idempotency_key_reused` after its transaction was rolled back (nothing left behind); two different keys for one cart make one order and `cart_empty`.

### Guest access (ADR 0017)

`accessToken` is 32 random bytes (base64url); only its SHA-256 is stored (`access_token_hash`) with `access_expires_at` (`ORDER_GUEST_ACCESS_DAYS`, default 90). The storefront keeps it in the confirmation link's URL **fragment**. The token opens exactly one order, to read it and to cancel it while it is `awaiting_payment`; it never changes contact data. The lookup and the guest cancel answer one identical `404` for an unknown or malformed number, a wrong, empty or expired token, the token of another order, and an order of a customer; the hash comparison runs for a missing order too and is constant time (`crypto.timingSafeEqual` on the hashes). The expiry instant itself is already expired. The token and its hash never appear in a later response, in a log or in an event. A customer's own orders have no token (session and owner filter).

## The order

```
{ number, status, placedAt, expiresAt, currency,
  items: [{sku, productTitle, variantTitle | null, optionValues: [{option, value}], imageUrl | null,
           unitPrice, compareAtAmount | null, quantity, lineTotal}],
  subtotal, shippingTotal, discountTotal, taxTotal, total,
  adjustments: [{kind, code, label, amount, includedInPrice}],
  contact: {email, phone, firstName, lastName}, shippingAddress | null, billingAddress | null,
  history: [{status, at}] }
```

`summary` (list) is `{number, status, placedAt, expiresAt, total, itemCount}` (`itemCount` = units over all lines). No adjustments exist yet, so `shippingTotal`, `discountTotal` and `taxTotal` are 0 and `total` equals `subtotal`; with `PRICES_INCLUDE_TAX=false` no tax is added either (docs warn: tax is not charged until a tax plan exists). Never in a response: ids of orders, items, products, variants, customers or reservations, reservation or stock information, the acting admin, token hashes, the idempotency key, the fingerprint. The reads issue a fixed number of statements whatever the number of lines or orders (tested).

## Statuses and transitions (ADR 0017)

`awaiting_payment`, `paid`, `fulfilled`, `cancelled`, `expired`; `fulfilled`, `cancelled` and `expired` are terminal. The core table is the only authority (`decideTransition`); every change is a row of the append-only journal `order_status_change` and an outbox row (`order.paid`, `order.cancelled`, `order.expired`, `order.fulfilled`; no personal data).

| From | To | Who | Stock effect |
|---|---|---|---|
| (new) | `awaiting_payment` | checkout | reservations created |
| `awaiting_payment` | `paid` | admin or system (`markPaid`) | commit every reservation that is on hand; backordered ones are held 365 days |
| `awaiting_payment` | `cancelled` | the owner (customer, or guest with the token), admin | release every reservation |
| `awaiting_payment` | `expired` | system (`expireOne`) | release every reservation |
| `paid` | `fulfilled` | admin or system | commit the reservations still active; `awaiting_stock` while one is not on hand |
| `paid` | `cancelled` | admin only, with a reason | none (sold units stay sold; restock is an inventory `return`) |

## Order domain service (internal, no route yet)

`OrdersService` (`apps/api/src/orders/orders.service.ts`, exported globally; implements the core `OrderPaymentsPort`, injectable as `ORDER_PAYMENTS_PORT`). Each method opens one transaction, locks the order row `FOR UPDATE` FIRST, asks the state machine, applies the stock effect through the sorted batch helpers of `ReservationsService` (`docs/api/inventory.md`) inside a savepoint, writes the order, the journal row and the event, and retries a deadlock once.

| Method | Purpose and rules |
|---|---|
| `markPaid(orderId, {amount, providerReference, source}, actor?)` | The idempotent payment entry point. `order_not_found`; an `expired` or `cancelled` order is `order_not_payable` and nothing changes; on a `paid` or `fulfilled` order a different reference is `payment_reference_conflict`, the same reference is ok with `alreadyPaid: true` (and still checks the amount); the amount must equal the total in the order currency (`amount_mismatch`); a reservation that is no longer active (swept) is `order_not_payable`. The clock is not consulted: an order past its expiry that the job has not expired yet can still be paid. The reference is 1 to 255 characters (a caller bug throws `RangeError`) |
| `markFulfilled(orderId, actor)` | `paid -> fulfilled`; `awaiting_stock` (nothing changes) while a held backordered line is not on hand; `invalid_transition` otherwise |
| `cancelAsGuest(number, token)`, `cancelAsCustomer(customerId, number)` | Owner cancels; `not_found` as in the routes, `invalid_transition` unless `awaiting_payment` |
| `cancelAsAdmin(orderId, adminId, reason)` | `awaiting_payment` or `paid`; reason 1 to 500 characters stored on the order and in the journal; sold units are not restocked |
| `expireOne(orderId, now)` | Expires the order when it is `awaiting_payment` and `expires_at <= now` (`expired`, `not_due`, `not_found`); the loop and the schedule are step 5c |

Races on one order have one winner: a payment, a cancellation and the expiry all lock the order row first (tested: payment against cancel, payment against expiry, parallel payments, crossing orders).

## Problem codes of this step (additive)

`409` `cart_empty`, `cart_changed` (`cart` member), `checkout_refused` (`errors[]` per line), `idempotency_key_reused`; `503` `service_unavailable`; `rule_violation` rules `invalid_transition` (owner cancel), `subtotal_out_of_range`. The admin routes will add `order_not_payable`, `amount_mismatch`, `payment_reference_conflict` and `awaiting_stock` (step 6).

## Limits and notes

- Stock location: the default location only, one reservation per line (ADR 0015). A shop with more locations sees `in_stock` but `insufficient_stock` at checkout until multi-location allocation is planned.
- The number of statements of a checkout grows with the number of lines (a lock, an update and an insert per tracked line inside `reserveMany`); the reads do not.
- Stock probing by repeated checkouts is bounded by the rate limits (`checkout` 10 per 10 minutes per address, single process) and the 999 cap.
- The order contact data is personal data. Logs, events and problem bodies carry none of it (tested by capturing the log output of a refused, a placed and an invalid checkout).
