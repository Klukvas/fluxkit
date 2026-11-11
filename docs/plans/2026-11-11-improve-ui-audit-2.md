# Improve UI audit 2: the rest of the storefront and admin, with rendered evidence (2026-11-11)

Commit audited: `a3f78cd4` (`main`, after PR 261). Follows `docs/plans/2026-11-11-improve-ui-audit.md`, which covered the storefront purchase
funnel and the admin product editor from source only (both of its findings are fixed in PR 261). No product source was changed.

Status: the owner selected two items (2026-11-11). Plans: finding 1 `docs/plans/2026-11-11-improve-ui-account-orders-back-link.md`; the
admin sub-navigation targets from the spot checks below `docs/plans/2026-11-11-improve-ui-admin-subnav-targets.md`. Not implemented yet.

## How the evidence was gathered

- Stack: `infra/docker-compose.yml` (Postgres on host port 55432 because another local Postgres holds 5432; `DATABASE_URL` overridden in the
  shell, `.env` untouched), `db:migrate`, `seed` (coffee demo), `search:reindex`, API `start`, storefront `dev -p 3001`, admin `dev`.
- Screenshots (local only, not in the repo): Playwright 1.64.1 with Chromium, full page, storefront at 1280 x 800 and 375 x 812 (touch, 2x)
  in light and dark (`fluxkit_theme` cookie), admin at 1280 and 375 (light, the admin has no dark mode), locale `uk` for the storefront and the
  browser default (`en`) for the admin. The built-in browser pane was also opened on the storefront home.
- Measured in the browser: target sizes at 375 px, transitions and animations with `prefers-reduced-motion: reduce`, the checkout's
  double-submit guard (the order request intercepted and aborted, so no order was created).
- Full-page capture artifacts were not counted: lazy images below the fold render blank, and the phone buy bar (`position: fixed`) appears
  mid-page.

Surfaces covered:

- **Storefront:** home (uk, en), catalog, category, search (results and 0 results), product page outside the buy block, login, register,
  forgot password, signed-in account (overview, my orders, profile, privacy and data), shop page (delivery and payment), privacy and terms,
  404.
- **Admin:** start page, orders (list, detail), customers (list, detail), home banners (list, detail), dictionaries (attributes, options,
  product types, brands and categories with detail), catalog search (status, synonyms), admin users (list, detail), shipping (methods, method
  detail, carriers), email (status, messages, templates, template preview), payments to review, personal data (requests, lookup), audit
  log, help (index, article), my account, sign-in.

## Design language

- Audited surface: the storefront and admin surfaces listed above.
- Design sources: `docs/contracts/theme-tokens.md` (tokens, radius and heading roles, contrast pairs, admin section), `docs/contracts/header-footer.md`,
  `docs/contracts/branding.md`, `packages/ui/README.md`, `packages/ui/src/styles.ts`, `AGENTS.md` section 2.2; accepted plans
  `docs/plans/2026-11-03-storefront-design-a.md` (breadcrumbs per page family, card brand link) and `docs/plans/2026-11-06-storefront-shop-pages.md`.
  No `DESIGN.md` exists.
- Documented decisions: tokens only (colour, radius role, shadow, type scale); `textStyles` roles for storefront headings; text controls
  44 px (`controlBase`); breadcrumbs on catalog, category, product, search, account and shop pages; the card's brand link is no separate
  target on touch screens (`pointer-coarse:pointer-events-none`); every product with options links `productOptionGuide`; one
  `productPageNote` for every product; the admin owner role badge uses the `warning` tone on purpose (`apps/admin/src/areas/users/user-view.ts:52-55`).
- Governing owners and consumers: `@fluxkit/theme` and `@fluxkit/ui` for both apps; storefront account pages in
  `apps/storefront/src/components/{account-orders,profile-forms,account-data}.tsx`; admin page heading `PageHeading` (`apps/admin/src/views/status-views.tsx`)
  and area sub-navigation frames (`apps/admin/src/areas/*/*-frame.tsx`, identical class strings).
- Explicit exceptions: admin headings outside `textStyles` (known limit in `docs/contracts/theme-tokens.md`); the six `rounded-sm` uses in
  `radiusExceptions`; demo hero picture and demo copy marked `TODO(fluxkit)` in `apps/storefront/src/config/home.ts`.

## Findings

| # | Problem | Evidence | Proposed change | Scope | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Storefront: on "Мої замовлення" (`/uk/account/orders`) the link back to the account overview renders as plain body text (no underline) after the content, labelled "Мій акаунт", while the two sibling account pages show the same link under the page title, underlined, as "Назад до акаунта". Rendered at 1280 and 375, light and dark: with no orders it sits under the empty state and reads as a stray line of text. | Contract: direct contradiction in presentation and copy of one element (the link to `/account`) within one task (the signed-in account area). `apps/storefront/src/components/account-orders.tsx:184-186`: `<Link href={localizedHref(locale, "/account")} className={\`self-start ${focusRing}\`}>{t("nav.account.account")}</Link>`, the last child of the page. Siblings: `apps/storefront/src/components/profile-forms.tsx:271-279` and `apps/storefront/src/components/account-data.tsx:146-153`: inside `flex flex-col gap-2` right after the `h1`, `className="self-start underline underline-offset-4"`, text `t("account.profile.back")` ("Назад до акаунта" / "Back to my account"). Runtime: all three render inside the account layout (`AccountGate`, `account-nav.tsx`); seen on the signed-in pages of a test customer. | In `account-orders.tsx`, render the account link as the profile and data pages do: wrap the `h1` (line 111) and the link in `<div className="flex flex-col gap-2">`, the link right after the `h1` with `className="self-start underline underline-offset-4"` and the text `t("account.profile.back")`, and remove the link at lines 184-186. | Storefront "my orders" list (all states: loading, error, empty, list). | Medium |

