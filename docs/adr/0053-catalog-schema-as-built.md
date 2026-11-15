# 0053. Catalog schema as built: three places where ADR 0006 and the code differ

Status: accepted 2026-11-14 (owner's approval of `docs/plans/2026-11-14-review-followups.md`, PR A). Supplements ADR 0006 (catalog schema) for three rows only; ADR 0006 is not edited and everything else in it stands. Records the code as it is: no code change.

## Context

- The independent catalog review of 2026-10-16 (`docs/plans/2026-10-16-catalog-review-findings.md`, "Information") listed places where ADR 0006 describes behaviour the API does not have. They stayed open in `docs/HANDOFF.md` section 4 ("fix the code or supersede the ADR").
- Changing the code in any of the three would change a public API contract (AGENTS.md section 17) without a request from a client; the current behaviour is documented in `docs/api/catalog.md` and covered by tests.

## Decision

1. **Removing an option value from a product (ADR 0006 section 5, row "Remove a `product_option_value`").** The API offers no route that removes a value from an `active` or `archived` product: values are only added there (`POST /admin/products/{id}/options/{optionId}/values`). A value leaves a product only through `PUT /admin/products/{id}/options` on a `draft` product, which deletes and regenerates the variants first. The database `RESTRICT` described in the row therefore never fires through the API; it stays as a safety net for direct database writes. Deleting a dictionary value that a product uses answers `409 option_value_in_use` (`DELETE /admin/options/{id}/values/{valueId}`). To retire a value on a live product, switch its variants off (`isActive: false`).
2. **Page size (ADR 0006 section "Limits", row "Page size").** The storefront lists keep the ADR's default of 24 (maximum 100). The admin lists use a default of 50 (maximum 100, `ADMIN_DEFAULT_PAGE_SIZE` in `apps/api/src/common/pagination.ts`): admin tables show more rows than a product grid. The maximum offset of 10 000 holds for both.
3. **Category filter of the admin product list (ADR 0006 section on categories: "Listing by category includes descendants (CTE) unless `?includeDescendants=false`").** `GET /admin/products?categoryId=` matches products assigned to that category directly, not its descendants, and there is no `includeDescendants` parameter. The storefront `GET /store/products?category=` includes the active descendants, as the ADR says. The admin filter answers "what is assigned here", which is what the category screens need.

## Consequences

- `docs/api/catalog.md` already describes all three; the HANDOFF "ADR 0006 vs code" item is closed by this ADR.
- If a client needs descendants in the admin filter or a value removal on live products, that is a contract change with its own plan.
