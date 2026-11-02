# Storefront: use the matched variant and the cart stock hints (2026-11-03)

Status: in progress. Branch `feature/storefront-use-match-and-stock-hints` from `origin/main` `9dbdac0` (PR 214 merged). No PR is opened by the implementing agent.
Goal: consume the two additive API fields of PR 214 (plan `2026-11-02-api-matched-variant-and-stock-hints.md`, "Consumption notes") and remove the stop-gap wording PR 213 added while they did not exist. Storefront only: no API, schema, contract, token or dependency change.

## Existing functionality found

- `@fluxkit/api-client` already types `SearchItem.match?: SearchMatch | null` and `CartLine.insufficientStock`, `CartLine.maxQuantity` (contract-tested in PR 214); the `409 cart_changed` body's `cart` carries them (API spec `cart-stock-hints.spec.ts`), and the storefront's checkout store already applies that cart (`cartChanged` -> `cart.applyCart`).
- `lib/search-facets.ts` `cardMatch` (PR 213) guesses from the address; `product-card.tsx` renders it; `lib/variant-matcher.ts` already reads `?opt.<code>=<value>` on the product page; `lib/money.ts` `formatMoney` formats every locale and currency.
- `lib/cart-model.ts` (`lineFlags`, `stockWarnings`, `checkoutBlock`), `cart-page.tsx`, `checkout-page.tsx` (`StockWarningsView`), `lib/checkout-store.ts` (`checkoutBlock`), `product-purchase.tsx` (`lineRoom` cap from PR 213).

## Changes

1. **Card** (`lib/search-facets.ts`, `product-card.tsx`, `product-grid.tsx`, `search-results.tsx`): a pure `cardOffer(item, query)` per item replaces the page-wide `cardMatch`:
   - `match` absent: today's product-level card (price, availability, plain link).
   - `match` an object: `match.price` (one price, or "from" when `from !== to`), the badge of `match.availability` (so a `low_stock` representative never reads "In stock", PR 213 review M1), "N matching options" when `variantCount > 1`, and the link `?opt.<optionCode>=<valueCode>` for each `match.optionValues` pair.
   - `match: null` (the index is behind): the PR 213 fallback: product price, no badge, the note "Price and stock depend on the option", the link with the options the address pins to one value.
   - Removed: the badge guessed from `inStock:false`, the variant-level detection from facets, the notes "Price depends on the option" and "Stock depends on the option".
2. **Cart and checkout** (`lib/cart-model.ts`, `cart-page.tsx`, `checkout-page.tsx`, `lib/checkout-store.ts`, `product-purchase.tsx`):
   - `lineStockHint(line)`: `null` unless `insufficientStock` (and the line is not unavailable or out of range); `{maxQuantity: 0}` "Out of stock: remove the item"; `{maxQuantity: N}` "Only N available" and the stepper capped at N; `maxQuantity: null` "Not enough stock: reduce the quantity or remove the item" (the 999-of-22 case).
   - Cart page: the checkout link is replaced by a disabled button with the reason and a link to each offending line (`#cart-line-<variantId>`) while any line has the hint; a checkout pressed while a quantity saves goes on only if the saved cart has no such line. Autosave unchanged (the server's answer is applied; the stepper cap is display only).
   - Checkout page: the stock alert above the form lists the offending lines with links to them in the cart and the submit is blocked (`stock`) before the form is filled; a `checkout_refused` with `insufficient_stock` re-reads the cart so the hints are current; the server stays the judge.
   - Product page: the add room is `min(999 - inCart, maxQuantity - inCart)` when the cart line has a hint; a line with `insufficientStock` and no number allows no more and says so with a link to the cart.
   - Removed: "the shop confirms the quantity when you place the order" (product page, cart line, checkout low-stock alert).
3. **Docs and tests**: unit specs failing first for `cardOffer`, `lineStockHint`, the blocks and the views; e2e: a filtered card shows the matched variant's price, availability and link; 999 of a 22-stock variant shows the message in the cart and the checkout is flagged before the form. `docs/files/storefront.md`, `apps/storefront/README.md`, `CHANGELOG.md`, `docs/HANDOFF.md`, this plan's results.

## Risks

- A stale hint could block a checkout that would pass (stock arrived): every page reads the cart again on arrival, so a reload clears it; the API is still the judge.
- `maxQuantity` exists only below the low-stock threshold; above it the text names no number (by API design).

## Verification

`pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:docs`, `check:env`, `check:licenses`, storefront/ui/theme unit tests, storefront e2e against throwaway Postgres 16, Redis and Meilisearch; each exit code read separately.
