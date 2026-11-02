# Storefront: use the matched variant and the cart stock hints (2026-11-03)

Status: built (see "Results"); PR 215, independently reviewed (no blocker, no major; minors fixed, see "Review fixes"). The file name carries the date the task gave it; the work was written, built and reviewed on 2026-11-02 (the dates below). Branch `feature/storefront-use-match-and-stock-hints` from `origin/main` `9dbdac0` (PR 214 merged). No PR is opened by the implementing agent.
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
   - Checkout page: the stock alert above the form lists the offending lines with links to them in the cart, before the form is filled; a `checkout_refused` with `insufficient_stock` re-reads the cart so the hints are current; the server stays the judge. Decided while building: the checkout page FLAGS (the submit's `aria-describedby` names the warning) but does not block the submit. Blocking made a stale hint a dead end (stock may come back) and broke the PR 211 retry semantics (`cart-changes.e2e.ts`: a refused order retried with the same idempotency key); the cart page, where the shopper fixes the lines, blocks its checkout link.
   - Product page: the add room is `min(999 - inCart, maxQuantity - inCart)` when the cart line has a hint; a line with `insufficientStock` and no number allows no more and says so with a link to the cart.
   - Removed: "the shop confirms the quantity when you place the order" (product page, cart line, checkout low-stock alert).
3. **Docs and tests**: unit specs failing first for `cardOffer`, `lineStockHint`, the blocks and the views; e2e: a filtered card shows the matched variant's price, availability and link; 999 of a 22-stock variant shows the message in the cart and the checkout is flagged before the form. `docs/files/storefront.md`, `apps/storefront/README.md`, `CHANGELOG.md`, `docs/HANDOFF.md`, this plan's results.

## Risks

- A stale hint could block a checkout that would pass (stock arrived): every page reads the cart again on arrival, so a reload clears it; the API is still the judge.
- `maxQuantity` exists only below the low-stock threshold; above it the text names no number (by API design).

## Verification

`pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:docs`, `check:env`, `check:licenses`, storefront/ui/theme unit tests, storefront e2e against throwaway Postgres 16, Redis and Meilisearch; each exit code read separately.

## Results (2026-11-02)

- **Card:** `cardOffer` (`lib/search-facets.ts`) per item replaces `cardMatch`; `product-card.tsx` takes an `offer`, `product-grid.tsx` an `offerFor`. New message `search.card.matchingOptions` (plural); removed `search.card.priceDependsOnOption`, `search.card.stockDependsOnOption`; `search.card.dependsOnOption` stays for `match: null`.
- **Stock:** `lib/cart-model.ts` (`lineStockHint`, `stockHintText`, `stockProblemLines`, `quantityStepperMax`, `cartLineFacts`, `lineName`, `cartLineAnchor`; `checkoutBlock` gains `stock`; `stockWarnings` and `quantitiesByVariant` removed), `lib/add-to-cart.ts` (`addRoom`), `lib/checkout-store.ts` (re-read after an `insufficient_stock` refusal, `sameLines`), `cart-page.tsx`, `checkout-page.tsx`, `product-purchase.tsx`. Messages: added `cart.stock.*`, `cart.checkout.stockBlocked`, `checkout.stock.title`/`description`, `product.quantity.stockLimit`/`stockShort`; removed `product.quantity.lowStock`, `cart.notice.lowStock.hint`, `checkout.stock.outOfStock`/`lowStock`/`toCart`; `errors.field.insufficient_stock` no longer says the shop shows no amount. Kept on purpose: the 999-per-line messages of PR 213 (`product.quantity.inCart`/`atLimit`/`overLimit`): they are about the API's line limit, not stock.
- **`409 cart_changed`:** its `cart` carries the fields (API spec `cart-stock-hints.spec.ts`); the checkout store applies that cart (`cartChanged` -> `applyCart`, unchanged), and a view spec shows its hints listed above the form.
- **Failing first:** unit specs written before the code failed (11 card specs: `search-facets.spec.ts`, `search-results.spec.tsx`; 26 stock specs across `cart-model`, `add-to-cart`, `checkout-store`, `cart-page`, `checkout`, `catalog`), then passed. The new e2e file `match-and-stock-hints.e2e.ts` failed 6 of 6 against a storefront built from `origin/main`'s source, then passed 6 of 6.
- **Verified (exit 0 each):** `pnpm lint`, `format:check`, `typecheck`, `check:boundaries` (2331 modules, 0 violations), `check:env`, `check:licenses`, `check:docs`; unit tests storefront 1723, ui 180, theme 68; storefront e2e full suite with search on (97 passed, 4 `search-off` skipped by design) and `match-and-stock-hints` plus `search-off` with `E2E_SEARCH=off` (6 passed, 4 skipped).
- **Not verified:** a `match: null` card in a browser (the index would have to lag Postgres; unit-tested only); a manual screen-reader pass; the admin e2e suite (no admin change); a multi-location shop (the hint counts the default location, `docs/api/cart.md`).

## Review fixes (PR 215, independent review 2026-11-02)

- **m1 (typed quantity clamped to a stale hint):** chosen: the server decides above the hint. `QuantityInput` (`packages/ui`) gains an optional `stepMax`: the step buttons stop there, a typed number is clamped to `max` (999) only. The cart passes `quantityStepperMax(line)` as `stepMax`, so "+" stops at "Only N available" while a typed 10 is sent as 10 and the server's answer sets the hint again (or clears it after a restock). One "-" from above the hint still lands on it.
- **m2 (grammar):** `product.quantity.stockLimit` is a plural group by the available count (`{inCart}`, `{count}`; en "is"/"are", uk all forms); a count of 0 uses `product.quantity.stockShort` ("more than the shop has in stock").
- **m3 (stale line error):** after an `insufficient_stock` refusal the cart re-read drops the stock errors of lines the fresh cart no longer flags; other codes stay; a newer submit's errors are never touched.
- **m4 (count beside the badge):** "N matching options; the best availability among them is shown" (uk the same meaning).
- **m5 (a11y):** each cart line's stock hint sits in an always-mounted polite live region; when the checkout link turns into the blocked button and the focus was lost with it, the focus moves to the reason (`focusCheckoutReason`, `tabindex="-1"` on the reason).
- **m6:** the `409 cart_changed` path is driven through the checkout store (cart without hints before, the 409's cart with hints applied after); the view spec's name says what it checks.
- **m7:** handoff names PR 215; this date note; the dead `hint === null` branch of `StockWarningsView` is gone (`stockProblems` yields line and hint).
- **Failing first:** the new and changed specs failed before the fixes (storefront 7, ui 1; the m6 store spec passed at once: it covers existing behaviour), then passed.
