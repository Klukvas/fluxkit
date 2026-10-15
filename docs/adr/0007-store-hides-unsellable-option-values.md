# 0007. The store hides option values and images that no active variant can sell

Status: accepted 2026-10-16 (owner approved: hide them; catalog review finding S4). Adds a rule to section 10 of ADR 0006 (public store API); ADR 0006 itself is not changed.

## Context

- `GET /store/products/{slug}` returned `options[].values` as the values the product chose (`product_option_value`), and every `media` entry of the product. Variants were already filtered to `is_active = true`.
- When the only variants that use a value (say the colour "blue") are deactivated, the storefront still offered "blue" and showed its image, and choosing it led to no purchasable variant.
- The data stays correct for the admin: the product keeps its chosen values and images, so reactivating a variant brings them back without edits.

## Decision

- In the store product detail, a value of `options[].values` is returned only if at least one ACTIVE variant of the product uses it (`variant_option_value`).
- An option with no remaining values is omitted from `options`.
- A `media` entry with an `optionValueId` is returned only if that value is among the remaining values; media without an option pair is always returned.
- Order rules are unchanged (product's option order, product's value order, media position). The rule is applied in memory from data the service already loads (the active variants' option values now also carry `optionValueId`), so the number of queries stays constant.
- Not changed: `GET /store/products` (list): its image rule (first gallery image, else first image) is not filtered by this decision.

## Consequences

- The response shape does not change; only fewer entries can appear. Storefronts must not assume every option or value chosen in the admin is present.
- A product whose variants are all inactive shows no options and no option-bound images (a product can not be published without an active variant, so this only happens after later deactivation).
- Admin tools keep seeing the full data (`/admin/*` is untouched).
- No special case for the default variant: a value used by it stays only while that variant is active (ADR 0006 section 6 requires an active default variant to publish).
