# Plan: storefront mobile UX (review batch "mobile")

Status: implemented (see "Results"), not independently reviewed; branch `feature/storefront-mobile-ux` (from `origin/main` `55f53ff`). Storefront only: no API, schema or dependency change.
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

## Results (2026-11-03)

Measured the same way as the before-state (`next dev` on localhost, demo seed, touch emulation):

| Item | Before (390 uk) | After (390 uk) | 360 uk after | 768 uk after |
|---|---|---|---|---|
| Header | 113 px, `static`, gone after scrolling | 61 px, `sticky` (top 0 after scrolling 800 px) | 61, sticky | 61, sticky |
| PDP add button | y 931, 180x40, no bar | y 957, 358x48; bottom bar with price, values, stepper and a 358x48 "Add to cart" while it is out of view | 328x48 | 180x44 (two columns, no bar) |
| Catalog filters | inline toggle; unusable without a script | "Filters (N)" next to the sort, full-screen sheet; `:target` without a script; groups collapsed after the first two | same | same (sheet below 1024) |
| Cart | SKU 3 lines, Remove 42 px, checkout at y 1207 | SKU 1-2 lines (232 px column), Remove 44 px, total and checkout in a sticky bottom bar | SKU 2 lines (was 4) | unchanged layout, not sticky |
| Checkout | summary y 1669, submit y 1597 (40 px), page 2394 | collapsed summary y 447 (below the sign-in prompt and the stock alert of this cart), sticky submit 358x48 with the total, page 2271 | summary y 471 | summary y 201, submit 736x48 |
| Order page | "Save this link" 324 px above the heading; h1 wraps (72 px) | heading first, one line (32 px); callout 218 px (en 198) under the status | | callout 178 px |
| Breadcrumb links | 20 px | 44 px (coarse pointer) | 44 | 44 |
| Card brand link | 87x20, separate target | 87x24, `pointer-events: none` on a coarse pointer | | |
| Horizontal scroll | 0 | 0 on home, catalog, PDP, cart, checkout, order, search | 0 | 0 |

Screenshots: scratchpad `mobile-shots/after-*.jpg`.

Copy changes (D-12; the same facts, shorter):
- `order.saveLink.description` en: "This link is the only way to open your order again. Keep it private: anyone who has it can see and cancel the order." -> "Only this link opens your order again. Keep it private: anyone who has it can see and cancel the order." (uk likewise).
- `checkout.payment.note` en: "...After you place the order, the shop will contact you to arrange payment. An unpaid order is held for a limited time; you will see until when on the next page." -> "No payment is taken on this site: after you order, the shop will contact you to arrange payment. An unpaid order is held for a limited time (until when is on the next page)."; `checkout.payment.noteOnline` likewise (keeps "does not take or store card details").
- `order.payment.awaiting` en: "...If the order is not paid by {time}, it is cancelled automatically." -> "...An order not paid by {time} is cancelled automatically."
- `payment.return.noEntry.body`: the example in parentheses, "sign in to your account" instead of "open the order in your account" (uk "особистий кабінет" -> "акаунт", review D-11).

Deviations from the design above:
- The buy bar's "Added" toast hides after 8 s on phones only (unless focus is inside); from `md` it stays in place as before.
- Breadcrumb links are 44 px on a coarse pointer (not only 24 px): they are the main way up from a product on a phone.
- The language summary shows only the flag below `sm` (the logo was cut otherwise); its accessible name is unchanged.
- The order page's empty cancel status region takes no room (D-10 "uneven gaps").
- Desktop side effects (kept small): facet groups are collapsible at every width (the first two open), the cart's line total sits in the controls row, the checkout summary is first in the page order (still in the right column), the order heading is `text-2xl` below `sm` only.

Verification: lint, format:check, typecheck, check:boundaries, check:env, check:licenses, check:docs exit 0; storefront 1736, ui 181, theme 68 unit tests pass; storefront e2e 110 passed, 4 skipped (the search-off cases, as on `main`) on throwaway Postgres 16, Redis and Meilisearch.
Failing first: `lib/mobile-ux.spec.ts` failed before `lib/mobile-ux.ts` existed; `e2e/tests/mobile-ux.e2e.ts` run against the build of `main`: 9 of 12 failed (header 113 > 64, no search icon, no buy bar, no Filters link, checkout link not in view, no summary toggle, order heading 72 px, breadcrumb 20 px), the 3 overflow/hydration guards passed (no regression to catch there).
Not verified: iOS Safari (safe-area insets, sticky bars with the dynamic toolbar), Firefox, a real screen reader, a real phone.
