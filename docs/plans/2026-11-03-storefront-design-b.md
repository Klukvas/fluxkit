# Plan: storefront desktop design, batch B (home page and dark theme)

Status: implemented (see "Results"), not independently reviewed; ADR 0045 proposed (owner and legal confirmation); branch `feature/storefront-design-b` from `origin/main` `34c98e6` (PR 217 merged). Storefront, `packages/ui`, `packages/theme`
and one admin spec only: no API, schema, dependency, environment variable or public config change.
Source: designer review of 2026-11-02 (scratchpad `ux-review/findings-designer.md`): D-18 (wireframe home), recommendation 4 (image-led,
configurable home and category composition) and the dark-theme part of recommendation 5 ("make the existing dark theme reachable").

## Before-state (measured 2026-11-03 on `34c98e6`, `next dev` on localhost, demo seed, Chromium; scratchpad `design-b-shots/before-*`)

| Item | 1280 uk/en | 1024 uk/en | 768 uk/en | 390 uk / en |
|---|---|---|---|---|
| Home sections (height px) | hero 232, categories 170, new products 920 | 232 / 170 / 856 | 232 / 170 / 1204 | 232 / 276 / 1372 (uk), 232 / 248 / 1348 (en) |
| Page height | 1588 | 1524 | 1916 / 1872 | 2234 / 2138 |
| Hero | text only: h1 "Ласкаво просимо" / "Welcome", one placeholder sentence, one button; no image | same | same | same |
| Category tiles | 3 grey cards with the name only (no image slot, no count) | same | same | 2 per row |
| Products | 8 cards; the first 4 images `eager` at y 552 (below the 800 px fold at 1280) | same | 3 eager in row 1 | eager at y 658/969 |
| Headings | h1, h2 x2, h3 x8 (one h1) | same | same | same |
| JSON-LD on home | none | none | none | none |
| Theme | `<html data-theme="light">` hard-coded in `app/[locale]/layout.tsx`; no toggle; `color-scheme: normal` (native controls and scrollbars always light) | same | same | same |
| Emulated `prefers-color-scheme: dark` | ignored: `data-theme` stays `light`, body `rgb(255,255,255)` | same | same | same |
| Dark tokens | exist (`[data-theme="dark"]` in `tokens.css`, contrast-tested) but unreachable; forcing the attribute by script: body `rgb(11,16,32)`, PDP, cart and checkout readable, product images keep their own light background | | | |
| Console errors (no 401) | 0 | 0 | 0 | 0 |

Data the home can use without an API change (`packages/api-client/src/types.ts`, `docs/api/catalog.md`): `GET /store/categories` gives the tree
(`id, slug, name, description, children`; NO image, NO product count); `GET /store/products` is ordered by `publishedAt` descending (= newest),
filterable by `category` and `brand`, `limit` up to 100. So: category tiles get an optional image from config (local static file) and a
subcategory count from the tree (real data); a product count per category would be one extra request per tile (N+1): not done.

## Design decisions

1. **Home as typed config** (`apps/storefront/src/config/home.ts`, replaces `src/layout/home.ts`; internal storefront config like
   `trust-bar.ts`, NOT a public contract): an ordered list of sections, each `{ kind, id, ... }`:
   - `hero`: `headlineKey`, optional `sublineKey`, optional `cta { labelKey, href }`, optional `image { src, width, height, altKey | null }`
     (a local file under `public/`; `altKey: null` = decorative).
   - `categories`: `titleKey`, `limit`, optional `images` by category slug. Without an image a tile is the name on a `muted` token surface
     with a decorative icon, plus "N subcategories" (plural) from the tree.
   - `productRow`: `titleKey`, `limit`, `source { sort: "newest", category?, brand? }` (`GET /store/products`: newest is its order),
     optional `viewAll { labelKey }` (links the catalog or the category).
   - `trust`: the existing `TrustBar` with `trustBarItems` (hidden when the list is empty), a visually hidden `h2`.
   - `richText`: optional `titleKey`, `bodyKey` (paragraphs split on blank lines; plain text, no HTML).
   An unknown `kind` fails `tsc` (discriminated union + a `never` check in the renderer); ids must be unique (test).
   Default (demo, `TODO(fluxkit)`): hero with a neutral generated illustration (`public/home/hero.svg`, ~2 KB, own background), categories (6),
   newest products (8), trust bar, a short "about the shop" text. A category-filtered row is supported and tested but not in the default
   (demo category slugs do not belong in template config).