No admin candidate survived the proof gate (see "Rejected" below).

## Improve first

Finding 1: it is the only supported finding, it removes a link that looks like stray text on the empty order list (the first thing a new
customer sees there), and the correction copies an exemplar used twice in the same area.

## Observations that need an owner decision (rendered, no binding contract)

These are visible in the screenshots but no documented decision says what is right, so they are not findings:

- Storefront header at 1280 px: the inline category list (`fk-header-nav`, `overflow-x-auto`) is cut at the search box mid-word ("Тру" for
  "Трубочки та розмішувачі") with no sign that it scrolls. Options (wrap, fade, a "more" menu, a lower `navigation.categoryLimit`) are a
  product choice.
- Storefront footer: the link lists and contacts start 8 px to the right of "Тема", the copyright and the page content (footer links carry
  `px-2` like `.fk-nav-link`, the other footer lines do not).
- Storefront legal pages (privacy, terms, cookies) have no breadcrumbs, while the shop pages listed next to them in the footer do
  ("Головна / Доставка й оплата"). The design plans decide breadcrumbs for every other page family but not for legal pages.
- Admin copy patterns: back links mostly read "Back to the …" but the order detail says "All orders" (uk is mixed: "Назад до …" and
  "До …"); list counters read "Orders 1 to 1 of 1", "1 to 3 of 3" or "0 shown. That is all of them." depending on the screen.
- Admin at 375 px: e-mail addresses in the admin users table wrap one or two letters per line (`break-all` in a narrow column).

## Rejected candidates (kept so a later audit does not repeat them)

- Size guide link and "Доставка й повернення" note on the digital gift card: documented rules (`productOptionGuide`, `productPageNote` in
  `apps/storefront/src/config/shop-pages.ts`).
- Light hero picture in dark mode: demo placeholder marked `TODO(fluxkit)`; a client replaces it.
- SKU and e-mail breaking mid-token in admin tables: `break-all` is applied on purpose to codes and addresses across the admin.
- Admin "Owner" badge in the warning tone: deliberate, with a code comment.
- Admin area sub-navigation active state: identical classes in all five frames; the rendered current item is bold and underlined everywhere.
- "All orders" vs "Back to the customers", counters, footer offset, header clipping, legal breadcrumbs: no binding contract (listed above).

## ui-quality spot checks (claims marked "already fine" in the ui-quality pass)

| Claim | Result | Evidence |
| --- | --- | --- |
| Double-submit guard on the checkout | Confirmed | Gift card in the cart, contact fields filled, the `POST /store/checkout` request held 4 s and then aborted. A click and a true double click each sent exactly 1 request; the button was `disabled`, `aria-busy="true"` and read "Оформлюємо замовлення" at 0, 50, 200 and 1000 ms; a second click was refused; after the failure the button came back enabled. A retry after a failure reuses the same `Idempotency-Key`. |
| Reduced motion | Confirmed for the storefront at rest | Elements with a running transition or animation at 375 px: home 18, catalog 25, product 4, cart 1 without the preference; 0 on each with `reduce`. Not measured: open menus, the filter sheet, the toast, the admin. |
| Touch targets ("Button md 40px, links min-h-11 / min-h-6") | Storefront confirmed, admin partly refuted | Storefront at 375: every non-inline control is at least 44 px except `Button` `md` (40 px, e.g. "Увійти") and the 24 px meta links (trust bar, product note), as the claim says; the card brand link has `pointer-events: none` on a coarse pointer and breadcrumbs are 44 px, as documented. Admin at 375: buttons 40 to 42 px, but the area sub-navigation links (Shipping/Carriers, Status/Messages/Templates, Requests/Look up by email, Status/Synonyms, the dictionaries) and the e-mail status table links are inline text about 18 px tall, below both `min-h-11` and `min-h-6`. Whether their spacing meets the WCAG 2.5.8 spacing exception was not measured. |
| Safe-area insets | Not checked | Needs a notched device or simulator. |

## Not checked

- Admin in dark mode (it has none) and admin in `uk` (captured in `en` only).
- Cart, checkout and order pages were covered by audit 1 and only used here for the double-submit check.
- Real devices, other browsers than Chromium, keyboard and screen reader passes (accessibility out of scope unless requested).
- Signed-in account pages with orders (the test customer has none); the order detail page in the account area.
- Interactive states beyond the double-submit test: open menus, dialogs, the filter sheet, banner drag and drop, form errors.
