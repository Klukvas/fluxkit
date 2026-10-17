# 0022. Cancelling a paid order releases unsold reservations

Status: accepted 2026-10-17. Refines the stock effect of `paid -> cancelled` in ADR 0017 (and the plan `2026-10-17-cart-and-orders.md`), which said "none". Nothing else in ADR 0017 changes.

## Context

ADR 0017 gives `paid -> cancelled` (admin only, with a reason) no automatic stock effect: sold units stay sold, no restock, the refund happens outside the system. That is right for `committed` reservations. But a paid order with a BACKORDERED line (for example on hand 1, quantity 3) keeps the units that were not on hand in an `active` reservation that payment extended by `BACKORDER_HOLD_DAYS` (365). Cancelling the order left that reservation `active`, so the units stayed reserved for up to a year for an order that no longer exists. The step 6 review found it; the owner decided to fix it.

## Decision

- The core table says it: the stock effect of `paid -> cancelled` is the new `release_unsold` (`StockEffect` = `reserve`, `commit`, `release`, `release_unsold`). `none` was used by this one row only and is removed, so no branch is left that nothing can reach.
- `release_unsold` releases the reservations of the order that are still `active`, and nothing else. `committed` reservations are sold units: they stay `committed`, `on_hand` is not raised, no `return` movement is written (restock stays a manual inventory `return`, ADR 0017). `released` and `expired` ones (swept before the cancel) are ignored, not an error.
- It goes through the same sorted batch helper as every release of an order (`releaseManyIn`, sorted by variant and location), so two orders with crossing lines cancelled together cannot deadlock (ADR 0015, step 5a).
- `release` (`awaiting_payment -> cancelled`, `expired`) is unchanged, including its assertion that no reservation is `committed`. `paid -> fulfilled` is unchanged.
- Concurrency: the order row lock taken first serializes the cancel with `markPaid`, fulfilment and the scheduler's expiry. After `fulfilled` a cancel is `invalid_transition`; after a cancel a fulfilment is `invalid_transition` and commits nothing. The stock effect runs in the transition's savepoint: a failure rolls the status change back.
- Releasing an `active` reservation lowers `reserved` and writes no journal row (as everywhere), so the cancel adds no `stock_movement`.

## Consequences

- A cancelled paid order never keeps stock reserved; only sold units stay out of stock until an admin records a `return`.
- Public surface: the exported core type `StockEffect` changes (`none` removed, `release_unsold` added). Plugins do not consume it (the table is internal to `OrdersService`), so this is recorded in `CHANGELOG.md` without a migration guide.
- No schema change, no migration.
