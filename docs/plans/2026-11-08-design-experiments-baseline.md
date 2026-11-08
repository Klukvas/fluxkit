# Design experiments: baseline (2026-11-08)

Baseline for plan `docs/plans/2026-11-08-design-changeability.md` (PR-0, protocol 7.4 step 1). Two agents redesigned the storefront
on throw-away branches on 2026-11-08 to measure what a per-client redesign costs today. Acceptance run A1 repeats both scenarios after
the plan and writes `docs/plans/2026-11-08-design-experiments-after.md` with the SAME tables and columns (step, files, lines, tool calls
or hours, tests edited, what stayed TODO), so the two can be compared row by row.

- Branches (read-only refs, never merged, no PRs): `origin/experiment/rebrand-test` and `origin/experiment/reshape-test`, both on
  `8dff5b8` (main of 2026-11-06, PR 235).
- Sources: `git show --stat` of each commit, `git diff --stat 8dff5b8 <branch>`, `TODO(fluxkit)` lines of the diffs, and the numbers
  the experiment agents reported (marked "reported"; they are not recomputed here).
- The scenario texts below are the briefs as relayed to PR-0 by the orchestrator; the original prompts are not stored in the repository.
- A1 agents must not read this file (protocol 7.4 step 2).

## 1. Rebrand scenario (`experiment/rebrand-test`)

### 1.1 Brief

