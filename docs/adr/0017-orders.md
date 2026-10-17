# 0017. Orders

Status: accepted 2026-10-17 (owner decisions of 2026-10-16, the owner quiz of 2026-10-17 and the assumptions of `docs/plans/2026-10-17-cart-and-orders.md`, approved with the plan). Refines ADR 0004 decision 4; builds on ADR 0011 and ADR 0012.

## Context

- ADR 0004 decided: an order is an immutable snapshot made from a cart, items store title, SKU, price and image at purchase time, states are explicit state machines, money is integer minor units.
- ADR 0004 decision 4 derives the order status from separate payment and fulfilment entities. Neither entity exists, and payment providers are a later plan.
- Orders and customers hold personal data (email, phone, names, addresses), so who may read them and how long they live must be decided with the table.

## Decision

### The order and its snapshot
- **Table `sales_order`** (`order` is an SQL keyword); children keep the `order_` prefix: `order_item`, `order_adjustment`, `order_status_change`, `order_item_reservation`. Cart, order items and stock reference `variant_id` (ADR 0004); order items keep `variant_id` and `product_id` as nullable links (`ON DELETE SET NULL`).
- **Immutable item snapshot.** `order_item` stores sku, full i18n maps of the product title, variant title and option names and values (every locale, so history renders in any locale), image URL, unit price, compare-at amount, quantity, line total (`CHECK line_total = unit_amount * quantity`), currency and `requires_shipping`. A trigger in the style of ADR 0012 rejects UPDATE and DELETE, except the `SET NULL` of `product_id` or `variant_id` alone and the cascade delete with the order (the application never deletes orders). `buildOrderLine` in core validates and freezes the snapshot; amounts come from the money module.
- **Order number.** 8 characters of Crockford base32 from 40 random bits, shown as `XXXX-XXXX` (for example `7K3M-9QX2`): no `I`, `L`, `O`, `U`; input is normalized (lower case, `O` to `0`, `I` and `L` to `1`, dash optional); not sequential, so it does not reveal sales volume; unique constraint, and on a violation the placement retries with a new number, at most 5 times, then fails loudly. The number is NOT a secret: reading an order always needs a session or an access token. Generation is pure in core (`formatOrderNumber(bytes)`, the API supplies `crypto.randomBytes`). No shop prefix: that would be client branding.
- **Totals.** `subtotal` = sum of line totals (`multiplyByQuantity`, `addMoney`, exact, no rounding). Shipping, discount and tax are **adjustment lines** (`order_adjustment`: `kind`, `code`, `label`, signed `amount`, `includedInPrice`, `source`; append-only trigger). `total = subtotal + sum(adjustments not included in the price)`; an adjustment that is included in the price is reported in its kind total but not added; a negative total is refused (`negative_total`). The order also stores the cached sums `shipping_total`, `discount_total`, `tax_total` and `total`. v1 never creates an adjustment (the pricing-pipeline plan fills them), so later plans add lines without a migration.

### Statuses
- **One explicit status, until the payment plan.** `awaiting_payment`, `paid`, `fulfilled`, `cancelled`, `expired`. ADR 0004 decision 4 (status derived from payment and fulfilment entities) is refined: v1 keeps a single status because neither entity exists. The payment plan may split it in its own ADR; cash on delivery needs `fulfilled` before `paid`, which a single status cannot express.
- **Transitions are data in core** (`ORDER_TRANSITIONS`, `decideTransition`, `stockEffectOf`) and are recorded in the append-only `order_status_change` journal (from, to, actor type, acting admin, reason):

| From | To | Who | Stock effect |
|---|---|---|---|
| (new) | `awaiting_payment` | checkout (customer or guest) | reservations created (all or nothing) |
| `awaiting_payment` | `paid` | admin by hand, or the system (a payment plugin) | commit every reservation |
| `awaiting_payment` | `cancelled` | the owning customer, the guest with the access token, an admin | release every reservation |
| `awaiting_payment` | `expired` | the system (scheduler), when `expires_at <= now` | release every reservation |
| `paid` | `fulfilled` | admin by hand, or the system (a shipping plugin) | commit any reservation still active (backorder) |
| `paid` | `cancelled` | admin only, with a reason | none automatic |

  `fulfilled`, `cancelled` and `expired` are terminal; every other pair is `invalid_transition`, an actor the row does not list is `not_allowed_for_actor`.
