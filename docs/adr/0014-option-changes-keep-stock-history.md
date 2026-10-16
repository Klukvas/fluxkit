# ADR 0014: Option changes keep stock history

Status: accepted 2026-10-16 (owner decision: refuse). Adds one condition to the option-change rule of ADR 0006; supersedes the "not covered, documented follow-up" paragraph of ADR 0013. ADR 0006 and ADR 0013 are not edited.

## Context

- `PUT /admin/products/{id}/options` on a draft product that adds or removes an option, or removes a value, deletes and regenerates all variants of the product.
- A sold product that was unpublished is a draft again. Deleting its variants cascades away their `stock_movement` rows, levels and reservations (ADR 0012), the same hole ADR 0013 closed for the single-variant delete.

## Decision

- When the change would rebuild the variants, it is refused while any variant of the product has stock history (any `stock_movement` row or any `reservation` row of any status, as in ADR 0013). Core rule `canRebuildVariants({ anyVariantHasStockHistory })` answers `has_stock_history`; the API maps it to `409 rule_violation` with that rule.
- Changes that keep the variants (adding values to an existing option, reordering) are not affected. A product whose variants only have prices, or an empty level without movement, can still be rebuilt.
- The check runs in the same transaction after the product row lock. `VariantsRepository.anyHasStockHistory` locks all variants of the product `FOR NO KEY UPDATE` in id order, then reads the history with one `EXISTS` query for the whole product. A reservation in progress holds its variant `FOR SHARE`, so the option change waits for it and then sees its row. Lock order: product, then variants; stock writes take product, then level; reservations take variant (`FOR SHARE`), then level. No cycle.

## Consequences

- To restructure the options of a product that has stock history, create a new product, or switch variants off (`isActive: false`).
- The rule is a condition on the option-change rule of ADR 0006; `docs/api/catalog.md` lists `has_stock_history` for the options route.