2. **Rendering and states.** The page stays per request with the 60 s data cache (no change to `store-data`). The hero is static and renders
   at once; each data section is its own `Suspense` boundary with a skeleton of the same box sizes (no layout jump), loaded in parallel.
   Empty data (no categories, no products) hides the section. A failed read (API down without a cached answer, an unexpected response) is
   logged in full and shows a short inline error for that section only (the rest of the page renders); Next's own control-flow errors are
   re-thrown (`unstable_rethrow`). Today the whole page fails instead.
3. **SEO and a11y.** One `h1`: the first hero when it is the first section, otherwise a visually hidden `h1` (site name) and every hero is an
   `h2`; sections are `section`s labelled by their `h2`, product titles `h3`. Hero image: `width`/`height`, `priority` only when the hero is
   first (LCP); product images below the fold `lazy` (the first row of a row that is not near the top is no longer `eager`). No JSON-LD on the
   home: `WebSite` without a search action adds nothing, `Organization` needs the client's identity (not in the template). Reduced motion: the
   skeleton pulse stops (existing `Skeleton`), no new animation.
4. **Category page header.** `src/config/category-page.ts`: `{ header: "plain" | "banner", defaultImage, images by slug }`. `banner` renders the
   same `Hero` component (h1 = category name, subline = its description, optional image); default `banner` without images (a `muted`
   surface; owner to confirm). The catalog page keeps the plain header.
