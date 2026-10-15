# ADR 0008: Generated variants of live products

Status: accepted (2026-10-15, owner decision). Extends ADR 0006 sections 4 and 6; ADR 0006 is not edited.

## Context

ADR 0006 section 4 says `is_required` attributes are enforced on every write to an `active` product, and section 6 says publishing needs "every variant has its required variant-level attributes".
Adding an option value to a published product (`POST /admin/products/:id/options/:optionId/values`, section 5) and `POST /admin/products/:id/variants/generate` create variants with empty `attributes`.
For a product type with a required variant-level attribute, those variants were created active and invalid: the store sold variants that break the type's own rule, and the product could not be published again after an unpublish.

## Decision

1. Generated variants (both routes above) of a product in status `active` or `archived`, whose product type has at least one `is_required` variant-level attribute, are created with `is_active = false`.
   Draft products and types without required variant attributes are unchanged (variants are created active).
2. An inactive variant is not sold, so publish preconditions require the required variant-level attributes only on active variants (core `publishPreconditions`). Values an inactive variant does have must still be valid.
3. `PATCH /admin/products/:id/variants/:variantId` with `isActive: true` on an `active` product validates the variant's attributes like a publish (the stored ones when the body has no `attributes`). The admin fills the attributes, then switches the variant on, in one request or two.
   Activating on a `draft` or `archived` product stays lenient; the publish preconditions check the active variants later.

## Consequences

- The store never lists a variant that lacks required attributes (it already lists only active variants).
- Re-publishing after unpublish works while inactive variants wait for their attributes. Other publish preconditions are unchanged (one active default variant, at least one active variant).
- The admin has one extra step after adding a value for such types; the generated variant is visible in the admin with `isActive: false`.
- Public contract change in `docs/api/catalog.md`: the `isActive` of generated variants and the 400 on activation. Pre-1.0 and admin-only, so no migration guide.
