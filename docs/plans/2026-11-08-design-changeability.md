# Plan: make a per-client redesign cheap (design changeability)

Status: v2 (2026-11-08). v1 was reviewed by an architect, a senior frontend developer, a QA lead and an accessibility/performance
reviewer (section 11 lists every finding and what changed). Execution (developers, then QA, then independent code review) starts
only after the owner approves the contract decisions in section 9.

## 1. Goal and honest targets

Fluxkit is sold as a white-label template; the design is replaced per client (AGENTS.md 1, 2.2, 17). Two measured experiments
(2026-11-08, branches `experiment/rebrand-test` +110/-105 over 20 files and `experiment/reshape-test` +859/-157 over 31 files) are
the baseline. Targets, verified by re-running the same experiments with fresh agents (section 8, A1):

| Target | Today | After this plan |
|---|---|---|
| Rebrand (colours, fonts, radii, logo, name, favicon, dark theme) to "client is happy" | tokens only 2-3 h expert / 5-7 h newcomer; to "happy" 6-8 h / 1.5-2 days | at most 2 h expert, at most half a day newcomer, with zero edits of core files (tokens overrides file, fonts config, brand config, messages overrides) |
| Reshape: the five requests below | 1-2 days expert, every request edits core files | at least 3 of 5 done by config plus NEW files only; the others listed with the reason |
| Fork merge pain | every real redesign conflicts in hot files (`search-results.tsx` 8 edits, `home-sections.tsx` 6, `globals.css` 6, `product-card.tsx` 5, `site-header.tsx` 5, `messages/uk.json` about 20 in 11 days) | redesign lives in fork-owned files that upstream never edits (section 3 rule 6) |

The five reshape requests and what this plan can honestly reach:
1. Product card 4:5 with a pill price and badges: ratio and shape by config (L2); a "sale" badge needs compare-at data in the list
   item (WP6, not in this plan); "new" can come from `publishedAt`; badges and a heart through slots (S1). Partly.
2. List/grid toggle: shipped in the template (L2+L5). Reached.
3. Centred header with an announcement bar: NOT targeted. The header stays a core component with data-driven blocks (L3); a second
   built-in header layout is cut (section 11, architect 8). A client with this request edits `site-header.tsx` (documented).
4. Home reorder, full-bleed hero, brand strip: reorder exists today; `width: full` (L4); the strip through a fork-owned `custom`
   section kind (L4). Hero text overlay is cut. Reached except overlay.
5. Four-column footer with extra blocks: data-driven footer blocks (L3) plus the `footer.columns` slot (S1), after L1 removes the
   byte-budget trap. Reached if L1 succeeds.
If L1 fails (section 4), requests 3 and 5 stay core edits and the target degrades to 2 of 5; the plan then records that fact.

Non-goals: new shop features (wishlist, newsletter, reviews), a visual editor or page builder, a second built-in header layout,
hero text overlay, density modes, an announcement bar, new dependencies, API/data changes (WP6), prices/payments/auth/orders.

## 2. Evidence (verified against the code by the reviewers)

Rebrand experiment: colours, shadows, dark theme and mail colours are one edit in `packages/theme/src/tokens.css` plus
`email-theme.ts`; components hold no hex, `style=` or SVG fills (the design guard holds). Not cheap:
- E1 no display-font token (`tokens.css:30-31`: sans and mono only); about 27 headings bypass `textStyles` in storefront and ui (the
  16 first found plus `account-email-parts.tsx:28-31`, `search-results.tsx:247-250,371-374`, three `<legend>` carrying heading styles
  (`delivery-section.tsx:67`, `checkout-page.tsx:599,654`), dynamic `<Heading>` in ui (`empty-state.tsx:21`, `disclosure.tsx:37`,
  `banner-card.tsx:100-102`), the card title `product-card.tsx:108`, `.fk-logo` `globals.css:48`); the admin has 71 headings and none use
  `textStyles`. Several use sizes that are not roles (`order-details.tsx:98` `text-2xl sm:text-3xl`, `status-views.tsx:19,39`
  `text-2xl`, `font-semibold` h3s without size).
- E2 no accent token; `BannerTone "accent"` (`packages/ui/src/banner-card.tsx:6,49`, `config/home.ts:76`, stored by the API) actually
  means the primary colour; Tailwind's `accent-*` is `accent-color`.
- E3 radii are a size scale: `rounded-md` 89 uses (ui 16, storefront 43 including 8-9 `@apply` in `globals.css`, admin 30),
  `rounded-lg` 17 (16 in code, 1 in `design-kit.spec.tsx:209`), `rounded-sm` 6. Roles are mixed (`dialog.tsx:79` and the toast are
  overlays, `hero.tsx:42` is a surface). `controlBase` (`styles.ts:7`), `button.tsx:39`, `alert.tsx:31`, `product-image.tsx:47,62`.
  `cn` (`packages/ui/src/cn.ts`) is a plain join with no class merging.
- E4 logo is text only (`site-header.tsx:81-82`, `.fk-logo`).
- E5 the shop name: 5 files / 9 values (storefront `uk.json`/`en.json` `site.name` and `site.title`, admin `common.json` x2
  `app.name`/`app.documentTitle`, `apps/admin/index.html:8`); code already reads it only through `t("site.name")`. Test literals:
  `page-metadata.spec.ts` (6), `design-a.e2e.ts:195`, `design-b.e2e.ts:381`, `mobile-ux.e2e.ts:388`, admin `serving.e2e.ts:42`;
  `design-kit.spec.tsx:169-170` pins exact `textStyles` strings.
