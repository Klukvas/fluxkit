# Storefront UI round 4: owner feedback of 2026-11-13

Source: the owner's walk through the test server (`https://178-104-79-222.sslip.io/uk`) on 2026-11-13. Decisions on the open UX questions
come from a council (owner, 2026-11-11: decisions go to an agent council; red zones still need the owner): three read-only agents,
lenses UX and product, template changeability and architecture, accessibility / i18n / performance. Majority; the orchestrator breaks
ties and says why.

## Findings (checked on the test server and in the code)

| # | Owner's words (short) | Finding |
| --- | --- | --- |
| 1 | Footer: everything stacked left | `site-footer.tsx` renders the configured blocks as one column; columns side by side are documented as a code edit (`config/footer.ts` note, `docs/contracts/slots.md`). |
| 2 | Theme switch belongs in the header | It is the `themeSwitch` footer block (three buttons, `components/theme-switch.tsx`); the header has no such control. |
| 3 | Header categories scroll sideways | `navigation` block: up to 6 top-level categories in one scrolling row (`.fk-header-nav`; council decision 1 of 2026-11-11 only added a fade). |
| 4 | Third home card is "just a picture" | Not a bug: the coffee seed's third banner uses `layout: "image"` (text baked into the picture, `seeds/src/coffee/banners.ts`) to demo both layouts; next to two `card` banners it reads as broken. The admin can switch it to `card`. |
| 5 | Sort wants icons | Native `<select>` (`catalog-view.tsx`); a native option cannot show an icon. |
| 6 | Scrollbars are the browser's | No scrollbar styling (filter lists, panels, page). |
| 7 | Size chart on every product, even the gift card | `productOptionGuide = "size-guide"` (`config/shop-pages.ts`): by design every product with options gets the link; the storefront must not read option codes (AGENTS 2.3), and `ProductDetail` carries no product type. |
| 8 | Product page: left side scrolls, right side does not | `overscroll-behavior: contain` on `.fk-product-summary` swallowed every wheel event over the summary. Fixed on branch `fix/product-page-scroll` (CSS and an e2e regression test). |
| 9 | No add-to-cart on the card | `ProductSummary` has no variant id; cart lines need `variant_id` (AGENTS 2.3). |
| 10 | Sign-in as a modal, "needs thought" | Page `account/login` today. |
| 11 | A blog for SEO | Does not exist. |

## Council decisions

| # | Item | UX | Architecture | A11y/perf | Decision |
| --- | --- | --- | --- | --- | --- |
| 1 | Footer columns | grid, 4 groups | new optional layout field | CSS grid, `nav` + heading per group, 0 JS | DO: columns by default, no JS |
| 2 | Theme in header | icon button + 3-item menu | new header control `theme` | reuse `HeaderDisclosure`, CSS-driven icon, keep the `/theme` form | DO: header control; leaves the footer by default |
| 3 | Categories | button + panel | additive header option | `<details>` disclosure, link list, 0 new JS | DO: "Categories" disclosure replaces the scrolling row |
| 4 | Banner layout | (n/a) | data, not code | (n/a) | DO: seed the third banner as `card`; an `image` banner fills the row height next to cards |
| 5 | Sort icons | custom listbox | icon beside the control | links in a disclosure, decorative icons | DO: disclosure of sort links with icons (tie-break: zero JS and URL state kept; two of three accept it) |
| 6 | Scrollbars | global, tokens | existing tokens, no new token | `scrollbar-width` / `scrollbar-color` | DO: thin scrollbars from existing tokens |
| 7 | Size guide | per product type, off by default | needs an API field or schema | (n/a) | RED ZONE: owner choice (below) |
| 9 | Card add-to-cart | single-variant adds, others "Choose options" | needs `defaultVariantId` in `ProductSummary` | button as a sibling of the card link, client island | RED ZONE (API contract): owner choice |
| 10 | Sign-in modal | keep the page, add an intercepting-route modal | presentation only if the flow is unchanged | page stays canonical; `<dialog>` | LATER: after A and B; the page stays the canonical route |
| 11 | Blog | feature package, DB + admin | feature package, migration, storefront and sitemap extension point | (n/a) | RED ZONE: its own plan first |

## What to build now (no red zone)

### A. Header and footer (one branch: they share `docs/contracts/header-footer.md`, the first-HTML budget and the theme rule)

- **Theme control.** New header control `"theme"` (additive). A `HeaderDisclosure` whose icon follows the RESOLVED theme by CSS only (no
  JS state, no flash in System mode); the panel holds the existing three `aria-pressed` submit buttons and keeps the
  `<form method=post action=/theme>` fallback. Accessible name "Theme" / "Тема". The footer rule "`themeSwitch` listed while `showToggle`"
  becomes "listed in the footer blocks or the header controls" (a shared check in `layout/`). Template default: `theme` in the header
  controls, `themeSwitch` out of the footer blocks.
