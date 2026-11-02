# Storefront UI polish (2026-11-02)

Status: asked by the owner through the orchestrator after clicking through the shop locally (2026-11-02). Branch `feature/storefront-ui-polish`. No PR is opened by the implementing agent.
Goal: the header, account pages, catalog filters, loading states, quantity steppers and checkout phone field feel finished, in `uk` and `en`, without touching payment, order or API code.

## Owner decisions (2026-11-02)
1. **Account navigation:** an account ICON in the header with a dropdown menu (guest: Sign in, Register; customer: My orders, My account / Profile, Privacy and data ("Your data"), Sign out). On the account pages themselves: a side menu on desktop, tabs on mobile.
2. **Phone input:** `libphonenumber-js` (new runtime dependency of `apps/storefront` only, approved by the owner). Details below.
3. **Payment method choice** (online vs cash on delivery) is NOT in this task (a separate later plan). No payment or order code is touched.

## What exists (checked before building)
- Header: `components/site-header.tsx` (server) with a `flex-wrap` row of the logo, category links (`layout/navigation.ts`), the search box island, `LocaleSwitcher` (a text link per locale), `CartBadge` (text "Cart" plus a neutral badge) and `AccountLink` (text). The README's known limit "the header has no link to the order history; a menu is a later design decision" is this task.
- Tokens: `--fk-color-danger` exists; no foreground token for text ON a danger fill. `packages/theme/src/contrast.spec.ts` scans every class string, so a new pair must be listed.
- Account pages: every protected page goes through `components/account-gate.tsx`; the overview has buttons to the orders, profile and "Your data".
- Cart: `components/cart-page.tsx` keeps a draft quantity and an "Update" button; `lib/cart-store.ts` applies server answers only (numbered, newest wins) and reports a failed write in its shared `failure`.
- Filters: `components/search-island.tsx` (`SearchFilterForm`, GET form, works without a script) and `components/search-filters.tsx` (server markup, one submit button at the bottom).
- Loading: `(site)/loading.tsx` (generic `LoadingView`), skeletons in the cart, checkout, account gate, orders, order page, header badge and account link. The `(catalog)` routes have NO `loading.tsx` by decision (real 404s, `route-structure.spec.ts`).
- Phone: the API normalizes with `normalizePhone` (`packages/core/src/orders/contact.ts`: optional `+`, 7 to 15 digits; stored as `+digits` or `digits`; DB check `^\+?[0-9]{7,15}$`). E.164 (`+380501234567`) is accepted as is; nothing on the server is loosened.
- No `@axe-core/playwright` (MPL-2.0, not approved, HANDOFF section 4): a11y is checked with roles, names and states.

