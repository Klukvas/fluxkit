# 0019. Orders schema: foreign key actions, immutability triggers and known gaps

Status: accepted 2026-10-17 (decisions of the schema step of `docs/plans/2026-10-17-cart-and-orders.md`; migration `0004_cart_customers_orders` was approved with the plan). Implements the data part of ADR 0015 to 0018. Follows the technique of ADR 0012.

## Context

- The plan fixes ten tables: `customer`, `customer_session`, `cart`, `cart_item`, `sales_order`, `order_item`, `order_adjustment`, `order_status_change`, `order_item_reservation`, `domain_event`.
- Three of them must not change after they are written: the purchase snapshot (`order_item`), the adjustment lines and the status journal. All three have foreign keys whose actions are UPDATE or DELETE statements on them (`SET NULL` of a catalog link or of an admin actor, `CASCADE` from the order), so a plain "reject every UPDATE and DELETE" trigger would make catalog and admin deletes impossible. ADR 0012 solved the same problem with `pg_trigger_depth()`.

## Decision

### Triggers (hand-written tail of `0004_cart_customers_orders.sql`)
`pg_trigger_depth()` is 1 for a statement sent by a client and greater than 1 inside a referential action. Everything not listed is rejected with SQLSTATE `23001` (`restrict_violation`).

| Table | Allowed at depth above 1 | Why |
|---|---|---|
| `order_item` | DELETE; UPDATE that sets `product_id` and/or `variant_id` from a value to NULL and changes no other column | cascade from `sales_order`; `SET NULL` when the product or variant is deleted |
| `order_adjustment` | DELETE | cascade from `sales_order` (no other foreign key acts on it) |
| `order_status_change` | DELETE; UPDATE that sets `actor_admin_id` from a value to NULL and changes no other column | cascade from `sales_order`; `SET NULL` when the admin user is deleted (as `stock_movement.actor_id`) |

"No other column changes" is `to_jsonb(NEW) - 'col' = to_jsonb(OLD) - 'col'`. A link can only go from a value to NULL: it can never be pointed at a row again. Tests use the helper-trigger technique of ADR 0012 to run each case at depth 2 and prove that every rejection and every exception behaves as listed; removing any clause fails a test.

### What happens when a row elsewhere is deleted
| Deleted | Effect |
|---|---|
| a `customer` | its `customer_session` and its `cart` (with lines) are deleted; `sales_order.customer_id` becomes NULL (`SET NULL`). The order keeps email, phone, names and addresses (the snapshot is the contact record) |
| an `admin_user` | `order_status_change.actor_admin_id` becomes NULL (allowed by the trigger); the journal row stays |
| a `product` or `variant` that has no reservation held by an order line | `order_item.product_id` / `variant_id` become NULL (allowed by the trigger), the line is otherwise unchanged; `cart_item` rows of the variant are deleted |
| a `variant`, `product` or `reservation` whose reservation an order line holds | refused: `order_item_reservation.reservation_id` is `ON DELETE RESTRICT`, and the delete of a variant cascades to its reservations (SQLSTATE `23503`) |
| a `location` that a reservation uses | refused (`reservation.location_id` is RESTRICT, ADR 0012) |
| a `sales_order` | its lines, adjustments, status changes and reservation links are deleted through the allowed cascade path; the reservations themselves stay (the application never deletes orders, see gaps) |

### An order of a customer never has an access token
- `sales_order_customer_or_token_check`: `customer_id IS NULL OR access_token_hash IS NULL`. A guest order cannot be attached to an account later by an UPDATE (plan: guest orders are never attached by email), and an order of a customer cannot get a token.
- `sales_order_access_pair_check`: the token hash and its expiry exist together or not at all.
- Deleting the customer is an UPDATE of `sales_order` (`customer_id` to NULL). `sales_order` is not immutable (its status changes), and no trigger is needed: the order had no token and keeps none, so it is unreachable for guests and visible to admins only.

