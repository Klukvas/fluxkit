# Free-shipping progress in the cart

Status: owner-approved shape (decision 7 of `2026-11-14-playful-default-design.md`, recorded by PR 295): "Approved, additive: a nullable
store-API field with the cart's free-shipping threshold (lowest active `free_over` in the cart currency); the remainder is computed on the
server. No migration." Implementation in progress.

## Goal

Concept 03's cart drawer shows "Ще X до безкоштовної доставки" with a progress bar. Add the server numbers to the store cart and show them
in the drawer and on the cart page. The browser formats the server's numbers; it never subtracts or compares money.

## What exists (reused, nothing new invented)

- Core shipping: `validateShippingPricing`, `decideShippingPrice` (`free_over` is 0 when `subtotal >= freeFrom`),
  `isShippingMethodOffered` (active, shop currency, a `pickup_point` only with its provider loaded), money functions in `pricing/money.ts`.
- Threshold basis (ADR 0029 decision 3): the cart `subtotal` (every available line, digital ones included), the same value
  `GET /store/shipping/options` and the checkout give `quoteShippingMethod`.
- `CartPricingService` builds every cart shape (the five cart routes and the `cart` of the checkout's `409 cart_changed`).
- Seed: `demo_courier` in `seeds/src/shared/shipping.ts` is already `free_over` (`freeFrom` 200 000), inactive by design. The e2e suite
  creates and deactivates its own methods (`shipping-checkout.e2e.ts`), so the drawer e2e does the same; no seed change.
- No progress or meter component exists in `packages/ui` or the storefront; the drawer and cart page are `cart-drawer-view.tsx` and
  `cart-page.tsx`. Inline `style` is refused by the design guard, so the bar is a native `<progress>`.

## API (additive, public contract change: minor)

`freeShipping: {threshold: Money, remaining: Money} | null` joins the cart shape (required key, nullable value), in every response that
returns the cart.

- New pure core function `decideFreeShippingProgress` (`packages/core/src/shipping/free-shipping.ts`), TDD:
  - candidates: methods that are offered (`isShippingMethodOffered`), whose stored pricing passes `validateShippingPricing`, of type
    `free_over`, in the subtotal's currency;
  - `threshold` = the lowest effective threshold (`freeFrom`, or zero when `amount` is zero); `remaining` = `max(0, threshold - subtotal)` with core money functions;
  - `null` when there is no candidate;
  - consistency rule, tested: `remaining` is 0 exactly when `decideShippingPrice` charges 0 for the chosen method.
- The API answers `null` when the cart is empty or does not require shipping (`requiresShipping` false), the same
  rule that empties the shipping options list. Empty carts read no methods; priced carts with present lines read methods once.
- The destination country is ignored (the cart has none): the threshold is the lowest among offered methods; the options at checkout
  still decide per country. A method that is always free (`flat` 0) is not a `free_over` and does not count (decision wording).
- Reads: one extra bounded statement for active `shipping_method` rows whenever a priced cart has at least one present line (including digital-only carts), so no N+1, and the checkout's
  `cart_changed` cart carries it too. Provider loading comes from the global `ShippingProviderRegistry`; the cart code does not import
  `shipping/store` (that module imports the cart: a cycle).
- No migration, no new table or column, no personal data.

## Storefront

- `FreeShippingProgress` (presentational): native `<progress value={subtotal} max={threshold}>` (the element clamps; no arithmetic),
  text `cart.freeShipping.remaining` "Ще {amount} до безкоштовної доставки" / "{amount} more for free delivery", and
  `cart.freeShipping.reached` when `remaining` is 0. Hidden when `freeShipping` is `null` or the cart has no lines.
- Tokens only; the fill transition uses `--fk-motion-duration-*` and `--fk-motion-ease-*`, off under `prefers-reduced-motion`.
- In the drawer above the totals, and on the cart page in the summary.

## Tests

- Core unit (TDD, failing first): no free method, several free methods, inactive method, pickup point without provider, invalid pricing,
  currency mismatch, subtotal below, exactly at and above the threshold, zero subtotal.
- API integration (real Postgres, Redis, Meilisearch): `GET /store/cart` null without methods, empty cart null, lowest of several active
  methods, an inactive method ignored, at and above the threshold, a digital-only cart null, a method in another currency ignored; the
  statement count stays fixed.
- api-client contract test and types; storefront unit test of the bar; one e2e: the drawer shows the bar for a created `free_over` method.

## Docs

`docs/api/cart.md`, `docs/api/openapi.json` (`pnpm openapi:export`), `docs/contracts/` if the cart shape is listed there, `CHANGELOG.md`,
`docs/files/*` for new files, `docs/HANDOFF.md`.

## Risks

- A storefront older than this field ignores it (additive). A custom client that validates the cart strictly must accept the new key.
- The threshold may come from a method that does not serve the shopper's country; documented, acceptable for a hint.