Fictional client "Verde Kopi", a specialty coffee roaster. Deep forest-green primary (#1F5F4A family), warm amber accent, off-white warm
neutrals, near-black green-tinted text; a serif display font for headings via a system serif stack without new dependencies; smaller
radii (4 px buttons/inputs, 8 px cards); softer shadows; a matching dark theme; the shop name/logo text replaced in header, footer, emails
and meta; only through the documented customization mechanism.

### 1.2 Totals

| Measure | Value |
|---|---|
| Diff | 20 files, +110/-105 (`git diff --stat 8dff5b8 experiment/rebrand-test`) |
| Commits | 5 (`5818757`, `bf9eaeb`, `8e7db83`, `62f4273`, `d0a2289`), 18:22 to 18:30 UTC |
| Own work of the agent | about 1.5 h (reported) |
| Estimate, tokens only | 2-3 h expert / 5-7 h newcomer (reported) |
| Estimate, to "client is happy" | 6-8 h expert / 1.5-2 days newcomer (reported) |

### 1.3 Steps

| Step | Files | Lines | Tool calls or hours | Tests edited | What stayed TODO |
|---|---|---|---|---|---|
| Palette (`5818757`): light, dark, system blocks and mail colours | 2: `packages/theme/src/tokens.css`, `packages/theme/src/email-theme.ts` | +46/-46 | not reported per step (total about 1.5 h) | none | no accent token exists: the amber accent had nowhere to go (E2) |
| Radii and shadows (`bf9eaeb`) | 2: `tokens.css`, `email-theme.ts` | +16/-16 | not reported per step | none | radii are a size scale, not roles: 4 px controls and 8 px cards cannot be set apart (E3) |
| Display font (`8e7db83`): new `--fk-font-display` token and `font-display` mapping | 6: `tokens.css`, `tailwind.css`, `packages/ui/src/styles.ts`, `apps/storefront/src/app/globals.css` (`.fk-logo`), `packages/theme/src/email-theme.spec.ts`, `packages/ui/src/design-kit.spec.tsx` | +11/-6 | not reported per step | 2: `email-theme.spec.ts` (token listed as not in mail), `design-kit.spec.tsx` (exact `textStyles` strings) | mail headings stay sans (`TODO(fluxkit)` in `email-theme.spec.ts`: needs `font.display` in `EmailTheme`); about 27 headings that bypass `textStyles` keep the sans face (E1) |
| Shop name (`62f4273`) | 10: storefront `messages/uk.json`, `messages/en.json`, admin `messages/uk/common.json`, `messages/en/common.json`, `apps/admin/index.html`, plus 5 test files | +21/-21 | not reported per step | 5: `page-metadata.spec.ts` (6 literals), `design-a.e2e.ts`, `design-b.e2e.ts`, `mobile-ux.e2e.ts`, admin `serving.e2e.ts` | logo stays text (no image logo mechanism, E4); no favicon, `theme-color` or og image (E9) |
| Pictures (`d0a2289`): demo hero and banners recoloured | 3: `public/home/hero.svg`, `banner-1.svg`, `banner-3.svg` | +16/-16 | not reported per step | none | demo assets carry a palette at all (E8) |

Mechanism used: there is no overrides file (E10), so every rebrand step edits core files of `packages/theme`, `packages/ui` and the
apps; 7 of the 20 changed files are tests.

## 2. Reshape scenario (`experiment/reshape-test`)

### 2.1 Brief

1. Product card portrait 4:5, rounded image frame, price in a pill badge bottom-left over the image, brand in small caps above the title,
   sale badge top-right, a favourite-heart placeholder, hover zoom.
2. A list/grid toggle with a horizontal list card.
3. Centred logo with navigation split left/right, an always-visible wide search below on desktop, a thin announcement bar from config.
4. Home: sections reordered (categories, product row, banners), full-bleed hero with text overlaid, a second product row "Bestsellers",
   a brand-logos strip.
5. Footer in four columns with a newsletter placeholder, social icons, payment icons, keeping the theme switch and legal links.

### 2.2 Totals

| Measure | Value |
|---|---|
| Diff | 31 files, +859/-157 (`git diff --stat 8dff5b8 experiment/reshape-test`) |
| Commits | 5 (`325a915`, `5f2daca`, `69feb13`, `92ab8f9`, `1f3ed5b`), 18:24 to 18:37 UTC |
| Tool calls | about 92 in total (sum of the per-step figures below, reported) |
| Estimate | 1-2 days expert; every request edits core files (plan section 1) |

### 2.3 Steps

Ratings are expert / newcomer effort as reported by the agent (S small, M medium, L large).

| Step | Files | Lines | Tool calls or hours | Tests edited | What stayed TODO |
|---|---|---|---|---|---|
| 1 Card (`325a915`) | 7: `product-card.tsx`, `home-sections.tsx`, `icons.tsx`, `messages/uk.json`, `messages/en.json`, `design-a.spec.tsx`, `home-sections.spec.tsx` | +72/-28 | about 15 calls; S/M | 2: `design-a.spec.tsx` (card classes), `home-sections.spec.tsx` (skeleton shape) | sale badge: `onSale` prop no caller can set (no compare-at in the list item, `TODO(fluxkit)`, WP6); heart is a placeholder button (no wishlist feature, `TODO(fluxkit)`) |
| 2 List/grid (`5f2daca`) | 11: new `list-view-toggle.tsx`, `product-list-card.tsx`, `product-list-card.spec.tsx`; edited `catalog/page.tsx`, `catalog-search-view.tsx`, `catalog-view.tsx`, `product-card.tsx`, `product-grid.tsx`, `search-results.tsx`, `messages/uk.json`, `messages/en.json` | +287/-26 | about 25 calls; M/M-L | none edited (1 new spec) | list card "Add to cart" is a link to the product page (no default variant id in the list item, `TODO(fluxkit)`, WP6); `view` param kept only where wired (R3) |
| 3 Header (`69feb13`) | 7: `site-header.tsx`, `globals.css`, new `config/announcement.ts`, `layout/navigation.ts` (`HEADER_CATEGORY_LIMIT` 6 to 4), `messages/uk.json`, `messages/en.json`, `shell.spec.tsx` | +69/-20 | about 15 calls; M/L | 1: `shell.spec.tsx` (nav count 4 to 5, `xl:` to `lg:` classes, new nav label) | announcement bar is plain text only (every byte is in each page's first HTML, R4) |
| 4 Home (`92ab8f9`) | 12: `home-sections.tsx` (+179 lines changed), `config/home.ts`, `(site)/page.tsx`, `packages/ui/src/hero.tsx`, 4 new `public/home/brands/*.svg`, `messages/uk.json`, `messages/en.json`, `home-sections.spec.tsx`, `config/home.spec.ts` | +261/-75 | about 25 calls; M/M-L | 2: `home-sections.spec.tsx`, `config/home.spec.ts` | "Bestsellers" is a stand-in (newest of one category: no sales ranking in the API, `TODO(fluxkit)`, WP6); full-bleed needed the route's `Container` moved (R2) |
| 5 Footer (`1f3ed5b`) | 8: `site-footer.tsx`, new `config/footer.ts`, `globals.css`, `icons.tsx`, `messages/uk.json`, `messages/en.json`, `shell.spec.tsx`, `shop-pages.spec.tsx` | +173/-11 | about 12 calls; S by code, L by the first-HTML budget | 2: `shell.spec.tsx` (nav count 5 to 6), `shop-pages.spec.tsx` (`<ul>` count 1 to 3); `shell.spec` "keeps the footer small" left RED on purpose (2,816 bytes vs the 1,400 pin) | newsletter is a placeholder (no feature, `TODO(fluxkit)` twice); the 4-column footer breaks the first-HTML budget (R4) |

Tests broken per step, summed: rebrand 7 test files edited (2 unit specs in the font step, 5 in the name step); reshape 7 edits over
5 distinct spec files (`design-a.spec`, `home-sections.spec` twice, `shell.spec` twice, `config/home.spec`, `shop-pages.spec`) plus one
spec left red; no e2e file edited in the reshape (whether its e2e still passes was not measured: the sandbox has no stack).

## 3. Findings (hard-coded or leaking places)

Verified against the code by the plan's reviewers; ids as in plan section 2.

- E1 no display-font token (`packages/theme/src/tokens.css:30-31`); about 27 headings bypass `textStyles`, for example
  `account-email-parts.tsx:28-31`, `search-results.tsx:247-250,371-374`, `delivery-section.tsx:67`, `checkout-page.tsx:599,654`,
  `packages/ui/src/empty-state.tsx:21`, `disclosure.tsx:37`, `banner-card.tsx:100-102`, `product-card.tsx:108`, `.fk-logo` `globals.css:48`;
  the admin has about 70 headings (70 `<h1>`-`<h6>` JSX tags in non-spec `apps/admin/src/**/*.tsx` on `b7d732c`), none on `textStyles`.
- E2 no accent token; `BannerTone "accent"` (`packages/ui/src/banner-card.tsx:6,49`, `config/home.ts:76`) means the primary colour.
- E3 radii are a size scale: `rounded-md` 89 uses, `rounded-lg` 17, `rounded-sm` 6; `styles.ts:7`, `button.tsx:39`, `alert.tsx:31`,
  `product-image.tsx:47,62`, `dialog.tsx:79`, `hero.tsx:42`; `cn` does not merge classes.
- E4 text-only logo (`site-header.tsx:81-82`, `.fk-logo`).
- E5 the shop name in 5 files / 9 values; test literals in `page-metadata.spec.ts` (6), `design-a.e2e.ts:195`, `design-b.e2e.ts:381`,
  `mobile-ux.e2e.ts:388`, admin `serving.e2e.ts:42`; `design-kit.spec.tsx:169-170` pins exact `textStyles` strings.
- E6 non-colour tokens duplicated in the dark block (`tokens.css:72-95`).
- E7 the admin imports the same `tokens.css` (rebranded too; not recorded as a decision).
- E8 demo SVGs carry the palette (`public/home/hero.svg`, `banner-1.svg`, `banner-3.svg`).
- E9 no favicon, `theme-color`, manifest or og image; no font loading path (`theme.spec.ts:67-73`, CSP `next.config.ts:286`).
- E10 no overrides file: a rebrand edits `packages/theme/src/tokens.css`.
- R2 presentation mixed with logic: `product-card.tsx:63-82`, `product-grid.tsx:37,40`, home skeleton `home-sections.tsx:547-558`,
  `store-image.tsx:75`, the home route's single `<Container>`, `hero.tsx:42`.
- R3 two URL systems drop an unknown `view` param: `lib/search-query.ts:274-300` (`KNOWN_PARAMS:286`), `lib/catalog-query.ts:95`,
  `catalog-route.server.ts:100-140`, `page-metadata.ts:99`, `search-island.tsx`.
- R4 first-HTML byte budget: `shell.spec.tsx:145` (header under 3,700), `:168` (footer under 1,400, 1,377 used); the 4-column footer
  measured 2,816 bytes in the experiment commit `1f3ed5b` (2,809 is an earlier reported figure, not reproduced).
- R5 data missing in the API (compare-at and default variant id in the list item, `sort=popular`, brands): WP6.
- R6 tests pin classes and markup: `shell.spec.tsx:66-73,145,168`, `design-a.spec.tsx:117-131`, `home-sections.spec.tsx:212`,
  `config/home.spec.ts:109`, `design-b.e2e.ts:143-160,155`, `ui-polish.e2e.ts:19,37,201-213`.
- R7 one flat messages file per language, imported by 46 import statements in 26 spec files (plus `config/home.ts`, `e2e/support/flows.ts`); `assertNoLegalPlaceholders` (`next.config.ts:92-140`) reads only
  top-level files.

## 4. File conflicts with upstream

How often `main` edited the files a redesign touches, in the 11 days before 2026-11-08 (reported by the experiment agents): every one of
them would conflict in a client fork that carries the redesign.

| File | Upstream edits in 11 days | Touched by |
|---|---|---|
| `apps/storefront/src/messages/uk.json` | 18 commits | rebrand name; reshape steps 1-5 |
| `apps/storefront/src/components/search-results.tsx` | 8 | reshape 2 |
| `apps/storefront/src/components/home-sections.tsx` | 6 | reshape 1, 4 |
| `apps/storefront/src/app/globals.css` | 6 | rebrand font; reshape 3, 5 |
| `apps/storefront/src/components/product-card.tsx` | 5 | reshape 1, 2 |
| `apps/storefront/src/components/site-header.tsx` | 5 | reshape 3 |
| `apps/storefront/src/components/shell.spec.tsx` | 5 | reshape 3, 5 |
| `apps/storefront/src/components/product-grid.tsx` | 4 | reshape 2 |
| `apps/storefront/src/components/site-footer.tsx` | 3 | reshape 5 |
| `apps/storefront/src/config/home.ts` | 3 | reshape 4 |
| `apps/storefront/src/components/catalog-view.tsx` | 3 | reshape 2 |
| `apps/storefront/src/layout/navigation.ts` | 3 | reshape 3 |

Conclusion recorded for A1: today a fork's redesign lives in the same files upstream edits most; the plan's target is that it lives in
fork-owned files upstream never edits (plan section 3, rule 6), with 0 conflicts in `config`/`new` files (protocol 7.4 step 5).