### Choices that go beyond the plan's column list (each is additive)
- `order_item_order_id_position_key`: one line per position of an order. The snapshot cannot be corrected after the insert, so a duplicate position must be impossible at insert time.
- `order_item_reservation_reservation_id_key`: a reservation belongs to at most one order line (the plan says so in prose); the same index serves the RESTRICT check.
- `sales_order_access_pair_check`, `sales_order_customer_or_token_check` (above), `sales_order_expires_at_check` (`expires_at > placed_at`), hex-pattern checks on every stored SHA-256 (`token_hash`, `access_token_hash`, `request_fingerprint`), `jsonb_typeof` checks (addresses and title maps are objects, option values an array, domain event payload an object).
- `domain_event.aggregate_id` has no foreign key: the outbox must not depend on the aggregate rows (a customer can be deleted). `last_error_code` is limited to a short code pattern so that an error message (which may carry personal data) cannot be stored there.
- `order_status_change.created_at` defaults to `clock_timestamp()` (plan), not `now()`: several changes in one transaction keep their order.
- Money limits mirror core: `0..MAX_AMOUNT` for amounts, discount `-MAX_AMOUNT..0`, adjustment amounts `±MAX_AMOUNT`, quantity `1..999`, `line_total = unit_amount * quantity` and `line_total <= MAX_AMOUNT` (999 x `MAX_AMOUNT` is refused by the second check, as `line_total_out_of_range` in core). Text limits mirror `CONTACT_LIMITS`, `TEXT_LIMITS` and `EMAIL_MAX_LENGTH`; the status and actor lists are compared with `ORDER_STATUSES` and `ORDER_ACTORS` in the spec, the order number alphabet with `ORDER_NUMBER_ALPHABET`.

## Known gaps (documented, not fixed here)

- **Same as ADR 0012:** `TRUNCATE`, `ALTER TABLE ... DISABLE TRIGGER` and a superuser bypass the triggers; a user-written trigger on another table could delete rows at depth above 1. The application role is not meant to do any of that.
- **A direct DELETE of `sales_order` is allowed** and takes the snapshot, the adjustments and the journal with it through the allowed cascade. Nothing in the application deletes orders; a privacy plan (anonymization or erasure after the legal period, plan open question 10) will need that path, so it is not blocked now.
- **`sales_order` itself is mutable** (status, timestamps, payment reference). Only the state machine in core and the service layer protect it; the contact data and totals are not locked by a trigger.
- **The cached sums** `shipping_total`, `discount_total`, `tax_total` and `total_amount` cannot be checked against the adjustment lines in SQL (adjustments included in the price are reported but not added); `computeOrderTotals` in core is the only authority. Currency equality between an order and its lines is not enforced in SQL either.
- **A sold variant that never had stock rows can be deleted.** The catalog rule `has_stock_history` (ADR 0013) looks at `stock_movement` and `reservation` rows. An untracked variant (digital goods) that was sold has neither, so the rule passes and the delete succeeds: the order line keeps its snapshot with `variant_id` NULL and the cart lines go. This is safe for the data, but it makes the plan's sentence "only never-sold variants can be deleted" untrue for untracked variants. **Follow-up for the checkout step (5b):** extend the core fact `hasStockHistory` (or add `hasOrderLines`) so that a variant referenced by an `order_item` is refused too; the schema already has the index `order_item_variant_id_idx` for that lookup.
- **Outbox retention:** the partial index covers undispatched rows only (as the plan says); the job that deletes dispatched rows after 7 days scans without an index until the scheduler step adds one if the table grows.

## Consequences

- Test helpers that drop tables by hand must drop the three trigger functions too (`order_item_immutable`, `order_adjustment_append_only`, `order_status_change_append_only`); `apps/api/src/test/migrate.ts` and the schema specs do.
- `0004_cart_customers_orders.down.sql` drops the tables in reverse dependency order, then the functions, then deletes its bookkeeping row. It never touches reservations or stock rows of migration 0003; it destroys all customers, carts and orders.
- The checkout step must reserve through `ReservationsService` and insert `order_item_reservation` in the same transaction: the RESTRICT key then guarantees that a reserved variant cannot be deleted from under an open order.
