# Plan: storefront mobile UX (review batch "mobile")

Status: in progress, branch `feature/storefront-mobile-ux` (from `origin/main` `55f53ff`). Storefront only: no API, schema or dependency change.
Source: the independent UX reviews of 2026-11-02 (designer D-02 to D-05, D-09, D-10, D-12, D-13; a11y A-02; newbie N5, N8, N9). Desktop
redesign (cards hover, PDP right column, home, type/space tokens, TrustBar, breadcrumbs/steps, dark theme) is the NEXT batch, not this one.

## Before-state (measured 2026-11-02 on this branch's base, `next dev` on localhost, demo seed, Chromium, touch emulation)

| Item | 390 uk | 390 en | 360 uk | 768 uk |
|---|---|---|---|---|
| Header height / position | 113 px, `static` (scrolls away) | 113, static | 113, static | 113, static |
| PDP "Add to cart" (demo-hoodie) | y 931, 180x40 | y 931, 117x40 | y 1015, 180x40 | y 541, 180x40 |
| Catalog filters | inline toggle, panel pushes grid down; without a script the panel is `hidden` below `lg` (not usable) | same | same | same |
| Cart line SKU | wraps 3 lines (114 px column) | 3 lines | 4 lines | 1 line |
| Cart "Checkout" link | y 1207 (2 lines), not sticky | y 1255 | y 1359 | y 863 |
| Checkout "Your order" heading / submit | summary y 1669, submit y 1597 (40 px high), page 2394 | summary y 1565 | summary y 1693 | summary y 1497 |
| Order page "Save this link" box / h1 | 324 px box, h1 "Замовлення BM1R-/DWNT" wraps (72 px) | 300 px, no wrap | | 276 px |
| Tap targets | breadcrumb links 20 px high, card brand link 87x20, filter checkbox 20x20 (label row inline, 44 px high but only text wide), cart title link 21 px | same | same | same |
| Horizontal scroll | 0 on home, catalog, PDP, cart, checkout, order | 0 | 0 | 0 |

Already fixed by PRs 211/213/215 (re-measured, no change here): D-13 the en search placeholder is not clipped (390: 125 px text in a 238 px box; 1280: 125 in 377); header one row from `lg` (61 px).
Screenshots: scratchpad `mobile-shots/before-*.jpg` (390 uk/en, 360, 768).

## Design per item

1. **Header (D-04, N9).** Below `lg`: ONE row: menu, logo, search toggle, language, cart (badge), account; `sticky top-0` with the background token,
   `padding-top: env(safe-area-inset-top)`. The search field row is hidden below `lg` behind the toggle: a plain in-page link `#site-search`
   (no script: CSS `:target` shows the row, the native link moves focus there); with a script it toggles the row (`aria-expanded`,
   `aria-controls`), focuses the box, Escape closes and returns focus. `html` gets `scroll-padding-top` below `lg` so anchors and focus are not
   hidden under the sticky bar. Menus stay `details/summary`. N9: no grey skeleton pills: the cart shows its icon without a badge while loading,
   the account slot shows the user icon (muted, not a control) while the session is read; the loading text stays for assistive technology.
   Header markup stays small (the 12.8 KB first-chunk budget noted in `globals.css`).
2. **PDP buy bar (D-02, N8, A1).** Inline CTA full width and 48 px below `sm`. A fixed bottom bar below `md` (price, variant summary or the
   limit/availability text, compact stepper, full-width >= 44 px "Add to cart") shown only while the inline add button is out of view and the
   footer is not in view (IntersectionObserver; fixed, so no layout shift; `env(safe-area-inset-bottom)`; reduced motion: no transition).
   The bar is a pointer shortcut like the PR 211 floating Apply: `aria-hidden`, its buttons `tabIndex=-1`; the inline form stays the single
   control for keyboard and screen readers (focusing it scrolls it into view, which hides the bar). Disabled exactly when the inline button is
   (stock, line limit of PR 215). While adding, the inline button keeps focus (`aria-disabled`, not `disabled`; review A1). "Added": the always
   mounted `role="status"` region shows a toast (fixed above the bar on mobile, inline from `md`) with "View cart" and a dismiss button.