5. **Dark theme.** The dark values already exist for every colour and shadow token (`[data-theme="dark"]`, contrast-tested). Added:
   - **System mode, opt-in:** `@media (prefers-color-scheme: dark) { [data-theme="system"] { ...the dark colour and shadow values... } }` in
     `tokens.css`. Only a page whose `<html>` says `data-theme="system"` follows the OS; the admin keeps `data-theme="light"` and is not
     affected (no `:root` rule inside the media query). A test keeps the system block equal to the dark block.
   - **`color-scheme`** on each theme selector (`light`, `dark`, and `dark` inside the media query) so native controls, scrollbars and the
     select popup follow the theme.
   - **No new colour token** (all components already use role tokens; dark values exist). If a component turns out unreadable in dark the fix
     is a value, not a name. The contrast test is reorganised to read the light, dark and system blocks by selector (it split the file on the
     dark selector before), so the existing pair list runs for both themes and the system block.
   - **Config** `src/config/theme.ts`: `{ defaultMode: "system" | "light" | "dark", showToggle: boolean }`, default `system` + toggle shown.
   - **Cookie, server-rendered:** `fluxkit_theme` (`light|dark|system`, `Path=/`, one year, `SameSite=Lax`, `Secure` on https, NOT HttpOnly so the
     toggle can write it). The root layout reads it with `cookies()` and renders `<html data-theme>` from it (else the default), so the first
     paint is right: no inline script, no flash. With `showToggle: false` the cookie is ignored. No-JS: the system mode still follows the OS
     (media query); the toggle is a POST form to a small route handler `app/theme/route.ts` (sets the cookie, `303` back to a checked
     same-site path), enhanced with JS to switch in place (cookie + attribute, no reload).
   - **Toggle** in the footer (decision: the header is one row at 390 px and has a markup budget, `shell.spec.tsx`): a labelled group of
     three buttons Light / Dark / System with `aria-pressed`, keyboard native (Tab, Enter/Space), icon + text.
   - Privacy: the storefront then sets ONE cookie (a preference set only on the shopper's explicit choice, no personal data). The cookie
     statement table gets the row, `docs/privacy/README.md` section 5 is updated, and the storefront's no-cookie source guard becomes an
     allow-list of exactly the two files that may write `fluxkit_theme`. Owner/legal to confirm the reading as strictly necessary.
   - Mail stays light (`email-theme.spec.ts` reads the light block; mail sets `color-scheme: light`): verified, unchanged.

## Files

- `packages/theme/src/`: `tokens.css` (system block, `color-scheme`), `index.ts` (`themeModes`, `ThemeMode`, additive), new `token-blocks.ts`
  (parser used by the specs), `contrast.spec.ts`, `theme.spec.ts`, `email-theme.spec.ts`; `docs/contracts/theme-tokens.md`, `docs/files/theme.md`.
- `packages/ui/src/`: new `hero.tsx` (dumb, token-styled), `index.ts`, specs; `docs/files/ui.md`.
- `apps/storefront/src/`: `config/home.ts` (moved from `layout/home.ts`), `config/category-page.ts`, `config/theme.ts`; `lib/theme-mode.ts`,
  `lib/home-data.ts` (per-section loaders, replaces `loadHomeData`), `lib/catalog-pages.server.ts`; `components/home-sections.tsx`,
  `components/theme-switch.tsx`, `site-footer.tsx`, `site-shell.tsx`, `catalog-view.tsx`, `catalog-search-view.tsx`, `icons.tsx`;
  `app/[locale]/layout.tsx`, `app/[locale]/(site)/page.tsx`, the category page, new `app/theme/route.ts`; `config/legal.ts` (cookie row);
  `messages/uk.json`, `en.json`; `public/home/hero.svg`; specs; `e2e/tests/design-b.e2e.ts`; `apps/storefront/README.md`, `docs/files/storefront.md`.
- `apps/admin/src/theme-isolation.spec.ts` (built CSS check), `turbo.json` (the admin test depends on its own build).
- `docs/privacy/README.md`, `CHANGELOG.md`, `docs/HANDOFF.md`.

## Risks

- `cookies()` in the root layout: every page is already per request (README "Rendering"), so no static page is lost; checked by the build table.
- 404 documents rendered before the first byte (`__next_error__`, README finding) carry no layout attributes: a dark-mode shopper may see the
  light theme on such a page until the payload renders. Measured in e2e and reported, not hidden.
- Moving `layout/home.ts` to `config/home.ts` and `type` to `kind`: internal config (not in `docs/contracts/`), forks that edited it re-apply
  their list (CHANGELOG note).
- `packages/theme` is shared with the admin: the new rules only match `[data-theme="system"]`; the admin's built CSS is asserted.
- Cookie and privacy statement change (see decision 5).

## Verification

- Failing first: the system-block and `color-scheme` tests against main's `tokens.css`; `theme-mode` unit tests on a stub; the admin
  built-CSS spec against a deliberately unscoped media rule; `design-b.e2e.ts` against main's code.
- Unit: theme (contrast both themes + system block, tokens, email), ui, storefront (config order, empty config hides a section, empty and
  error states, h1 rule, theme cookie parsing and route handler), admin (built CSS). Lint, format:check, typecheck, check:boundaries,
  check:docs, check:env, check:licenses.
- E2E (`design-b.e2e.ts`, full storefront suite on throwaway Postgres 16 / Redis / Meilisearch): sections in config order, server HTML
  carries `data-theme` from the cookie (no flash), system mode follows the emulated scheme, toggle by keyboard with `aria-pressed`, the
  no-JS form round trip, computed-colour contrast of key components in dark, layout at 1280/1024/768/390.
- After screenshots: `design-b-shots/after-*` (home 1280/1024/390 uk/en light and dark; product, cart, checkout in dark).

## Results (2026-11-03)

After-state (same tool and sizes as the before table; `next dev` on localhost, demo seed; screenshots scratchpad `design-b-shots/after-*`:
home 1280/1024/390 uk/en light and dark, product, cart and checkout in dark at 1280 uk):

| Item | 1280 uk/en | 1024 uk/en | 768 uk/en | 390 uk / en |
|---|---|---|---|---|
| Home sections (height px) | hero 461 (picture right), categories 337, new arrivals 812, trust 54, about 168 | 413 / 313 / 748 / 54 / 168 | 317 / 265 / 1096 / 54 / 168 | 477 (picture under the text) / 414 / 1264 (1240 en) / 102 / 216 |
| Page height | 2406 | 2270 | 2518 / 2474 | 3135 / 3067 |
| Images | hero `eager` + `fetchpriority=high` at y 133; product images all `lazy` (first at y 1060) | same (988) | same (844) | hero at y 313 |
| Headings | h1 (hero), h2 per section, h3 per product | same | same | same |
| Theme | `<html data-theme="system">` (default), `color-scheme: light`; with the cookie `dark`: `data-theme="dark"`, `color-scheme: dark`, body `rgb(11,16,32)` | same | same | same |
| Emulated `prefers-color-scheme: dark`, no cookie | body `rgb(11,16,32)` (was white) | | | |
| Console errors (no 401) | 0 | 0 | 0 | 0 |

Deviations from the plan:
- **Theme switch**: text buttons without icons and one class (`.fk-theme-option`): the footer is flushed with the shell before a late page
  section and counts against the pre-hydration budget (README, "Keep the header small"). With icons and utility classes the footer was 2.3 KB
  and `/en/account/register` was outlined (e2e `pre-hydration-forms` failed 2 of 2); with `.fk-nav-link` for the footer links (the header's
  class) it is 1.25 KB en / 1.41 KB uk, smaller than on main (1.70 / 1.82), pinned by `shell.spec.tsx`.
- **`LoadingView` is at least a screen tall** (not planned): when the page replaced the `(site)` loading view, the footer moved (CLS 0.261 in
  3 of 6 cold e2e runs, source `FOOTER`); now the footer starts below the fold (4 of 4 runs pass). Tried first and reverted: moving the home
  page out of `(site)` removed the shift but made the header search box lose typed text in 5 of 40 runs of the `search.e2e.ts` header tests
  (0 of 40 under `(site)`; also 5 of 40 with the sections awaited instead of streamed): text typed before the box hydrates is lost when the
  page hydrates with the shell. NOT measured on the catalog, category and product pages, which hydrate with the shell too (their header-search
  timing is the same race; the e2e tests type on the home page only).
- **Category tiles**: one row of skeletons (most shops show a few top-level categories); a "N subcategories" line (plural) from the tree.
- **Privacy**: the storefront's first cookie needed ADR 0045 (supersedes in part ADR 0033 decision 11), the cookie statement row and intro,
  `docs/privacy/README.md` and allow-list guards (`source-guards.spec.ts`, `security-headers.spec.ts`) instead of the "no cookie" guards.
- **Home page code location**: `src/config/home.ts` replaces `src/layout/home.ts` (`kind` instead of `type`); `loadHomeData` is replaced by
  per-section loaders in `lib/home-data.ts`; a second image path `LocalPicture` (files under `public/` named in the config only, guarded).

Found, not fixed (pre-existing, reported):
- `/uk/account/register` is outlined behind the loading view without a script (header 5.4 KB in uk): same with main's footer (measured by
  swapping main's `site-footer.tsx` in); the e2e test covers the en pages only.
- A 404 rendered before the first byte (`<html id="__next_error__">`) carries no `data-theme`; with a script it becomes dark after hydration,
  without one the page is empty (as before).
- The header search box loses text typed before it hydrates (see above).

Verification (each exit code read separately, final code `92e1f8c`): lint 0, format:check 0, typecheck 0, check:boundaries 0, check:docs 0,
check:env 0, check:licenses 0; unit theme 96, ui 204, storefront 1799, admin 1666 passed (admin includes `theme-isolation.spec.ts` on the
built CSS: the only `prefers-color-scheme` rule is `[data-theme=system]`, `index.html` keeps `data-theme="light"`). Full storefront e2e on
throwaway Postgres 16 / Redis 8 / Meilisearch: 142 passed, 4 skipped (`search-off`, by design). Failing first: theme specs against main's
`tokens.css` (2 files failed: no system block); `theme-isolation.spec.ts` against main's admin build (2 of 4 failed); `design-b.e2e.ts`
against main's build (11 of 12 failed; the light-contrast check passes on main, as it should); the footer budget (pre-hydration e2e 2 failed)
and the loading-view shift (3 of 6 runs) before their fixes. Mail stays light: `email-theme.spec.ts` reads the light block, the mail layout
sets `<meta name="color-scheme" content="light">` (unchanged).
Not verified: Safari and Firefox, a real screen reader, iOS Safari's `color-scheme`, admin e2e (admin unit tests and the built-CSS spec only),
the no-script theme switch on the guest order page (its `no-referrer` policy does not matter: the form sends the path), a production host
with https (`Secure` cookie flag tested in unit tests only).

Owner decisions: the token additions (`color-scheme`, the `system` block, `themeModes`; no new colour token); the default theme mode (`system`,
switch shown in the footer, not the header); the default home composition and copy (hero headline/subline/CTA kept from before, the hero
picture, the "About the shop" demo text with a visible `TODO(fluxkit)` marker, the trust bar on the home page); the category banner as the
default header; ADR 0045 and its legal reading (or `showToggle: false`).