- **Categories picker.** An additive option of the `navigation` block (for example `navigation.display: "row" | "picker"`, omitted =
  `row`, so existing forks keep their header). In `picker` mode a disclosure "Categories" / "Категорії" (visible label and chevron) opens
  a panel: top-level categories with their children, in columns, plus the configured links; plain links, no `role="menu"`; Escape and an
  outside click close it (the shared dismiss code). The category list is not rendered twice. The phone keeps the existing menu. Template
  default: `picker`.
- **Footer columns.** An additive optional footer field (for example `layout: "stack" | "columns"`); the implementer states which
  default keeps the contract additive. Columns: each link group a `<nav aria-labelledby>` with a visible heading (new i18n keys, both
  locales), contacts its own column, copyright and "powered by" in a bottom row; 2 columns on a phone, 4 from `lg`.
- Docs: `docs/contracts/header-footer.md` (additive rows), `docs/customization.md` where it covers these, `CHANGELOG.md`, the comments in
  `config/header.ts` and `config/footer.ts`. Tests: the layout specs, the header/footer default checks, the first-HTML budget, e2e for the
  keyboard flow (Tab, Escape, focus return) of both new disclosures.

### B. Catalog toolbar and scrollbars (one branch)

- **Sort.** The native select becomes a disclosure whose summary shows the current sort's icon and label; the panel lists the sorts as
  links (`aria-current` on the chosen one), each with a decorative icon (new icons in `components/icons.tsx`, `.fk-icon`, no new
  dependency). URL parameters unchanged; works before hydration; 44 px rows.
- **Scrollbars.** `scrollbar-width: thin` and `scrollbar-color` from existing tokens (no new token, so no theme-token contract change), on
  the page and on scrollable panels; thumb contrast at least 3:1 in both themes.

### C. Home banners (small)

- `seeds/src/coffee/banners.ts`: the third banner becomes `card` with a title and text (both locales) and a new wordless picture
  (`banner-equipment.webp`, same studio look as the other two); the two worded pictures are removed. Branch `fix/home-banner-row`.
- Not done (deviation, orchestrator): stretching an `image` banner to the row height next to cards. `object-cover` in a taller frame
  crops the sides, which cuts the words an `image` banner has drawn in; a mixed row stays the admin's choice. The test server keeps
  its data until the admin switches the banner (`/admin/banners`) or the database is re-seeded from scratch.

## Owner decisions needed (red zones, AGENTS.md section 14)

1. **Size guide (item 7).** Recommended: a nullable "guide page" on the product type (migration up and down, admin field, `ProductDetail`
   gets it), off by default; the coffee seed sets none, an apparel preset sets `size-guide`. Alternative: expose the product type slug in
   `ProductDetail` (API only) and list types in the storefront config. Interim with no contract change: `productOptionGuide = null`.
2. **Card add-to-cart (item 9).** Recommended: additive `defaultVariantId` in `ProductSummary` and the card model; a button for
   single-variant in-stock products, a "Choose options" link otherwise.
3. **Blog (item 11).** Recommended: feature package `packages/features/blog` (flag `blog`), one table, store and admin API, an admin
   editor (sanitized Markdown), storefront `/blog` and `/blog/[slug]` with metadata, JSON-LD `BlogPosting`, sitemap entries through a new
   extension point. Its own plan and an independent review before any code.

## Owner answers (2026-11-13, in chat)

- Size guide: the recommended option, a nullable guide page on the product type (migration and API change approved). Branch
  `feature/product-type-guide-page`, its own short plan `docs/plans/2026-11-13-product-type-guide-page.md`.
- Card add-to-cart: the recommended option, additive `defaultVariantId` in `ProductSummary` (API contract change approved). Branch
  `feature/card-add-to-cart`.
- Header and footer defaults: the new template look (categories picker, theme control in the header, footer columns) is the owner's own
  request of 2026-11-13 in chat. It changes the default look a fork gets when it never edited `config/header.ts` / `config/footer.ts`
  (independent review, major 1); the CHANGELOG and a note in `docs/migrations/` say how a fork keeps the old look.
- Blog: write its plan and have it reviewed first. Branch `docs/blog-plan`, `docs/plans/2026-11-13-blog.md`.

## Verification

Each branch: `pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `test` (storefront specs), `check:docs`; e2e and the visual
comparison in CI (on the owner's machine the local Postgres and Redis ports are taken by another project's containers). The visual
changes are intended: each PR lists them in `.visual/exceptions.json` as `apps/storefront/e2e/README.md` describes.
