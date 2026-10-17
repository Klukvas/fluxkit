# ADR 0020: Variants with order lines are not deleted

Status: accepted 2026-10-17 (closes the known gap of ADR 0019). Extends the delete rule of ADR 0013 and the option-change rule of ADR 0014; supersedes the plan sentence "only never-sold variants can be deleted" of `docs/plans/2026-10-17-cart-and-orders.md` (Data, `cart_item`), which was only true for tracked variants. ADR 0013, 0014 and 0019 are not edited.

## Context

- ADR 0013 refuses to delete a variant that has any `stock_movement` or `reservation` row, because the delete would cascade the history away. A sold variant of a tracked product always has such rows.
- A sold variant that is NOT tracked (digital goods, `trackInventory = false`) has neither: it is never reserved and never produces a `sale` movement. The rule saw nothing, the delete went through, and `order_item.variant_id` became NULL (ADR 0019: safe for the data, because the line keeps its snapshot).
- Safe is not the same as right: an order line that points nowhere cannot be traced to a catalog entry any more (refunds, reporting, "buy again"), and the sentence of the plan was wrong for those variants. ADR 0019 listed it as a known gap with the follow-up for the checkout step.

## Decision

- A variant that any `order_item` refers to (whatever the order status) cannot be hard-deleted. Core `canDeleteVariant` gets the fact `hasOrderLines` and the reason `has_order_lines`; the API maps it to `409 rule_violation` with that rule. It comes after the structural rules and `has_stock_history` in the order of the checks.
- The same fact guards the rebuild of the variants of a draft product (`PUT /admin/products/{id}/options` that adds or removes an option or removes a value): core `canRebuildVariants` gets `anyVariantHasOrderLines` and answers `has_order_lines` after `has_stock_history`.
- The fact is one indexed `EXISTS` on `order_item.variant_id` (`order_item_variant_id_idx`), read in the same transaction after the product row lock and the variant row lock that `hasStockHistory` already takes. A checkout holds the product and variant rows `FOR SHARE` until it commits its order line, so a delete either waits for it and then sees the line, or finishes first and the checkout sees that the variant is gone (`409 cart_changed`). The lock order of ADR 0015 is unchanged.
- The database behaviour of ADR 0019 does not change: a direct `DELETE` of a variant still sets `order_item.variant_id` to NULL and keeps the snapshot. Only the catalog API refuses.

## Consequences

- To retire a sold variant, switch it off (`isActive: false`) or archive the product, as for variants with stock history.
- To restructure the options of a product with sold variants, create a new product.
- `docs/api/catalog.md` lists `has_order_lines` for the variant delete and the options route; `docs/api/inventory.md` mentions it next to `has_stock_history`.
- Deleting a whole draft product is not affected here: `order_item.product_id` keeps its `ON DELETE SET NULL`, and a product that was ever ordered was published, so the draft-only delete rules of ADR 0006 already keep it.
