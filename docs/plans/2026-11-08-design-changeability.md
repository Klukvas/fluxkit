# Plan: make a per-client redesign cheap (design changeability)

Status: DRAFT v1 (2026-11-08), written by the orchestrator from two measured experiments. To be reviewed by an architect, a senior
frontend developer, a QA lead and an accessibility/performance reviewer BEFORE any code. Execution (developers, then QA, then code
review) starts only after the review findings are merged into this file and the owner approves the red zones named in section 9.

## 1. Goal

Fluxkit is sold as a white-label template; the design is replaced per client (AGENTS.md section 1 and 2.2). Two experiments on
2026-11-08 measured how hard that is today (reports are summarised in section 2; the experiment branches are local only).
Targets of this plan, measured by re-running the same experiments after the work (section 8):

| Target | Today | After |
|---|---|---|
| Rebrand (colours, fonts, radii, logo, name, dark theme) | 2-3 h expert, 5-7 h newcomer for tokens only; 6-8 h / 1.5-2 days to "client is happy" | at most 2 h expert, at most half a day newcomer, to "client is happy", guided by one checklist |
| Reshape (card shape, list/grid, header, footer, home layout) | five requests = 1-2 days expert, almost all by editing core files | at least 3 of the 5 requests done by config plus NEW files only (no edit of a file the template keeps changing) |
| Fork merge pain | every real redesign conflicts in hot files (`search-results.tsx` 8 edits, `home-sections.tsx` 6, `globals.css` 6, `product-card.tsx` 5, `site-header.tsx` 5, `messages/uk.json` about 20 in 11 days) | redesign lives in config, new files and one overrides folder; core files are not edited |

Non-goals: new shop features (wishlist, newsletter, reviews), a visual editor, a page builder, redesigning the admin, new
dependencies, changing prices/payments/auth/orders.

## 2. Evidence (what the experiments found)

Rebrand experiment (`experiment/rebrand-test`, 20 files, +110/-105): colours, shadows, dark theme and email colours are one edit
in `packages/theme/src/tokens.css` plus `email-theme.ts`; components hold no hex colours, no `style=`, no SVG fills (design guard
holds). Not cheap:
- E1 no token for the display (heading) font: `tokens.css:30-31` has sans and mono only; about 16 headings bypass `textStyles`
  (`delivery-section.tsx:124`, `account-orders.tsx:67`, `catalog-view.tsx:150`, `cart-page.tsx:256`, `order-details.tsx:98,237,321`,
  `payment-return-page.tsx:110`, `status-views.tsx:19,39`, `search-island.tsx:427`, `checkout-page.tsx:232,436`,
  `account-data-views.tsx:95,103`, `packages/ui/src/dialog.tsx:85`).
- E2 no accent token (accent/foreground): the client's second brand colour has nowhere to go.
- E3 radii are a size scale, not roles: `rounded-md` is used about 80 times (buttons, inputs, menus, alerts, product images),
  `rounded-lg` about 17 (cards): `controlBase` (`packages/ui/src/styles.ts:7`), `button.tsx:39`, `alert.tsx:31`,
  `product-image.tsx:47,62`.
- E4 logo is text only (`site-header.tsx:81-82`, `.fk-logo` in `globals.css:48`); no slot for an image logo (light/dark).
- E5 the shop name lives in four places (2 storefront JSON, 2 admin JSON, `apps/admin/index.html:8`) plus the display name of the
  `EMAIL_FROM` env; tests hard-code it (`page-metadata.spec.ts` 6 literals, e2e `design-a`, `design-b`, `mobile-ux`, admin
  `serving.e2e.ts:42`; `design-kit.spec.tsx:169-170` pins exact `textStyles` strings).
- E6 non-colour tokens (radius, font, scale, spacing) are repeated in the light and dark blocks (`tokens.css` 27-50 and 72-95);
  colours and shadows three times (light, dark, system) plus by hand in `email-theme.ts`: about 70 values instead of 30 per rebrand.
- E7 the admin imports the same `tokens.css` and is rebranded too (ADR 0002 "shares tokens"); nothing says whether that is wanted.
- E8 demo assets carry the old palette (`public/home/hero.svg`, `banner-1.svg`, `banner-3.svg`; light background glares in dark).
- E9 no favicon, `theme-color`, manifest or default og image; no rebranding checklist; the docs do not say where the name/logo live.

Reshape experiment (`experiment/reshape-test`, 31 files, +859/-157, five change requests):
- R1 no slots (`docs/contracts/README.md`: "`slots.md` not written yet"), no card variant registry, no header/footer composition
  config. Only `config/home.ts` (order of sections) and `layout/navigation.ts` worked as configuration.