3. **Catalog filters (D-05).** Below `lg` a "Filters (N)" control (N = selected filters) next to the sort select opens the existing form as a
   full-screen sheet: `role="dialog"`, `aria-modal`, title + close, Tab trapped, Escape and close return focus to the control, body scroll locked,
   sticky footer with "Apply filters" (the form's own submit) and "Clear". The floating Apply of PR 211 stays for the desktop sidebar and is not
   shown inside the sheet (the sticky footer replaces it). No script: the control is a link to `#search-filters-panel` and CSS `:target` shows the
   inline form (today it cannot be opened at all without a script below `lg`). Facet groups become collapsible (`details`), the first two and every
   group with a selection open. Counts: only where the API gives them (product-level facets); option facets have `count: null` (ADR 0034
   decision 4), so no numbers are invented. The category facet keeps the UUID: `GET /store/search` only accepts `category:<uuid>` (docs/api/search.md), so it stays (reported).
   "Show N results" would need a count for the draft (an extra search request per change, against the 60/min limit): not done; the button says "Apply filters".
4. **Cart (D-09).** Line card: image + text column, the line total under the unit price, SKU smaller and breaking instead of wrapping into
   3 lines, a controls row (stepper, "Remove" as a 44 px button). Summary: items and subtotal static; the total and the checkout control in a bar
   that is `sticky bottom-0` below `md` (CSS only, no duplicate), with the PR 215 blocked state and reason inside it and the focus rule unchanged.
   `scroll-padding-bottom` while a sticky bottom bar exists (`:has`), so focused controls are not hidden behind it.
5. **Checkout (D-03).** The summary section moves before the form in the DOM; from `lg` it is placed in the right column as now. Below `lg` its
   lines and totals collapse behind a toggle "Your order · N items · total" (checkout needs a script anyway); the confirmation alerts
   (price change, total, delivery) stay visible outside the collapsed part, and the summary opens by itself when the server refused a line, so
   line errors sit right under the top alert. The submit row is `sticky bottom-0` below `lg` with the total; the legal notice stays right above
   it. Field order, types, `autocomplete`, `inputmode` unchanged; the error summary keeps the focus (scroll padding for the sticky header/bar).
6. **Order page (D-10, D-12).** "Save this link" becomes a compact callout: one short sentence, the link field and the copy button in one row
   (button 44 px); the order number never wraps (`whitespace-nowrap` on the number, smaller heading below `sm`). Shorter copy, same meaning:
   `order.saveLink.description`, `checkout.payment.note`/`noteOnline`, `order.payment.awaiting` stay legally equivalent (exact before/after in "Results").
7. **Tap targets (A-02).** Breadcrumb links >= 24 px (`inline-flex min-h-6`); filter checkbox rows are full-width labels (whole row hit area,
   44 px); inline text links in the touched pages get `min-h-6`; primary controls 44 px on `pointer: coarse`.
8. **Misc.** N5: the card's brand link is a 24 px target and, on coarse pointers, not a separate target (the tap opens the product; keyboard and
   screen readers still reach the link). N8 covered by 2. N9 covered by 1. D-13 already fixed.

New tokens: none planned (the sheet backdrop uses `foreground/50` like the `Dialog`). If one is needed it is added, never renamed, and documented in `docs/contracts/theme-tokens.md`.

## Files

`apps/storefront/src/components/`: `site-header.tsx`, a new `header-search-toggle.tsx`, `cart-badge.tsx`, `account-link.tsx`, `product-purchase.tsx` (+ a new
`sticky-buy-bar.tsx`), `search-island.tsx`, `search-filters.tsx`, `search-results.tsx`, `cart-page.tsx`, `checkout-page.tsx`, `guest-order-page.tsx`,
`order-details.tsx`, `product-card.tsx`; `app/globals.css`; `messages/uk.json`, `en.json`; `packages/ui/src/breadcrumbs.tsx`, `checkbox.tsx` (additive);
pure logic in `src/lib` with unit tests; e2e `e2e/tests/mobile-ux.e2e.ts`; docs `apps/storefront/README.md`, `docs/files/storefront.md`, `CHANGELOG.md`, `docs/HANDOFF.md`.

## Risks

- Header first-chunk budget (pre-hydration forms e2e): keep the new markup a few short classes.
- Existing e2e selectors (filters toggle, order page, checkout summary, add-to-cart status text): run the whole suite.
- Two controls for one action (buy bar, sheet): the bar is hidden from assistive technology; the sheet is the same form, not a copy.
- `position: sticky` needs a tall parent: the bars are direct children of the page container or the form.

## Verification

Failing-first unit tests for the pure parts (filter count, bar visibility, focus trap order, summary text); e2e at 390/360/768: sticky header,
buy bar appears/disappears, toast, filter sheet open/apply/close/Escape and no-JS fallback, cart sticky summary, checkout summary toggle,
no horizontal scroll, tap-target sizes; hydration-error console check; then lint, format:check, typecheck, check:boundaries, check:docs,
check:env, check:licenses, storefront/ui/theme unit tests and the full storefront e2e suite on own throwaway services (exit codes read separately).
