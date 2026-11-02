# Plan: storefront desktop design, batch A

Status: proposed (first commit of the branch); branch `feature/storefront-design-a` from `origin/main` `d37bb4d` (PR 216 merged). Storefront, `packages/ui` and
`packages/theme` only: no API, schema, dependency, environment variable or public config change. Batch B (next): home page (D-18) and the dark theme switch.
Source: the designer review of 2026-11-02 (D-07, D-08, D-11, D-14, D-15, D-19 and recommendations 1, 3, 5), a11y nit A10; scratchpad `ux-review/`.

## Before-state (measured 2026-11-03 on `d37bb4d`, `next dev` on localhost, demo seed, Chromium, 1280x800 and 1024x800, uk and en)

| Item | 1280 uk | 1280 en | 1024 uk | 1024 en |
|---|---|---|---|---|
| Catalog card price rows (first row, y of the price) | 549 / 573 / 573 / 549 (24 px apart) | 549 / 549 / 573 / 549 | 549 x3 / 525 | 549 / 525 / 549 / 525 |
| Card hover | `box-shadow: none`, border unchanged (designer probe, re-checked visually) | same | same | same |
| "In stock" badge | on every in-stock card (7 of 8) | same | same | same |
| Card brand | underlined link under the title | same | same | same |
| PDP buy column | ends at y 560 (t-shirt), page 1251 px; description/specs full width under the gallery from y 830 | same | page 1187 | same |
| PDP SKU | "Артикул: DEMO-T-SHIRT-BLACK-M" beside the stock badge in the buy column | "SKU: ..." | same | same |
| PDP compare-at | "599,00 ₴ 799,00 ₴" struck, no discount cue | same | same | same |
| Trust / delivery info near the CTA | none | none | none | none |
| Breadcrumbs | catalog, category, PDP, search: yes; cart, checkout, account: no | same | same | same |
| Funnel indicator on cart / checkout / order | none | none | none | none |
| Search, 0 results | filter sidebar with an empty price form and "Apply filters" beside "Nothing found" | same | same | same |
| Header suggestions | title only (the API answers `{slug, title}` only) | same | same | same |
| Type sizes in `main` | 14, 16, 18, 20, 24, 30 px (Tailwind defaults, no tokens); tokens: colours, 3 radii, 1 shadow, 2 fonts | same | same | same |
| Logo link focus | browser default ring (no token ring) | same | same | same |
| Console errors (no 401) | 0 on 9 pages | 0 | 0 | 0 |

Already fixed by PRs 211/213/215/216 (re-measured): D-01 one price format and no hydration error; uk account term is "акаунт" everywhere in `uk.json`
(0 hits for "обліковий запис" or "кабінет"; D-11 done in PR 216); D-13 search placeholder not clipped; mobile items (PR 216).
Screenshots: scratchpad `design-a-shots/before-*.jpg` (catalog, category, two PDPs, search, 0 results, cart, checkout, login; 1280/1024 uk/en; 390 uk).

## Data available without an API change (checked in `packages/api-client/src/types.ts`)

- List items (`ProductSummary`): price range, availability (`in_stock | low_stock | out_of_stock`), brand, image, `publishedAt`. No compare-at, no
  variant or swatch count, no backorder flag. So: NO discount badge and NO swatch hint on cards; "new" would need a merchandising rule (a date window),
  not data: not added (owner decision if wanted).
- Product (`ProductDetail`): `variants[].price.compareAtAmount` and `availability` per variant: discount percentage and sold-out values on the PDP.
- Suggestions (`GET /store/search/suggest`): `{slug, title}` only: thumbnail and price in suggestions are NOT possible without an API change
  (reported, not done).
- Categories for the 0-result page: the header's top-level categories (`navigationCategories`, already loaded per request): "Browse categories",
  not "popular" (no popularity data).

## Design decisions