- R2 presentation and logic mixed: offer -> availability/price/link/label computed inside the presentational card
  (`components/product-card.tsx:63-82`); column classes and the single `ProductCard` hard-coded in `product-grid.tsx:17`;
  the card shape is duplicated in the home skeleton (`home-sections.tsx` product row skeleton); a square image default is hard-coded
  in `store-image.tsx:75`; the home page wraps everything in one `<Container>` (`app/[locale]/(site)/page.tsx`), so a full-bleed hero
  needs a code edit; `hero.tsx:42` has one two-column layout.
- R3 URL state is not extensible: `KNOWN_PARAMS` (`lib/search-query.ts:286`) and `searchPath` drop an unknown `view` param, so a
  list/grid toggle is lost on filter, sort or page change.
- R4 the hidden cost: the first-HTML byte budget. `shell.spec.tsx` pins the footer under 1,400 bytes (the template uses 1,377) and
  the header under 3,700 bytes (3,552 used); a 4-column footer measured 2,816-2,809 bytes and turned the English register form from
  inline to "behind the loading view" without scripts. Any client header/footer is "L" until this is solved.
- R5 data the design asks for does not exist in the API: compare-at price and default variant id in the list item
  (`ProductSummary`), a "popular" sort, a brands endpoint.
- R6 tests pin classes/markup instead of behaviour (`shell.spec.tsx:66-73,145,168`, `design-a.spec.tsx:117-131`,
  `home-sections.spec.tsx:212`, `config/home.spec.ts:109`, e2e `design-b.e2e.ts:143-160`, `ui-polish.e2e.ts:201-213`).
- R7 `messages/*.json` is one flat file per language; every PR adds keys next to other keys, so a fork conflicts on every update.

## 3. Principles

1. A redesign must be possible through, in this order: tokens, typed config, i18n override files, NEW files registered in config.
   Editing a core file is a defect of the template, not the client's job (AGENTS.md section 17).
2. Defaults stay as they are: every work package below must leave the current look pixel-identical with default settings
   (verified by before/after screenshots, section 7).
3. Additive only: new tokens, new config fields with defaults, new optional props. No renames of public tokens (SemVer minor).
4. Presentation components stay dumb; decisions about data (availability, price, link) move to pure view-model functions.
5. Customization points are listed in `docs/contracts/` (tokens exist; this plan adds `branding.md`, `slots.md`, `layout-config.md`).

## 4. Work packages

Sizes are developer-days for a developer who knows the repo. Owner paths per AGENTS.md section 10. WP order and parallelism in 5.

### WP1 Tokens (packages/theme, packages/ui styles, storefront components touching classes)
- T1 display font: `--fk-font-display` (default = current sans stack, so no visual change), Tailwind mapping `font-display`, `textStyles`
  headings use it; replace the ~16 bypassing headings (E1) by `textStyles`; add a guard spec: no `<h1..h3>` outside `textStyles`.
  Size S. Email theme: no new field (display font is not used in mail in this plan; recorded as a known limit).
- T2 accent: `--fk-color-accent`, `--fk-color-accent-foreground` for light, dark and system blocks, default values chosen to pass
  contrast; add the pair to `contrast.spec`; used by no component by default (a client may use it through new classes). Size S.
- T3 role radii: `--fk-radius-control`, `--fk-radius-card`, `--fk-radius-overlay` defined as aliases of the existing scale values
  (so no visual change), Tailwind mapping `rounded-control|card|overlay`, components switch from `rounded-md/lg` by ROLE
  (controls: buttons, inputs, selects, checkboxes; cards: product card, banner card, panels; overlay: menus, dialogs, popovers;
  media: images keep their own role `--fk-radius-media`). About 100 class edits; guard: design guard rejects raw `rounded-md/lg`
  in components outside an allow-list. Size M.