- E6 non-colour tokens are duplicated in the dark block (`tokens.css:72-95`); colours and shadows are in three blocks plus
  `email-theme.ts`. The system block and mail are ALREADY checked (`theme.spec.ts:83-89`, `email-theme.spec.ts`).
- E7 the admin imports the same `tokens.css` and is rebranded too (ADR 0002); not written down as a decision.
- E8 demo assets carry the old palette (`public/home/hero.svg`, `banner-1.svg`, `banner-3.svg`); light backgrounds glare in dark.
- E9 no favicon, `theme-color`, manifest or og image by default; no rebranding checklist; no way to load a client font:
  `tokens.css` cannot hold `@font-face` (`theme.spec.ts:67-73` requires exactly three blocks) and the CSP has no `font-src`
  (`next.config.ts:286`, same origin only).
- E10 the storefront has no overrides file: a rebrand edits `packages/theme/src/tokens.css`, which this plan itself changes.

Reshape experiment: only `config/home.ts` (section order) and `layout/navigation.ts` worked as configuration. No slots
(`docs/contracts/README.md:14` "`slots.md` not written yet"), no card registry, no header/footer composition config.
- R2 presentation mixed with logic: `product-card.tsx:63-82`; classes and the single card in `product-grid.tsx:37` (and import 4,
  use 40); card shape duplicated in the home skeleton (`home-sections.tsx` 547-558); `store-image.tsx:75`; the home page wraps
  everything in one `<Container>` (`app/[locale]/(site)/page.tsx`); `hero.tsx:42`.
- R3 two URL systems drop an unknown `view` param: `lib/search-query.ts:274-300` (`KNOWN_PARAMS:286`, `searchPath`,
  `isCanonicalSearch`) and `lib/catalog-query.ts:95` with redirects in `catalog-route.server.ts:100-140`, canonical in
  `page-metadata.ts:99`, the client filter form (`search-island.tsx`).
- R4 the first-HTML byte budget: `shell.spec.tsx:145` header < 3,700, `:168` footer < 1,400 (1,377 used: 23 bytes of headroom); the
  `<head>` counts too (`:124-125`). A 4-column footer measured 2,809-2,816 bytes and moved the English register form behind the
  loading view without scripts.
- R5 data the design asks for is missing in the API (compare-at and default variant id in the list item, `sort=popular`, a brands
  endpoint): WP6, separate plan.
- R6 tests pin classes and markup (`shell.spec.tsx:66-73,145,168`, `design-a.spec.tsx:117-131`, `home-sections.spec.tsx:212`,
  `config/home.spec.ts:109`, `design-b.e2e.ts:143-160,155`, `ui-polish.e2e.ts:19,37,201-213`).
- R7 `messages/{uk,en}.json` is one flat file per language, imported directly by 46 spec imports and `config/home.ts`,
  `e2e/support/flows.ts`, `shell.spec.tsx`; the release guard `assertNoLegalPlaceholders` (`next.config.ts:92-140`) reads only top-level
  `*.json` of `src/messages` (not recursive).

## 3. Principles

1. A redesign must be possible through, in this order: token values, typed config, fork-owned files, NEW files registered in a
   registry. Editing a core file is a defect of the template (AGENTS.md 17).
2. Defaults stay as they are: every work package leaves the current look identical with default settings. Verified by a
   computed-style comparison (mandatory, section 7) and screenshots (secondary). Declared exceptions, per PR: B4 (neutral hero and
   banner SVGs: masked, shown to the owner before/after) and L2 (the catalog toolbar gains the list/grid toggle: toolbar masked, the
   card grid identical). Any undeclared difference is a defect.
3. Additive for contracts: new tokens, new config fields with defaults, new optional props. Contract changes are listed in section 9.
   Forks that edited hot files or use raw `rounded-md/lg` in their own components migrate once (migration note in `docs/migrations/`).
4. Presentation components stay dumb; data decisions move to pure view-model functions that EXTEND existing helpers (`cardOffer`,
   `listPriceLabel`), not duplicate them (AGENTS 7.2).
5. A guard is replaced by a better guard in the same PR, never removed (AGENTS 9).
6. Fork-owned files that upstream never edits after creation (empty by default, listed in `docs/customization.md`):
   `packages/theme/src/brand-overrides.css`, `packages/theme/src/admin-overrides.css`,
   `apps/storefront/src/config/fonts.ts`, `apps/storefront/src/messages-overrides/{uk,en}.json`,
   `apps/storefront/src/components/cards/custom.ts`, `apps/storefront/src/config/custom-sections.ts`,
   `apps/storefront/src/config/slots.tsx`.
7. New contract files are not CI-checked today: add a `check:docs` rule (changes to `config/{brand,catalog,header,footer,slots}.ts*`
   require a change in `docs/contracts/`).
8. What becomes contract in `branding.md`/`layout-config.md`: file locations, exported types and the rule "a new field or variant is
   minor, a rename or removal is major with a migration note"; default values are NOT contract; status `draft` like other contracts.

## 4. Work packages

Sizes are developer-days for a developer who knows the repo (newcomer about 1.7x); see section 6. Owner paths per AGENTS 10.