## Decisions (agent, under the standing grant)
- **Header layout:** one row of controls, `flex-nowrap`. From `xl` (1280) the category links are inline (a horizontal list that scrolls instead of wrapping when a shop has many or long category names; focus scrolls a link into view). Below `xl` they move into a "Menu" disclosure. At `lg` and up the search box sits in the row (`min-w` so the placeholder is never cut). Below `lg` (mobile) the search box is a full-width second row under the control row (one row cannot hold a usable search box at 390 px; it is not truncated).
- **Disclosures are `<details>`/`<summary>`** (menu, language, account): they open and close without a script (progressive enhancement, like the rest of the storefront); a small client hook closes them on Escape (focus back to the summary), on a click outside and on navigation.
- **Flags:** inline SVG in the component? No: static SVG files under `apps/storefront/public/flags/` (`uk.svg`, `en.svg`, chosen per locale in `src/config/locale-flags.ts`), rendered as decorative `<img alt="">` (flag colours are content, not theme, and stay out of the component class strings; emoji flags do not render on Windows). The text label (the language's own name) stays i18n and is the accessible name.
- **Cart icon:** an inline SVG icon (stroke `currentColor`), the count in a round badge `bg-danger text-danger-foreground`, rendered only when the count is above 0. Accessible name "Cart, N items" / "Cart, empty" (plural forms), a polite live region announces changes.
- **New token** `--fk-color-danger-foreground` (light `#ffffff`, dark `#0b1020`) with Tailwind `text-danger-foreground`; contrast pair `danger-foreground on danger` at 4.5:1 in both themes; email theme guard lists it as not used in mail. Additive (minor) change of the theme-token contract; `docs/contracts/theme-tokens.md` updated.
- **Account pages navigation:** `AccountGate` renders an `AccountNav` beside every signed-in account page: Overview, My orders, Profile, Privacy and data. It is a labelled `nav` of links with `aria-current="page"` (navigation, so links and not ARIA tabs): a vertical side menu from `lg`, a horizontal scrolling tab bar below it. "Your data" keeps its route and behaviour; only its menu label becomes "Privacy and data".
- **Sign out from the header menu** uses the same account-store `logout` as the overview (moved into a shared hook), then goes home.
- **Filters "Apply" popover:** `SearchFilterForm` watches `change`/`input` events of its own fields; when the form differs from what the page was rendered with, a small "Apply filters" submit button floats next to the row of the changed control (absolutely positioned, inline end of the form, so nothing shifts) and stays while changes are pending; it disappears when the form equals the rendered state again. The bottom button stays. No script: unchanged (plain GET form). Pure logic (`lib/filter-draft.ts`: dirty check, offset) is unit tested.
- **Availability filter (C ii), finding:** the documented semantics, not a bug. `inStock` is a VARIANT-level facet (`docs/api/search.md` "variant facets (`inStock`, options...)", ADR 0034 decision 4, AGENTS.md 2.3 "filters operate on variants and group results by product"): `inStock:false` returns products with at least one out-of-stock variant. Live evidence (2026-11-02, the shared stack): `GET /store/search?f=inStock:false` returns `demo-adjustable-wrench` (`out_of_stock`) and `demo-t-shirt` (`in_stock`); the T-shirt's variant `DEMO-T-SHIRT-RED-L` is `out_of_stock`, the other eight are in stock. UI made honest, API unchanged: the facet values read "Has options in stock" / "Has options out of stock" (uk: "Є варіанти в наявності" / "Є варіанти, яких немає"), and with `inStock:false` selected a card whose product is not out of stock says "Some options are out of stock".
- **Quantity stepper:** `QuantityInput` (`@fluxkit/ui`) gets a fixed 44 px height, centred tabular digits and no native spin buttons; labels and min/max unchanged.
- **Cart quantity autosave:** the "Update" button goes. `lib/quantity-autosave.ts` (pure, timers injected): changes are debounced 500 ms; one request per line at a time; changes made while a request runs are sent after it (no lost update); the shown number is the draft until the server answers (optimistic display only: the store still applies server answers only, so price, total and stock are always the server's); a failure restores the server's quantity and shows the reason inline on the line (not in the page alert: `setQuantity` gets an option to not report the failure in the shared state); a per-line "Saving..." state with `aria-busy`.
- **Phone field:** `libphonenumber-js/min` (the small metadata build). The default country comes from the shop config (`checkoutConfig.phoneDefaultCountry`, `UA`); typing is shown in the national format (`AsYouType`) when the caret is at the end and the text grew (no reformat while deleting or editing in the middle, so the caret never jumps); on submit the number is checked (`validatePhoneNumberLength`, `isValidPhoneNumber`) with friendly per-field texts in uk and en, and the body carries E.164 (`+380...`). A number that cannot be checked is not sent. A prefilled account phone is shown formatted.
- **My orders bug (B):** reproduced and root-caused before any fix, see "Findings".

## New dependency (decision 2)
- `libphonenumber-js` **1.13.15** (published 2026-10-08), exact pin, `apps/storefront` `dependencies` only. Licence **MIT** (in the strict list; `pnpm check:licenses` checked). No dependencies of its own. Installed size 10.2 MB unpacked (952 files, all metadata builds); the client imports only `libphonenumber-js/min` (the `min` metadata, about 80 KB raw), measured in the bundle after the change. Why: phone grammar and lengths per country are data that changes; writing our own mask for UA first and the EU/US later would be a maintained copy of that data. Alternatives: a hand-written UA mask (UA only, no validation data), `react-phone-number-input` (pulls this library plus UI and styles). Recorded in `docs/dependencies.md`; THIRD_PARTY_NOTICES comes from `pnpm notices`.

## Skeleton audit (D)
| Page / section | Before | After |
|---|---|---|
| Home `(site)/page.tsx` | `(site)/loading.tsx`: spinner + two bars | kept (route-level; shape close enough: hero then sections) |
| Catalog, category, product, search `(catalog)` | none, by decision (no `loading.tsx` so `notFound()` answers a real 404) | unchanged by decision; the filter/sort transitions already dim the results with `aria-busy`; the filter panel is now `aria-busy` too |
| Facets | rendered with the page | `aria-busy` while a filter change loads |
| Cart | spinner + two plain bars | line-shaped skeletons (image + text rows), same height as a line |
| Checkout | spinner + bar; delivery options skeleton | kept |
| Account pages (gate) | spinner + bar | kept; the account nav appears with the page |
| My orders list | spinner + one bar | three order-card skeletons |
| Order page (guest and account) | spinner + bar | kept |
| Header cart count, account | fixed-size skeleton slot | icon kept, count skeleton in the same slot (no shift) |
All skeletons use the `Skeleton` of `@fluxkit/ui` (`bg-muted`, `motion-reduce:animate-none`) inside an `aria-busy` container with a spinner label for assistive technology.

## Files
- Header: `components/site-header.tsx`, `header-menu.tsx` (new: disclosure + dismiss hook), `cart-badge.tsx`, `account-link.tsx` (account menu), `locale-switcher.tsx`, `icons.tsx` (new, decorative SVG), `config/locale-flags.ts`, `public/flags/*.svg`, `layout/navigation.ts`.
- Account: `account-gate.tsx`, `account-nav.tsx` (new), `account-overview.tsx`, `use-logout.ts` (new), `account-orders.tsx`, `profile-forms.tsx`, `account-data.tsx`/`account-data-views.tsx` (Container only).
- Filters: `search-island.tsx`, `lib/filter-draft.ts` (new), `search-results.tsx`, `product-grid.tsx`, `product-card.tsx`.
- Cart and stepper: `packages/ui/src/quantity-input.tsx`, `cart-page.tsx`, `lib/quantity-autosave.ts` (new), `lib/cart-store.ts` (report option), `lib/cart-handlers.ts`.
- Phone: `lib/phone.ts` (new), `config/checkout.ts`, `checkout-page.tsx`, `lib/checkout-form.ts` (prefill format).
- Theme: `packages/theme/src/tokens.css`, `tailwind.css`, `contrast.spec.ts`, `email-theme.spec.ts`, `docs/contracts/theme-tokens.md`.
- Messages `uk.json`, `en.json`; docs `apps/storefront/README.md`, `docs/files/storefront.md`, `docs/dependencies.md`, `CHANGELOG.md`, `docs/HANDOFF.md`.

## Risks
- `<details>` dropdowns: screen readers announce the summary as a button with expanded state in Chromium and Firefox; Safari/VoiceOver not checked here.
- The autosave changes the cart page's interaction model (an e2e spec that pressed "Update" must change).
- The phone check rejects numbers the API would accept (the API takes 7 to 15 digits of anything); a shop selling abroad sets the default country or types `+`.
- Disk space in the sandbox is nearly full (shared by several agents); a full `next build`/e2e run may not be possible.

## Verification
- Unit (Vitest): autosave (debounce, rapid clicks, error rollback, in-flight changes), filter draft, phone (format, validate, E.164, messages), cart store report option, header and account views (roles, names, `aria-current`, badge only above 0, no hardcoded text), contrast of the new token, a guard for the My orders bug class.
- `pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:docs`, `check:env`, `check:licenses`, storefront tests, the storefront e2e specs affected when feasible.
- Own `next dev` on :3011 against the shared stack's API: Playwright screenshots before/after, 1280, 1024 and 390, uk and en (scratchpad `ui-polish-shots/`), console errors captured.

## Findings
- **My orders (B), root cause:** `OrderList` in `components/account-orders.tsx` passed `useSyncExternalStore` a `getSnapshot` that returned a NEW object literal (`store?.getState() ?? { status: "loading" }`) on every call until the store existed, and a `getServerSnapshot` that did the same. React (development) checks that two calls return the same value and reports "The result of getSnapshot should be cached to avoid an infinite loop" as a console error, which `next dev` shows as an error overlay on the page. Reproduced in Chromium against the shared stack (signed-in customer with order RVMP-ZT29, both locales; console.error before, none after). The other islands use module constants. Fix: one module constant for the loading state; regression guard: a source test that fails on an object literal inside a `useSyncExternalStore` snapshot argument (failing on the old code), plus a unit test of the snapshot helper.
- **Under `http://127.0.0.1:<port>` the islands of `next dev` never hydrate:** Next 16 blocks its dev resources for a host not in `allowedDevOrigins` (logged as "Blocked cross-origin request ... /_next/hmr"); the page shows only skeletons. `localhost` works, and `pnpm demo:up` and the README print `http://localhost:3001`; but the shared agent stack's notes (and anyone typing `127.0.0.1`) get a page that never hydrates. Reported, not fixed (a `next.config.ts` change: `allowedDevOrigins`).
