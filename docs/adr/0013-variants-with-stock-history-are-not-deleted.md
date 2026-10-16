# ADR 0013: Variants with stock history are not deleted

Status: accepted 2026-10-16 (decision of the review fixes in `docs/plans/2026-10-16-pricing-review-findings.md`). Supersedes the assumption in ADR 0012 that a deletable variant never has history; adds one condition to the delete rule of ADR 0006 sections 3 and 5. ADR 0006 and ADR 0012 are not edited.

## Context

- ADR 0006 allows hard-deleting a variant only while its product is `draft`. ADR 0012 made `stock_movement` and `reservation` rows follow their variant (`ON DELETE CASCADE`) and argued that this is safe because only variants of a never-published or draft product can be deleted.
- That is not true: an admin can unpublish a sold product (it returns to `draft`), and then `DELETE /admin/products/{id}/variants/{variantId}` of a non-default variant removed the variant's sales history (`stock_movement`), its levels and its active reservations. The review (finding R2) reproduced this.

## Decision

- A variant with stock history cannot be hard-deleted. Stock history = any `stock_movement` row or any `reservation` row (any status) of the variant. The core rule `canDeleteVariant` takes the fact `hasStockHistory` and answers `has_stock_history`; the API maps it to `409 rule_violation` with that rule, like the other delete rules.
- The check runs in the delete transaction after the product row lock, with the variant row locked `FOR NO KEY UPDATE`: a reservation in progress holds the variant `FOR SHARE`, so the delete waits for it and then sees its row. Lock order stays product, then variant for the delete; stock writes take product, then level; reservations take variant (`FOR SHARE`), then level. No cycle.
- A variant that only has price rows, or an empty level without any movement, can still be deleted (prices and the empty level go with it). Deleting a never-published product still removes everything with it (ADR 0012, unchanged).

## Consequences

- Switch such a variant off (`isActive: false`) instead of deleting it. ADR 0006 sections 3 and 5 gain this one condition; the delete rule in `docs/api/catalog.md` lists `has_stock_history`.
- Not covered, documented follow-up: rebuilding the variants of a draft product when its options change (`PUT /admin/products/{id}/options` that adds or removes an option or a value) also deletes all variants and so can still remove history of a product that was sold and unpublished. It needs its own decision (refuse, or keep the variants).
- `reserved` is bounded in code only (`reserved_out_of_range`, bound `MAX_RESERVED` = `MAX_ON_HAND`). A database `CHECK (reserved <= 1000000000)` on `inventory_level` is a possible later migration (a schema change, not part of this fix).
- ADR 0012 already lists what the append-only trigger does not cover. An optional statement-level `TRUNCATE` trigger on `stock_movement` is a possible later migration; no code change now.