- T4 single definition of non-colour tokens: font, radius, type scale and spacing in one `:root` block; the dark and system blocks
  keep only colours and shadows; a pure script/test derives the system block from the dark block and checks `email-theme.ts` against
  `tokens.css` (the existing `theme.spec`/`email-theme.spec` become the generator's check); a documented command
  `pnpm theme:check` (no new dependency). Size M.
- T5 docs: update `docs/contracts/theme-tokens.md` (additive list), `docs/files/theme.md`, a migration note (no breaking change).

### WP2 Branding (storefront config, messages, admin shell, tests)
- B1 `apps/storefront/src/config/brand.ts` (typed): `name` (i18n keys per locale or literal), `logo: {light, dark, alt}` or text-only,
  `favicon`, `themeColor` (light/dark), `ogImage`; consumed by the header, footer, page metadata (`seo`), legal pages and the 404;
  default = today's text-only brand. The header size budget (R4) must not grow: logo image is optional and `loading=eager`.
- B2 admin brand: the admin takes name/title from its own small `apps/admin/src/config/brand.ts` (title in `index.html` generated at
  build or set at runtime through `document.title`; no hard-coded literal); ADR 0047 decides whether the admin follows the shop tokens
  (default: yes, as today) and adds an empty `apps/admin/src/theme-overrides.css` imported after `tokens.css` so a fork can pin the
  admin to a neutral look without editing core files.
- B3 tests read the brand from the messages/config instead of literals (`page-metadata.spec.ts`, e2e design-a/b, mobile-ux, admin
  serving); `design-kit.spec` stops pinning exact `textStyles` strings (asserts roles instead).
- B4 neutral demo assets: grey hero and banner SVGs (and a dark-safe background) so a rebrand does not leave an indigo hero;
  seeds images untouched (content).
- B5 `docs/customization.md`: the rebranding checklist (tokens, name, logo, favicon/theme-color/og, `EMAIL_FROM`, messages overrides,
  demo assets, tests, admin), with the real file paths; linked from README, storefront README and AGENTS.md.
  Size of WP2: M.

### WP3 Messages (storefront i18n)
- M1 split `messages/{uk,en}.json` into `messages/{uk,en}/<area>.json` (home, catalog, cart, checkout, account, footer, shop pages,
  banners...), merged statically; `client-messages.ts` prefix list and `messages.spec` (parity, no hardcoded text) adapted.
- M2 override layer: `apps/storefront/src/messages-overrides/{uk,en}.json` (empty by default), deep-merged last; documented as the
  only place a fork edits copy. Size M. Risk: loader change touches every page: covered by messages/parity specs and the full e2e.

### WP4 Layout composition (storefront, packages/ui)
- L1 SPIKE then decision (ADR 0048): remove the first-HTML byte budget as a DESIGN constraint. Facts: the budget exists because React
  19.3 outlines a finished section behind the loading view when the HTML before it plus the section exceed `progressiveChunkSize`
  (12,800 bytes); routes under `(site)/loading.tsx` are affected, the `(pages)` group has no loading file and is not. Candidate
  fixes to MEASURE (exit criteria: register/login/checkout forms render inline without scripts in uk and en with a client-sized
  header and a 4-column footer): (a) put the pre-hydration forms (login, register) into a route group without `loading.tsx`;
  (b) stream the footer after the page content (Suspense island); (c) both. Replace `shell.spec` byte pins by a loose sanity cap
  plus the existing `pre-hydration-forms` e2e as the real guard. Note a past finding: moving the home page out of `(site)` made the
  header search lose typed text in 5 of 40 runs (design-b plan results): the spike must re-measure that. Size M (spike S, 0.5 d).
- L2 card variant registry: pure `lib/product-card-model.ts` (`cardDisplay`: availability, price, link, label from the offer), the
  card variants `standard` (today) and `horizontal` (list) as separate components, `config/catalog.ts`:
  `{ cardVariant, gridColumns, imageRatio, listToggle }`, `ProductGrid` and the skeletons read the same config; a fork adds
  `components/cards/<name>.tsx` and a line in `config/catalog.ts` (registry in a new file, no edit of `product-grid.tsx`).
  The list/grid toggle ships as a real feature of the template (`?view=list`), URL state included (L5). Size L.
- L3 header and footer composition: `config/header.ts` (`layout: "inline" | "centered"`, announcement bar, search placement) and
  `config/footer.ts` (ordered blocks: links, contacts, social, payments, newsletter placeholder = no, theme switch, legal), by the
  pattern of `config/home.ts` (typed union, exhaustive switch). Depends on L1 for the byte budget. Size L.
- L4 home sections: common `width: "contained" | "full"`; hero `layout: "split" | "overlay"`; `Container` moves from the route into
  the sections. Size M.
- L5 presentation URL params: `lib/search-query.ts` keeps a configured whitelist of presentation params (`view`, `density`) through
  `searchPath`, redirects and forms. Size S.
- L6 tests move from classes/markup to behaviour: roles, accessible names, order, geometry in e2e; the size pins as in L1.

### WP5 Slots contract (RED ZONE: public contract)
- S1 `docs/contracts/slots.md` and `config/slots.tsx`: typed registry of named slots (`product-card.badges`, `product-card.actions`,
  `footer.columns`, `header.top`), each an ordered list of components registered in a config file; empty by default. No feature
  system for the storefront exists, so slots serve client code and future features. Needs owner approval (section 9). Size M.

### WP6 Data for design (RED ZONE, NOT in this execution)
Compare-at range and default variant id in the list item, `sort=popular`, `GET /store/brands`. Written as a separate plan with its own
review; listed here only so WP2 and WP4 do not invent fake data (the experiments' badge and "bestsellers" were TODO placeholders).

### WP7 Acceptance and docs
- A1 re-run the rebrand experiment (client "Verde Kopi") and the reshape experiment (five requests) on the finished code, by fresh
  agents that do NOT know the codebase changes, with the checklist as the only guide; report hours, files touched, conflicts.
- A2 `docs/customization.md` final, migration note for forks (`docs/migrations/`), CHANGELOG lines, `docs/files/*`, HANDOFF.

## 5. Sequence and parallelism

```
WP1 T1-T4 ----> WP2 (B1,B3,B4,B5) ----> WP7 A1/A2
      \            WP2 B2 (admin) can start with WP1
       \--> WP4 L2 (after T3) --> L3, L4 (after L1)
WP3 (messages) in parallel with WP1 (disjoint files), but merged before WP2/WP4 add keys
WP4 L1 (spike) starts immediately in parallel (read-only measurement first)
WP5 after WP4 L2/L3 (needs the registries); WP6 separate
```
PR plan (each: owner agent -> QA -> independent code review -> CI 21/21 -> merge with owner consent):
PR1 T1+T2+T5 (tokens, display font, accent) · PR2 T3 (role radii) · PR3 T4 (single non-colour definition + theme check) ·
PR4 WP3 (messages split + overrides) · PR5 L1 spike report + ADR 0048 · PR6 WP2 (brand config, admin brand, tests, assets, checklist) ·
PR7 L2+L5 (card registry, list/grid, URL params) · PR8 L1 implementation (byte budget) · PR9 L3+L4 (header/footer/home composition) ·
PR10 S1 (slots, after approval) · PR11 A2 docs/migration. A1 acceptance runs after PR9.
Files shared by several PRs (CHANGELOG, HANDOFF, messages): merge main before each PR; messages split (PR4) goes first to cut conflicts.

## 6. Risks

- Visual regression from the ~100-class radius change (PR2) and the card refactor (PR7): mitigated by pixel/screenshot comparison at
  default settings and the full storefront e2e.
- L1 may not be solvable without a trade-off (for example a footer shown after the content); the ADR must state what it costs
  (layout shift, CLS) and measure it; if it fails, the fallback is to document the budget as a design constraint with a checker script.
- Messages split changes the loader for every page and the client bundle prefixes: size and hydration risk.
- Scope creep into features (wishlist, newsletter): out of scope; slots exist so features can plug in later.
- Fork migration: forks that edited the same files will conflict once; the migration note lists every touched file.
- Test churn: tests pinning classes will be rewritten in the same PRs; no test is weakened without a replacement.

## 7. Verification (per PR and at the end)

lint, format:check, typecheck, check:boundaries, check:docs, check:env, `pnpm --filter @fluxkit/theme test` (design guard, contrast,
tokens), ui/admin/storefront unit tests, full storefront e2e and admin e2e (both run only in CI: the sandbox cannot start Postgres);
before/after screenshots of home, catalog (grid and list), product page, cart, checkout, footer, header at 390 and 1280, light and dark,
default settings = identical; a11y spot checks (keyboard, focus rings, contrast pairs, reduced motion); bundle budget of the admin
(445,000 raw / 135,000 gzip) not exceeded; storefront first-HTML sizes reported before/after.

## 8. Roles

Architect (ADRs 0047 admin tokens/overrides, 0048 byte budget, the slots contract, review of every public-contract change) ·
Developer agents per PR (one owner per path) · QA agents (behavioural verification in a real browser against the stack, screenshots,
re-run of the two experiments) · independent code reviewer on a different model than the author for every PR · orchestrator
(this plan, integration, Definition of Done, HANDOFF).

## 9. Decisions needed from the owner (red zones and policy)

1. Slots contract (WP5): a new public contract. Recommended: approve, minimal four slots.
2. Admin and branding (B2/ADR 0047): recommended default "admin follows the shop tokens, with an empty overrides file for forks".
3. Messages split and overrides folder (WP3): changes where copy lives. Recommended: approve.
4. WP6 (API data for design): separate plan later; not started by this one.
5. Whether the list/grid toggle ships in the template by default (recommended: yes, default grid).

## 10. Open questions for the reviewers

- Is `--fk-radius-media` a fourth role or should media follow `card`? Should the role radii also exist for the admin?
- Is deriving the system block by a check (not a generator) enough, or must `tokens.css` be generated?
- L1: which of (a), (b), (c) is the right trade-off; is there a Next 16 option to raise or bypass the progressive chunk size?
- Are 11 PRs the right granularity? Which can merge?
- Which acceptance threshold for "pixel-identical" (tolerance) is reasonable for the screenshot comparison?