- **Paid-order cancel is admin-only (owner quiz 2026-10-17).** It needs a reason; sold units stay sold (no automatic restock; the admin records an inventory `return` adjustment); the refund happens outside the system until a refunds plan.
- **Backorder lines in a paid order (owner quiz 2026-10-17).** `markPaid` commits what is on hand and `extend`s the remaining reservations by a long hold (365 days); `mark-fulfilled` commits them, refused with `awaiting_stock` until stock arrives. The pure half is `decideExtend` in the inventory decisions: only an `active` reservation, never shortens.
- **Late payment.** `markPaid` on an `expired` or `cancelled` order is refused (`order_not_payable`) and changes nothing; the caller (admin, later a payment plugin) handles the refund. A payment plan must keep its provider session shorter than `ORDER_PAYMENT_TTL_MINUTES`. `markPaid` and the expiry job both lock the order row first, so exactly one wins. Manual payment needs a `reference` and an amount equal to the total (`amount_mismatch`); the same reference on a paid order answers ok, a different one `payment_reference_conflict`.
- **Who can cancel.** The owner of the order (customer session, or guest with the access token) only while `awaiting_payment`; admins as in the table.

### Guest access
- Placement returns an `accessToken` once (32 random bytes, base64url; only its SHA-256 is on the order; valid `ORDER_GUEST_ACCESS_DAYS`, default 90). The storefront puts it in the **URL fragment** (`/orders/7K3M-9QX2#t=...`, never sent to servers or in `Referer`) and calls `POST /store/orders/lookup {number, accessToken}` (a POST, so the token is not in URLs or access logs). An idempotent replay rotates the token (the raw token is never stored). Lookup and guest cancel answer an identical `404` for an unknown number, a wrong or expired token and a customer order; hashes are compared in constant time. A customer's own orders need no token (session, owner check in SQL, `404` not `403` for others'). Guest orders are never attached to an account by email (the email is unverified).

### Personal data and retention
- Orders store email, phone, names and addresses (needed to deliver and for accounting). No IP address, user agent or device data. Logs and domain events never contain PII.
- **Admin access.** `orders.read`, `orders.write`, `customers.read`, `customers.write`: `owner` all, `manager` all four, `viewer` none (PII).
- **Retention.** No automatic deletion of orders or customers in v1 (accounting needs orders; the period is a legal decision). Deactivation only; deleting a customer sets `sales_order.customer_id` to null and the snapshot keeps the contact data. A privacy plan (anonymization after the legal period, account erasure, export) comes before the EU launch.

## Alternatives rejected

- **Derived payment and fulfilment statuses now (ADR 0004 as written), or `payment_status` and `fulfillment_status` columns now.** Neither entity exists; the payment plan decides the split with real providers.
- **Sequential order numbers.** They reveal sales volume and invite enumeration. **A shop prefix** is client branding.
- **Editing order items, or storing prices only by reference.** History must survive catalog changes; the snapshot is immutable by trigger, not by convention.
- **Automatic restock on cancelling a paid order, or no cancel after payment.** The owner chose admin-only cancel with an explicit reason and a manual restock.
- **Accepting a late payment and re-reserving.** It could leave a paid order without stock. Refuse and refund.
- **Refusing backorder variants at checkout, or committing every line only at fulfilment.** The owner chose to commit what is on hand at payment and hold the rest.
- **Giving `viewer` `orders.read`, or a new `support` role.** Roles stay fixed in code (ADR 0009); personal data stays away from the read-only role.
- **Anonymizing guest orders after N years now.** The legal period is not known.

## Consequences

- Orders can be created only through checkout and changed only through the status machine; there is no order editing after placement.
- A paid order that is cancelled needs a manual restock and a manual refund until the refunds plan.
- Tax is not calculated; `taxTotal` is 0 and the docs warn when `PRICES_INCLUDE_TAX=false`.
- The index `(status, expires_at)` serves the expiry job; the admin list uses `(placed_at desc)` and `(email)`.