### WP1 Tokens (packages/theme, packages/ui, storefront, admin)
- T4 (S, first) single non-colour definition, SIMPLIFIED: delete the non-colour lines from the dark block (`tokens.css:72-95`);
  dark inherits them from `:root`. NO generator, NO new command, NO new CSS block. `theme.spec.ts:27-30` ("same token names in light
  and dark") becomes: non-colour tokens exist only in the light block; dark contains only `--fk-color-*` and `--fk-shadow-*` and the
  same names as light's colours and shadows; system equals dark byte for byte; every `var(--fk-*)` of `tailwind.css` is defined in
  light. Written FIRST (red on current `tokens.css`). `check:docs` needs `theme-tokens.md` touched whenever token occurrences change.
- T1 (M) display font: `--fk-font-display` (default = value of `--fk-font-sans`; a test asserts equality in the default) and
  `--font-display` mapping; new heading roles in `textStyles` (`pageTitleCompact`, `itemTitle`, `cardTitle`, `dialogTitle`) so the
  27 bypassing headings move to roles without a visual change; `font-display` applies by default only to `pageTitle` and
  `sectionTitle` (a decorative face in small card titles hurts legibility); guard: JSX headings with a literal `className` must
  start from `textStyles` (allow `sr-only`), plus a separate assertion for the dynamic `<Heading>` components and `<legend>` in ui;
  scope = ui + storefront (the admin is out: 71 headings, recorded as a known limit); `design-kit.spec` asserts roles instead of exact
  strings (the "only scale classes" guarantee stays with `offScaleClasses`, `design-guard.spec.ts:198-208`); report first-HTML bytes
  of `/uk/account/register` before/after (+13 bytes per heading).
- T1b (S) fonts: `apps/storefront/src/config/fonts.ts` exports `next/font/local` declarations (empty by default); the layout attaches
  their `.variable` once; tokens may reference `var(--font-...)` (check `contrast.spec` accepts non-hex fonts); admin: `@font-face` in
  `admin-overrides.css`. Docs: self-hosted woff2 only (CSP; Google Fonts blocked on purpose), `display: swap`, fallback metrics
  (`adjustFontFallback`/`size-adjust`), Cyrillic coverage incl. Ґ Є І Ї, apostrophe U+2019 and ₴, load the weights `textStyles` uses
  (600/700), no preload while L1 is open, `@font-face` only in global CSS (a hoisted stylesheet inside a boundary makes it outlined).
- T2 (S) accent: `--fk-color-accent`, `--fk-color-accent-foreground` in light, dark and system, default VALUES equal to primary
  (hex, not `var()`: `contrast.spec` requires 6-digit hex); the pairs (`accent-foreground` on `accent` 4.5, `accent` on `background`
  and on `muted` 3) are in `contrast.spec` unconditionally, in all three modes; `BannerTone "accent"` is rewired to
  `bg-accent text-accent-foreground` (no pixel change, the token gets a real consumer and is contrast-checked); the docs separate the
  tone name from the token and from Tailwind's `accent-color`. Marked "reserved for client code" otherwise.
- T3 (M+) role radii: `--fk-radius-control|card|overlay|media` defined in the light block with LITERAL rem values equal to today's
  scale (so no visual change, the email parser and `contrast` stay simple; `media` defaults to the `card` value), Tailwind mappings
  (`@theme inline`, `--radius-*` gives `rounded-control` etc.), every one of the 89+17+6 sites classified by ROLE (the list goes into the
  PR description), in ui, storefront AND admin (the admin shares `controlBase`/`button`; 30+4 sites); the radius and aspect ratio
  of images become PROPS (`ratio` on `StoreImage`/`ProductImage`), never an extra `className` (`cn` does not merge). Guard (three
  changes): `radiusSteps` (`design-guard.spec.ts:135`) allows `control|card|overlay|media|full|none` for components and the mapping
  check (`:171-173`) demands the new mappings; `@apply` lines in `.css` are scanned too (the 8-9 in `globals.css`, `.fk-*` stay inside
  `@layer components`); raw `rounded-md|lg` is allowed only through an explicit `file:class` allow-list with a reason. Mail:
  all new tokens go to `notInMail` with a reason (no `EmailTheme` interface change: public contract); recorded limit: mail buttons keep
  the scale radius. Computed-style snapshot spec (section 7) lands with this PR.
- T5 docs per PR: `docs/contracts/theme-tokens.md` (additive list; the guard change is a fork migration note like 2026-11-03),
  `docs/files/theme.md`.
- Optional (S): `--fk-container-max` token for the page width (`container.tsx:5` `max-w-6xl`), a frequent rebrand item.

### WP2 Branding
- B1 (M) storefront brand config `apps/storefront/src/config/brand.ts` holding ONLY logo, favicon, theme colour and og image. The name
  stays in messages (`site.name`, `site.title`; the single source in code today) and is overridden through WP3. Logo: default text;
  an optional logo is a fork-supplied SVG component using `currentColor`/token fills (works in both themes, zero requests) OR a
  light/dark image pair switched by CSS rules on `[data-theme]` plus the system media block in `@layer components` (`<picture media>` is
  wrong: the theme comes from the cookie, ADR 0045); both images with `width`/`height`, `loading="eager"`, NO `fetchPriority`, NO
  preload, through `LocalPicture` (`source-guards.spec.ts:150-163`), `alt` = the shop name, no duplicate `title`; a single variant
  requires an explicit `darkSafe`; SVG recommended (forced colors). Favicon, og image and apple icon through Next file conventions
  (`app/icon.*`, `app/opengraph-image.*`): a fork replaces files; `generateViewport().themeColor` reads the theme cookie (one
  meta for light/dark, two with `media` for system, as the layout already reads the cookie); Next REPLACES `openGraph` instead of
  merging, so the default og image is added in the `page-metadata.ts` builders (+spec); guard test: `themeColor` equals
  `--fk-color-background` light/dark. HEAD BUDGET: until L1 lands the `<head>` counts toward the first-HTML limit; B1 must not
  grow `/uk/account/register` and `/en/account/register` head by more than 300 bytes and reports before/after bytes; an image logo
  waits for L1.
- B2 (S) admin: the admin already takes its name from messages (`shell.tsx:112`, `use-document-title.ts:11`); only
  `apps/admin/index.html:8` is a literal: `transformIndexHtml` (built-in Vite hook) sets the title from `app.name` at build, tested in
  `build-output.spec.ts`. ADR 0047: the admin follows the shop tokens by default (as today, ADR 0002); a fork pins it neutral with
  `packages/theme/src/admin-overrides.css` imported after `tokens.css` (placed outside the design guard's scanned paths; read by
  `contrast.spec` so overrides are checked; must not add a `prefers-color-scheme` rule: `theme-isolation.spec` stays). No
  `config/brand.ts` for the admin. Bundle numbers (admin raw/gzip) reported; budget 445,000 / 135,000, about 3.5 KB gzip headroom.
- B3 (S) tests stop hard-coding the brand: `page-metadata.spec` builds expectations from the merged `uk["site.name"]`; e2e read
  `site.name` from the merged messages (JSON import in `support/`); admin `serving.e2e.ts` likewise; `design-kit.spec` already moved
  in T1.
- B4 (S) neutral demo assets: grey hero and banner SVGs with a dark-safe background, SAME file names and sizes (`design-b.e2e.ts:155`
  pins `img[src="/home/hero.svg"]`, `home.spec` checks `viewBox`); declared visual exception (principle 2).
- B5 (S) `docs/customization.md`: one checklist with real paths (tokens overrides, fonts, brand, name in messages overrides, favicon/og,
  `EMAIL_FROM`, demo assets, tests, admin overrides, the fork-owned file list, the known limits: mail radius, mail logo, admin
  headings), linked from README, storefront README and AGENTS.md; a test asserts every path in it exists.
- Storefront overrides: `packages/theme/src/brand-overrides.css` imported after `tokens.css`; `email-theme.spec` and `contrast.spec`
  check the EFFECTIVE values (tokens plus overrides); the file is empty upstream.

### WP3 Messages (storefront i18n) - FIRST in time
- M1 (M) split into `messages/{uk,en}/<area>.json` with FLAT keys unchanged (`"site.name"`), merged statically in
  `messages/index.ts` (`messagesByLocale`, the same pattern as `apps/admin/src/messages/index.ts`); the 46 spec imports,
  `config/home.ts`, `e2e/support/flows.ts`, `shell.spec.tsx`, `client-boundary.spec.ts` and `next.config.spec.ts:236-265` switch to
  it in one pass; a test: each key lives in the file of its prefix (the same map as `CLIENT_MESSAGE_PREFIXES`), no duplicate keys across
  files. ONE-TIME check in the PR description: merged object equals `git show main:...uk.json` 1:1. RELEASE GUARD FIX (blocker): 
  `assertNoLegalPlaceholders` must read the MERGED messages (recursive read plus overrides; `next.config.ts` cannot import the TS
  loader, so it needs the same merge in plain fs code), with failing-first cases in `next.config.spec.ts`: a marker in a subfolder file
  fails, a marker replaced through an override passes; update `docs/contracts/config.md`.
- M2 (S) overrides `src/messages-overrides/{uk,en}.json` = `{}`, merged last, before `pickClientMessages`; an override key missing from
  the base is an error (typo guard); parity and "no hardcoded text" specs run on the merged result; new `hydration-clean.e2e.ts`
  (home, product, catalog, cart, checkout in uk/en, zero console lines matching `HYDRATION`), run once locally with a non-empty override;
  `scripts/messages-extract-overrides.mjs` (no dependency) turns a fork's old `uk.json` diff into an overrides file; report the RSC
  payload size of `/uk/account/register` before/after.

### WP4 Layout composition (storefront, packages/ui)
- L1 (M) SPIKE (1.5 d, CI only: the pages need the API and Postgres) then implementation, ADR 0048 `proposed`. DIAGNOSIS (verified in
  react-dom 19.3.1): a finished boundary is outlined when `flushedByteSize + boundary.byteSize > progressiveChunkSize` (12,800, only
  boundaries over 500 bytes are eligible; the loading fallback and the `<head>` count); and without scripts it is also a RACE: if the
  page boundary is not finished when the shell flushes it arrives as a separate `$RC` segment and is invisible without JS regardless of
  bytes. Next 16.4 exposes no option for `progressiveChunkSize`. DECISION to measure: every route that must work without scripts
  (login, register, forgot/reset-password, verify-email, cart, checkout, legal, payment return) lives in a route group WITHOUT
  `loading.tsx` (as `(catalog)` and `(pages)` already do), `loading.tsx` stays only for home (nested group `(site)/(home)`) unless the
  spike shows a benefit elsewhere; the footer-in-Suspense candidate is REJECTED (a finished footer boundary is outlined too: legal links
  and the no-script theme switch vanish; it does not help the header). Exit criteria, one table (candidate x page x locale ->
  inline/outlined, bytes, CLS): register/login/checkout forms inline in uk and en with a client-sized header AND a 4-column footer, with
  a cold cache and a 500 ms API delay, CLS under 0.05 (collector from `design-b.e2e.ts:55-95` moved to `support/layout-shift.ts`), and
  the header search text loss re-measured deterministically: new `header-search-pre-hydration.e2e.ts` (hold `/_next/static/chunks/**` for
  1.5 s, type into the combobox, release, assert the value survives) with `--repeat-each 40`, threshold 0 of 40 (the past figure was 5
  of 40 on home). Implementation: move routes, update `route-structure.spec.ts:44-55` (loading rules, the list of no-JS routes as a
  structural guard) and the README Routes table; `shell.spec` byte pins become a loose sanity cap (header under 8,000 and footer under
  4,000) because the real guard is `pre-hydration-forms` (uk+en) plus a raw-HTML check (form not inside a hidden outlined segment, no
  `aria-busy` loading view before the form). The ADR also records that home works only with JS (accepted) and that the budget
  protects progressive enhancement, not security (`method="post"` guard is independent). If the spike fails, the fallback is to
  document the budget as a design constraint with a checker, and the plan's targets degrade (section 1).
- L2 (L) card registry and list/grid: pure `lib/product-card-model.ts` (`cardDisplay` extending `cardOffer`/`listPriceLabel`), card
  variants `standard` and `horizontal` as separate server components in `components/cards/`, the REGISTRY in
  `components/cards/registry.ts` (not in `config/`: config stays pure data and its specs do not import React) with a fork-owned
  `custom.ts`; `config/catalog.ts` holds only names and numbers (`cardVariant`, `gridColumns`, `imageRatio`, `listToggle`) mapped
  to LITERAL class tables (`{4: "lg:grid-cols-4"}`, `{square: "aspect-square", portrait: "aspect-4/5"}`: Tailwind cannot generate
  `grid-cols-${n}`; arbitrary values are rejected by the guard); `sizes`, intrinsic `width`/`height` and the eager count derive from
  the config (list view: one card per row, eager at most 2); skeletons read the same config; one link per card (stretched link),
  actions sit next to the link (`relative z-10`) never inside `<a>`; the registry is server-only (guard in `client-boundary.spec`: no
  `'use client'` file imports it); headline level and roles from L1/T1. List/grid toggle = two links (`?view=list|grid`) in a
  labelled group with `aria-current`, not `aria-pressed`; works without JS; the horizontal card's add-to-cart is a link to the product
  page (no `variant_id` in the list item: WP6).
- L5 (M) presentation URL params: a whitelist (`view`; `density` is cut) kept by BOTH URL systems (`search-query.ts` and
  `catalog-query.ts` with the redirects), the client filter form and the locale switcher; `view` never reaches `/store/search`,
  the list cache key or the canonical/sitemap; an invalid value redirects to the address without it.
- L3 (M) header and footer as data-driven composition: `config/header.ts` (which blocks, in which order, which category count) and
  `config/footer.ts` (ordered blocks: shop pages, legal, contacts, social, payments text, theme switch; empty block renders nothing;
  columns are headings inside one footer `nav` or labelled `nav`s; `<address>` only for shop contacts; local payment images only, CSP
  `img-src 'self'`) by the pattern of `config/home.ts` (typed union, exhaustive switch). NO second header layout, NO announcement bar
  (the `header.top` slot covers it). Depends on L1 and L2.
- L4 (M) home: common `width: "contained" | "full"` per section, the `Container` moves from the route into the sections
  (geometry pinned by `design-b.e2e.ts:143-160`); a `custom` section kind resolved from the fork-owned `config/custom-sections.ts`
  (this is what makes request 4 reachable); no hero overlay.
- L6 (M) tests move from classes/markup to behaviour: roles, accessible names, order and geometry (list in section 7.1).

### WP5 Slots (RED ZONE: public contract)
- S1 (M) `docs/contracts/slots.md` and the fork-owned `config/slots.tsx`: a typed server-only registry of at most four slots
  (`product-card.badges`, `product-card.actions`, `footer.columns`, `header.top`), each an ordered list of server components that receive
  a VIEW-MODEL (not raw API types), empty by default and rendering `null` (no wrapper, no empty landmark). The shape is right for this
  codebase (RSC-compatible, typed, tree-shakeable, same pattern as `config/home.ts`); React-context slots and path-alias shadowing
  (Gatsby/Docusaurus style) were considered and deferred to a later ADR (runtime or silent-breakage risks, alias duplication in Turbopack
  and Vitest). Text or colours over images only on the component's own opaque background or a scrim; no text directly on a photo.

### WP6 Data for design (RED ZONE, NOT in this execution)
Compare-at range and default variant id in the list item, `sort=popular`, `GET /store/brands`: a separate plan with its own review. WP2
and WP4 must not invent fake data (the experiments' badge and "bestsellers" were TODO placeholders).

### WP7 Acceptance and docs
- A1 (QA, agents) re-run of both experiments by fresh agents on the finished code (protocol 7.4).
- A2 final `docs/customization.md`, migration note for forks (`docs/migrations/`, every touched file), CHANGELOG, `docs/files/*`,
  HANDOFF.

## 5. Sequence, PRs and parallelism

Order (time); "||" = parallel (disjoint files):
0. PR-0 (S): fix the flaky `mobile-ux` D-04 with a root cause (`--repeat-each 30`), commit the experiments baseline artefact
   `docs/plans/2026-11-08-design-experiments-baseline.md` (scenarios verbatim, files, tool-call counts, hours, conflicts), add the
   `check:docs` rule for new contracts (principle 7).
1. PR-A (M): WP3 M1+M2 (messages), including the release-guard fix. First: it removes most future conflicts. ||
2. PR-B (M): L1 spike, ADR 0048 `proposed`; if option (a) is confirmed, the implementation in the same PR (else PR-B2).
   Starts on day one, read-only measurements first. ||
3. PR-C (M): T4, T1, T1b, T2, T5, `design-kit.spec` and `email-theme.spec` (`notInMail`) updates; optional container token. Owner:
   `packages/theme`, `packages/ui/styles.ts`, `apps/storefront/src/config/fonts.ts`. ||
4. PR-E1 (S): B2 admin brand, ADR 0047, `admin-overrides.css` (owner: admin; can run in parallel with PR-C/D).
5. PR-D (M+): T3 role radii in ui + storefront + admin, guard, computed-style snapshot. After PR-C.
6. PR-E2 (M): B1, B3, B4, B5 storefront branding (after PR-A; an image logo after PR-B).
7. PR-F (L): L2 + L5 (after PR-D).
8. PR-G1 (M): L3 (after PR-B and PR-F). || PR-G2 (M): L4 (after PR-B).
9. PR-H (M): S1 slots (after owner approval, after PR-G1).
10. PR-I (S): final docs and migration note, then A1 and the results written into this plan.
Each PR: owner agent -> QA agent (browser, stack) -> independent code review on a different model than the author -> CI 21/21 ->
merge with the owner's consent. Shared files (CHANGELOG, HANDOFF, `messages`, README): merge `main` before each PR; PR-A goes first.
File-overlap hot spots: `tokens.css`/`tailwind.css`/theme specs (C, D), `globals.css` (C, D, E2, B, G1), `product-card.tsx` (D, F, H),
`home-sections.tsx` (D, F, G2), `site-header.tsx`/`site-footer.tsx` (E2, B, G1, H), `shell.spec.tsx` (A, B, E2, G1, H),
`page-metadata.ts` (A, E2, F). Large PRs may be split by application (admin vs storefront) as parallel owners.

## 6. Estimates (developer-days; S <= 1, M = 2-3, L = 4-5 on a plan-level; real numbers below)

| WP | Expert (knows the repo) | Newcomer | Notes |
|---|---|---|---|
| PR-0 | 1 | 1.5 | D-04 root cause, baseline doc, docs rule |
| M1 + M2 | 2.0 | 3.5 | 46 imports, guard fix, hydration spec, extract script |
| L1 spike | 1.5 | 3 | CI only |
| L1 implementation | 2 | 3.5 | route move, specs, e2e, README |
| T4 | 0.5 | 1 | already half-checked by existing specs |
| T1 + T1b | 2 | 4 | about 27 headings, roles, fonts config |
| T2 | 0.5 | 1 | plus the tone wiring |
| T3 | 3.5 | 5.5 | 112 sites + admin 34, guard with `@apply`, snapshot spec |
| computed-style snapshot spec | 1 | 2 | new |
| B1 | 2 | 3.5 | head bytes, og merge, viewport, logo |
| B2 + ADR 0047 | 1 | 1.5 | |
| B3 + B4 + B5 | 2.5 | 4.5 | |
| L2 + L5 | 5 | 8.5 | model, two cards, registry, two URL systems, skeletons |
| L3 | 3 | 5 | after L1 |
| L4 | 2.5 | 4 | `custom` kind |
| L6 | 1 | 2 | spread over PRs |
| S1 | 2 | 3 | plus contract review |
| A1 + A2 | 3 | - | agent runs plus docs |
| **Total** | **about 36** | **about 60** | |

## 7. Verification

Per PR: lint, format:check, typecheck, check:boundaries, check:docs, check:env, `pnpm --filter @fluxkit/theme test`, ui/admin/storefront
unit tests, full storefront and admin e2e (CI only: the sandbox cannot start Postgres), plus the items below.

Mandatory computed-style comparison (deterministic): one spec compares `getComputedStyle` (`border-radius`, `font-family`, `font-size`,
`font-weight`, `color`, `background-color`, `box-shadow`, `outline`) of a fixed selector list on 8 pages x light/dark, base commit vs
PR (both from the same machine and run, `reducedMotion: reduce`, `page.clock` frozen, seeded data, no images); zero tolerance on the
compared properties; declared exceptions per PR only.
Secondary screenshots (QA protocol): `apps/storefront/e2e/visual.config.ts` and `scripts/visual-compare.sh <base-ref>` (two builds, one
machine, `toHaveScreenshot` with `animations: "disabled"`, `scale: "css"`; baseline = the PR's merge-base, never in git;
`maxDiffPixels: 0` for pure refactors, a documented `maxDiffPixelRatio: 0.005` with `threshold: 0.2` only with the attached diff image),
24 frames (home, catalog, catalog list, product, cart, checkout, search, login, register, legal, 404; 390 and 1280; light, dark, system on
two pages) plus element shots (banner, contentinfo, first card); a separate CI job `visual` (not inside `e2e`: 30-minute limit) for PRs
labelled `visual-check` or touching theme/ui/storefront components.
First-HTML and performance protocol (P1-P5 of the accessibility review): raw HTML of `/uk|en/account/{login,register,forgot-password}`,
cart, checkout, legal on `next start` (form outside a hidden outlined segment, no loading view before the form), head/header/footer bytes
and the form offset reported per PR until L1; Web vitals in Playwright Chromium (CLS under 0.05 cold and warm, LCP not worse than +10 %,
TTFB of moved routes not worse than +20 ms median, 20 runs, CPU 4x and slow 4G); bundles (`route-bundle-stats.json`, CSS raw and gzip,
total CSS growth at most +3 KB gzip over the plan; admin `build-output.spec` numbers in every PR touching ui or admin).
Accessibility acceptance: `contrast.spec` including accent and (when overlays exist) scrim pairs over white and black in three modes,
the design-b contrast walk in light, dark and system (`colorScheme: dark`), reduced motion (`transform: none` on hover),
`forcedColors: active` screenshot of focus and logo, Tab order e2e (skip link first, one `h1`, one visible main `nav`), empty slots add
no DOM nodes, focus-ring screenshots before/after T3; screen reader checks are "not verified" (as in the README).
Flaky policy: no `skip`/`fixme` in these PRs; one CI retry then a rerun; a red test that is also red on `main@merge-base` the same day is
recorded as pre-existing with the run link; rewritten and new e2e run `--repeat-each 5` locally by QA with the stack before merge.

### 7.1 Acceptance per work package (Accept / keep green / add first / rewrite)

| WP | Accept (measurable) | Keep green | ADD first (red -> green) | Rewrite (classes/markup -> behaviour) |
|---|---|---|---|---|
| T4 | non-colour tokens once in light; dark = colours + shadows only; system = dark | `contrast.spec`, `email-theme.spec` | new `theme.spec` invariants (red on today's `tokens.css`) | `theme.spec.ts:27-30,83-89` |
| T1 | `--fk-font-display` = sans by default; about 27 headings on roles; no visual diff | theme/email specs, design guard | guard: headings only via `textStyles` (red on 27 sites); mapping `--font-display` | `design-kit.spec.tsx:169-170` |
| T1b | `config/fonts.ts` exists, empty; docs; admin `@font-face` path | CSP spec | test: fonts declared only through the config | - |
| T2 | accent pair in three blocks; banner tone uses it | `contrast.spec` | three pairs (red until the token exists) | `home.spec`/banner specs if tone classes pinned |
| T3 | no raw `rounded-md|lg` outside the allow-list (incl. `@apply`, admin); computed styles identical | all unit, e2e | guard (red on about 112 sites) | `design-a.spec.tsx:117-131`, `design-kit.spec.tsx:209` |
| B1 | brand config typed; default = text; head growth at most 300 bytes; pre-hydration-forms uk+en green | `shell.spec` pins, `token-hygiene` | logo unit (light/dark switch, alt, darkSafe), themeColor guard, og merge in `page-metadata` | `page-metadata.spec` literals |
| B2 | one admin name source; `dist/index.html` title = `app.name`; overrides imported after tokens | admin budget, `serving` e2e | `build-output.spec` title; source guard for import order | `serving.e2e.ts:42` |
| B3 | no brand literals in specs/e2e (except the CSRF header and `EMAIL_FROM`) | all | - | list in section 2 E5 |
| B4 | grey SVGs, same names and sizes; contrast walk green in dark | `design-b` e2e | - | - (declared diff) |
| B5 | `docs/customization.md` exists, linked; every path in it exists | `check:docs` | path-existence test | - |
| M1 | merged equals old JSON 1:1 (one-time); legal guard sees split files | `messages.spec`, `client-messages.spec`, full e2e | key-in-right-file test; guard cases in `next.config.spec` | 46 imports |
| M2 | override wins, unknown key errors, hydration clean | same | override semantics tests, `hydration-clean.e2e` | - |
| L1 | exit table; ADR 0048; forms inline uk+en with a client-sized header and 4-column footer; CLS under 0.05; search text 0 of 40 | `pre-hydration-forms` | `header-search-pre-hydration.e2e`, `support/layout-shift.ts` | `shell.spec.tsx:145,168`, `route-structure.spec.ts:44-55` |
| L2 | `cardDisplay` pure and covered for every offer kind; both variants share one a11y contract; skeleton and grid read `config/catalog.ts`; fork adds a card in new files only | `design-a.spec`, catalog e2e, match-and-stock-hints e2e | `product-card-model.spec` (TDD), toggle e2e | `home-sections.spec.tsx:212` |
| L5 | `view` kept by both URL systems, never in API/cache/canonical; invalid value redirects | search e2e redirect tests | `search-query.spec`, `catalog-query` spec, `catalog-view-toggle.e2e` (toggle -> facet -> sort -> page 2 -> locale), network capture | - |
| L3 | typed configs, exhaustive switch; default render equals today's (unit before/after) | `shell.spec` landmarks, `ui-polish` row test, privacy footer links | per-block unit tests | `shell.spec.tsx:66-73`, `ui-polish.e2e.ts:201-213` |
| L4 | `width`/`custom` in home config; default identical | `design-b` e2e | unit: full section without container, custom kind resolves | `home.spec.ts:109` classes |
| L6 | no e2e locator by utility class (`ui-polish.e2e.ts:19,37`) | - | - | list above |
| S1 | at most four slots; empty slots add 0 bytes (static-markup equality); registry server-only | `shell.spec` pins | equality test, `client-boundary` assertion | - |

### 7.4 Acceptance protocol A1 (after PR-G*)
1. Baseline artefact (PR-0): both scenarios verbatim ("Verde Kopi" brief with hex palette, two fonts, radii, svg logo light/dark, name,
   dark mode; the five reshape requests), hours, tool-call counts, `git diff --stat`, file lists, tests edited, TODOs left.
2. Agent hygiene: new context, a model different from the plan's authors and from the experiment agents; the only guide is
   `docs/customization.md`; they may read the repository except `docs/plans/2026-11-08-*` and the experiments docs and must not use
   `git log` or `experiment/*` (verified from the transcript); two independent runs per scenario on different models, the worse counts.
3. Inputs: start commit = PR-G2 merge (+PR-H for slots); stack up before; brief files (logo, fonts) in `/tmp/brief/`.
4. Measures: wall-clock and tool-call count (hours = tool calls x the baseline's median call time); files changed classified by a
   script: `config` (config files, fork-owned files, `tokens.css`/overrides, `brand.ts`, `public/**`), `new` (not in merge-base) and
   `core edit` (any changed existing file outside those); conflicts when merging the agent's branch with a branch carrying three
   typical upstream edits (a messages key, a class in `product-card.tsx`, a section in `home-sections.tsx`); QA verifies the visual
   result against the brief, lint/typecheck/tests, e2e, contrast.
5. Pass: rebrand at most 2 h expert-equivalent (at most half a day newcomer run) with `core edit` = 0 and no test edits; reshape at
   least 3 of 5 only by `config` plus `new`, the rest listed with reasons, and 0 conflicts in `config`/`new` files. A failed threshold
   keeps the plan open; the analysis goes into HANDOFF. Report: `docs/plans/2026-11-08-design-experiments-after.md`.

## 8. Roles

Architect (ADR 0047 admin tokens/overrides, ADR 0048 first-HTML budget, the slots and branding/layout contracts, every public-contract
change) · Developer agents per PR (one owner per path set) · QA agents (real browser against the stack, evidence per PR, the A1 re-run)
· independent code reviewer on a different model than the author for every PR · orchestrator (this plan, integration, Definition of Done,
HANDOFF).

## 9. Decisions needed from the owner (red zones and policy)

1. Contract additions (AGENTS 14): new tokens (display font, accent, role radii), the guard change (forks with raw `rounded-md|lg` in
   their own components migrate once), the new contract files `branding.md` and `layout-config.md` (what is contract: principle 8),
   the `view` URL parameter (user-visible), the fork-owned files list. `EmailTheme` is NOT changed (new tokens go to `notInMail`; mail
   buttons keep the scale radius: known limit). Recommended: approve.
2. Slots contract (WP5): four slots, server-only, view-model props. Recommended: approve.
3. Admin: follows the shop tokens by default, with `admin-overrides.css` for forks (ADR 0047). Recommended: approve.
4. Messages split and overrides folder (WP3). Recommended: approve.
5. Scope cut: no centred header layout, no hero overlay, no density, no announcement bar (the slot `header.top` covers the bar).
   Recommended: approve; request 3 of the reshape experiment stays a core edit by design.
6. The list/grid toggle ships in the template (default grid). Recommended: yes.
7. WP6 (API data for design): separate plan later.

## 10. Risks

- L1 may not be solvable without a trade-off; the fallback and its effect on the targets are recorded (section 1, L1).
- Visual regression from the role radii sweep and the card refactor: computed-style comparison, screenshots, full e2e.
- The messages split touches every page and the release guard: guard fix and one-time equality check; hydration spec.
- The admin gzip budget has about 3.5 KB headroom; PRs touching ui or admin report the numbers.
- Test churn: pinned tests are rewritten in the PR that needs it, never weakened without a replacement.
- Scope creep into features: out of scope; slots exist so features can plug in later.
- Fork migration: forks that edited hot files conflict once; the migration note lists every touched file and the extract script helps
  with messages.
- Hydration mismatches (messages, theme), SEO (canonical/hreflang unchanged by brand config: tested), the known light-flash of Next's
  404 document in dark screenshots (not a regression), admin e2e running only in CI.

## 11. Review log (v1 findings and what changed)

Architect: (1) contracts not all in the red-zone list -> section 9 and principle 3/8; (2) T4 over-engineered and against the "exactly
three blocks" rule -> simplified T4 (no generator, no command, no new block); (3) T3 must include the admin -> included; (4) every new
token fails `email-theme.spec` -> `notInMail`, EmailTheme untouched; (5) no way to load a font -> T1b; (6) M1 blinds the legal guard
-> M1 fix and tests; (7) L1 diagnosis confirmed, option (a) generalised, footer-in-Suspense rejected, Next has no option -> L1; (8)
over-engineering (centred header, overlay hero, density, announcement bar) -> cut; (9) what is contract -> principle 8; slots shape
confirmed. Senior developer: counts corrected (27 headings, 89 `rounded-md`, 5 files for the name, 46 imports); missing overrides file
-> `brand-overrides.css`; heading roles; `cn` does not merge; guard needs `@apply`; head budget before B1; PR overlaps and order;
`custom` section kind; estimates; computed-style comparison proposed. QA: principle 2 exceptions; acceptance per WP (7.1); T4
invariants; pixel protocol (7); A1 protocol (7.4); flaky policy; B3 literals; M1 imports; M2 and S1 tests; per-PR QA evidence (kept in
the PR briefs); `check:docs` rule for contracts; a separate `visual` CI job. Accessibility/performance: PR order (L1 before branding),
the race diagnosis, scrim/overlay rules (kept as a rule even though overlay is cut), brand-colour contrast path (accent pairs, effective
values checked), logo light/dark by CSS not `<picture>`, head bytes, `sizes`/eager from config, view toggle as links, registry server-only,
font loading rules, reduced motion, CSS and admin bundle budgets, measurement protocol (7).
Disagreement resolved: QA proposed pixel screenshots, the senior developer and the architect computed styles; both are used, computed
styles are mandatory because they are deterministic.