1. **Design kit tokens (D-19), additive** in `packages/theme/src/tokens.css` (both themes, same names), mapped in `tailwind.css` so the existing
   Tailwind utilities read them (no component has to change to follow a rebrand):
   - Type scale `--fk-font-size-{xs,sm,base,lg,xl,2xl,3xl,4xl}` and `--fk-line-height-{...}` -> `--text-*` and `--text-*--line-height`
     (values = today's Tailwind values, so nothing moves).
   - Spacing unit `--fk-space-unit` (0.25rem) -> `--spacing` (every `p-*`, `gap-*`, `m-*`).
   - Elevation `--fk-shadow-raised` (hover of a card), `--fk-shadow-overlay` (menus, toast, sticky bars) beside `--fk-shadow-card`.
   - Radius `--fk-radius-full` (pills: count badge, step numbers) beside sm/md/lg.
   - No new colour token: the discount badge is `danger-foreground` on `danger`, the current step `primary-foreground` on `primary`, the card
     hover border `border-input` (all pairs already tested). Names are role-based, so batch B's dark theme only sets values.
   - Guard (`design-guard.spec.ts`): font sizes, radii and shadows only from the token scale (`text-5xl`, `rounded-xl`, `shadow-md` and friends
     fail); `tailwind.css` maps every scale step to a token. Email theme: the new tokens are listed as not used in mail (mail keeps its px groups).
   - Components: `Button` sizes (`md` default = today, `lg` 48 px) and a hover state; `Badge` unchanged API; `Card` and inputs unchanged API
     (they already use tokens; the type and space tokens now drive them); shared text roles `textStyles` (page title, section title) in
     `packages/ui/src/styles.ts`, used by the storefront headings that repeat the same class string.
   - One focus ring: the logo link gets the ring token (A10); the option values already use `peer-focus-visible` with the ring token (checked by e2e).
2. **Price (D-08).** `PriceText` gains an optional discount badge (`text` visible, `label` spoken, `aria-hidden` on the visible part). The percentage
   is `discountPercent(amount, compareAt)` in `lib/discount.ts`: integer arithmetic, rounded DOWN (never overstate a saving), `null` when
   compare-at <= price, when the floor is 0 %, or for invalid input. TDD (money rule): failing tests first.
3. **Product card (D-07, D-15).** Whole-card link kept; hover/focus: `shadow-raised` and the `border-input` border (reduced motion: no transition);
   brand as a small muted meta line above the title (still a separate link for keyboards, no underline until hover); title clamped to 2 lines;
   price and the matching-options note in a bottom group pushed down (`mt-auto`) so prices align in a row; stock badge only for `low_stock` and
   `out_of_stock` (over the image corner), `in_stock` as visually hidden text; image box unchanged (`aspect-square`, placeholder).
4. **Product page (D-08, D-15).** From `lg` a 12-column grid: gallery and details left (7), summary right (5), `sticky top` (self-start). Summary:
   title, brand, price with discount, availability, option pickers, quantity, CTA, trust bar. SKU leaves the summary: first row of the
   specifications (`SelectedSku`, a client leaf that reads the island's selected variant from context). Description and specifications become
   `<details open>` sections with `h2` in the summary (`Disclosure` in `packages/ui`; work without a script). Sold-out values: struck and muted
   but still selectable (so the shopper can see the price), with spoken "out of stock"; the CTA reads "Out of stock" for such a variant and a short
   hint offers another option. No "notify me" or "similar products" (no data or endpoint). Thumbnails stay buttons (Tab, Enter/Space) with the ring.
   Mobile and 768 unchanged in order (gallery, summary, details); the PR 216 buy bar and toast and the PR 215 stock hints untouched.
5. **Trust bar (recommendation 1).** `src/config/trust-bar.ts` (typed, internal config like `checkoutConfig`): items `{icon, messageKey}`;
   default three generic demo items (delivery across the country, secure payment, easy contact) marked `TODO(fluxkit)`: demo copy, not
   promises; an empty array hides the bar everywhere. `TrustBar` (packages/ui, dumb) + `StoreTrustBar` (storefront, config + icons + i18n).
   Shown under the PDP CTA, under the cart summary and in the checkout summary column.
6. **Breadcrumbs and funnel (recommendation 3, D-11).** Account pages get breadcrumbs (Home / My account / section / order number) from a pure
   `accountTrail`; catalog, category, PDP and search keep theirs (BreadcrumbList JSON-LD already on category and PDP; not added to account pages,
   which are `noindex`). `StepIndicator` (packages/ui): an `ol` in a labelled `nav`, `aria-current="step"`, completed steps marked in text; below
   `md` the list is visually hidden and "Step 2 of 3: Checkout" is shown. Cart = 1, checkout = 2 (cart step links back), order page = 3 while the
   order awaits payment (guest and account order page).
7. **Search (D-14).** 0 results without selected filters: no filter sidebar and no empty sort; the empty state plus "Browse categories" links; the
   other-script hint stays. With selected filters the sidebar stays (the shopper needs it to widen the search).

## Files

- `packages/theme/src/tokens.css`, `tailwind.css`, `design-guard.spec.ts`, `email-theme.spec.ts`; `docs/contracts/theme-tokens.md`; `docs/files/theme.md`.
- `packages/ui/src/`: `button.tsx`, `price-text.tsx`, `option-picker.tsx`, `styles.ts`, new `trust-bar.tsx`, `step-indicator.tsx`, `disclosure.tsx`,
  `index.ts`, specs (`commerce.spec.tsx`, `no-hardcoded-text.spec.tsx`, new `design-kit.spec.tsx`); `docs/files/ui.md`.
- `apps/storefront/src/`: `config/trust-bar.ts`; `lib/discount.ts`, `lib/account-trail.ts` (+ specs); `components/product-card.tsx`, `product-purchase.tsx`,
  `product-details.tsx`, `trust-bar.tsx`, `checkout-steps.tsx`, `selected-sku.tsx`, `cart-page.tsx`, `checkout-page.tsx`, `order-details.tsx`, guest
  and account order pages, `account-nav.tsx`, `search-results.tsx`, `site-header.tsx`, `icons.tsx`; the PDP and search routes; `app/globals.css`;
  `lib/client-messages.ts`; `messages/uk.json`, `en.json`; specs and e2e `e2e/tests/design-a.e2e.ts`; `docs/files/storefront.md`, `apps/storefront/README.md`.
- `docs/HANDOFF.md`, `CHANGELOG.md` (one line: tokens added).

## Risks

- `packages/ui` is shared with the admin: `Button` hover and the token mapping reach it; values are identical, admin unit tests run.
- The sticky summary taller than the viewport would hide its end until the column ends (today's summary is about 600 px at 800 px height).
- Header markup budget (12.8 KB first chunk, `globals.css`): the logo ring goes into a `.fk-logo` class, not a long class list.
- Changing what a card shows for `in_stock` changes two existing e2e assertions (visible "In stock" on a filtered card): updated, not weakened
  (the text must still exist for assistive technology and must not be visible).

## Verification

- Failing first: `discount.spec.ts` (percent, rounding, compare-at <= price, zero, invalid), the guard additions, e2e of the new behaviour.
- Unit: theme (guard, contrast, tokens, email), ui, storefront, admin. Lint, format:check, typecheck, check:boundaries, check:docs, check:env,
  check:licenses. Full storefront e2e on throwaway Postgres 16 / Redis / Meilisearch.
- E2E (`design-a.e2e.ts`): card hover shadow and border (computed style), equal card heights and aligned prices by bounding boxes at 1280 and
  1024, sticky summary (its top stays while the page scrolls) at 1280, discount text on the PDP, SKU in the specifications, sold-out value
  struck and CTA label, trust bar near the CTA and in cart and checkout, funnel `aria-current="step"` on cart/checkout/order, "Step 2 of 3" at
  390, 0-result page without filters and with category links, account breadcrumbs, logo focus ring. Trust bar hidden when the config is empty:
  unit test (config is build-time data). Contrast: no new colour pair (existing pairs tested).
- After screenshots: `design-a-shots/after-*.jpg`, same pages and sizes; 390 sanity.
