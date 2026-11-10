# Customizing a client fork

The one entry point for a fork author (plan `docs/plans/2026-11-08-design-changeability.md`, B5). It lists what exists on `main` today; planned work is
marked **not yet available**. Rules behind it: `AGENTS.md` sections 2.2, 15 and 17. Client work happens in a fork, never in this repository.

## 0. Before you start (once per fork)

1. In a commit (and PR) of its own, FIRST, before any other change: create an empty file `.fluxkit-fork` at the repository root and
   delete `apps/storefront/src/fork-marker.upstream.spec.ts` (it fails while the marker exists: the template must never contain it).
   The marker tells `pnpm check:docs` (CI job `docs`) that this is a fork: the storefront config files the fork fills (`brand`,
   `catalog` (the file does not exist yet: **not yet available**), `header`, `footer`, `slots`, `custom-sections` and `home` in `apps/storefront/src/config/`, and
   `apps/storefront/src/components/cards/custom.ts`) then need no change under `docs/contracts/`. The check reads the marker from the
   PR's BASE branch, so no PR relaxes its own check: the marker PR itself is still checked with the template's rule and passes, because
   it touches no contract file; every later PR (based on a branch that has the marker) runs in fork mode. Mixing config changes into
   the marker PR fails its `docs` job. A tree with both the marker and that spec fails the check too (it names the file to delete).
   Without the marker, the first PR that fills a config file fails that job. Rule and the files that keep it: `docs/contracts/README.md`.
   Locally, `pnpm check:docs` compares with `origin/main`: when that ref has no marker (the template's remote, or a fork whose marker PR is not merged yet) it is red on a branch
   that fills a config file. Run `node scripts/check-docs.mjs --base <the marker commit>` instead; once the fork's main has the marker, the plain command is enough.
2. Build before any test command in this guide: `pnpm install`, then `pnpm build` (the specs import the built workspace packages,
   `@fluxkit/ui`, `@fluxkit/theme` and the others, and the admin's `apps/admin/build-output.spec.ts` reads `apps/admin/dist`). Rebuild what
   you changed before its tests: `pnpm --filter @fluxkit/admin build` after an admin change (name, favicon, `admin-overrides.css`),
   `pnpm --filter @fluxkit/theme build` after a change of `email-theme.ts` or `theme-color.ts` (the apps import the built copy; the CSS
   files are read from source). The root `pnpm test` builds first by itself; the per-package
   `pnpm --filter ... test` commands below do not.
3. The upstream-only checks a fork deletes, all of them (each fails on purpose once the fork changes what it pins; nothing else needs a test
   edit, `apps/storefront/src/customization-doc.spec.ts` lists the same files):
   - `apps/storefront/src/fork-marker.upstream.spec.ts`: in step 1, with the marker.
   - `apps/storefront/src/lib/home-template-default.upstream.spec.ts`: once `config/home.ts` differs from the template (section 3).
   - `apps/storefront/src/components/header-footer-defaults.upstream.spec.tsx` and its folder `apps/storefront/src/components/header-footer-defaults/`:
     once `config/header.ts`, `config/footer.ts` or `config/brand.ts` changes (section 3).
   - `apps/storefront/src/config/slots.upstream.spec.ts`: once a slot is filled (section 3).
   - `apps/storefront/src/components/cards/custom.upstream.spec.ts`: once `cards/custom.ts` registers a card (section 3, product cards).
   - `packages/theme/src/brand-overrides.upstream.spec.ts`: once `brand-overrides.css` has rules (step 4).
   - Not a file: the one test marked TEMPLATE-DEFAULT CHECK in `apps/storefront/src/config/brand.spec.ts`, once `config/brand.ts` is filled
     (section 1, step 7).

   Overriding a card in `cards/custom.ts`, a four-column footer and renaming the shop or the admin need no other test edit than the deletions above: the specs that pin the
   template's own markup read its defaults from `apps/storefront/src/test-support/template-defaults.ts`.

## 1. Rebrand checklist (target: under 2 hours)

Do these in order. Each step names the file, whether the fork owns it (section 2) and how to check it. Every check assumes the build of
section 0, step 2.

| # | What | Where | Fork-owned | Check |
|---|---|---|---|---|
| 1 | Shop name and page title | `site.name`, `site.title`, `site.description` in `apps/storefront/src/messages-overrides/uk.json` and `apps/storefront/src/messages-overrides/en.json` (flat key -> text; a key the base does not have fails the build) | yes | `pnpm --filter @fluxkit/storefront test` (parity, placeholders) |
| 2 | Other storefront texts (hero, trust bar, shop pages, contacts) | the same overrides files; the keys are in `apps/storefront/src/messages/uk/` and `apps/storefront/src/messages/en/` (one file per area) | yes | same |
| 3 | The fork's own new texts | `apps/storefront/src/messages-extra/uk.json` and `apps/storefront/src/messages-extra/en.json`, keys under `custom.` only | yes | same |
| 4 | Storefront colours, radii, shadows, type scale, display font | `packages/theme/src/brand-overrides.css` (imported after `packages/theme/src/tokens.css` by the storefront and, light rule only, by the admin): the rules `:root, [data-theme="light"]`, `[data-theme="dark"]` and the `system` rule in its media query, in that order; colours and shadows in all three (a light-only colour would also win on dark pages), every other token in the light rule only; the comment at the top of the file has an example. A new `--fk-color-muted`/`--fk-color-background` can push the template's `success` and `warning` text below 4.5:1: restate those two in all three rules too (the theme tests name the failing pair). A system serif or other system stack needs no `fonts.ts`: write it straight into `--fk-font-display` (step 6 is only for web fonts); mail buttons take `--fk-radius-md` (`emailTheme.radius.md`, step 5), not the role radii, so "4 px buttons" reaches mail only if the scale is changed too. Rules and names: `docs/contracts/theme-tokens.md` "Storefront overrides". Do not edit `tokens.css` | yes | `pnpm --filter @fluxkit/theme test` (the file's rules, contrast pairs on the effective values in every mode, mail colours and theme colour equal the effective values); then delete the upstream-only `packages/theme/src/brand-overrides.upstream.spec.ts` (it pins the empty file) |
| 5 | Mail colours and the browser theme colour | `packages/theme/src/email-theme.ts` (light colours, font stacks, radii in px) and, for a changed `--fk-color-background`, `packages/theme/src/theme-color.ts`: the two files a rebrand still edits outside the fork-owned files (literal copies: mail and `<meta name="theme-color">` cannot read CSS variables). `email-theme.spec.ts` and `theme-color.spec.ts` fail until they equal the effective values of step 4 and print the literals to write | **no** (expect a conflict when upstream changes them) | `pnpm --filter @fluxkit/theme test` |
| 6 | Web fonts | `apps/storefront/src/config/fonts.ts` (self-hosted `next/font/local`, woff2 next to it), then `--fk-font-display` or `--fk-font-sans` in the light rule of `packages/theme/src/brand-overrides.css`; rules in `apps/storefront/README.md` "Fonts" and `docs/contracts/theme-tokens.md` "Fonts" | yes | `pnpm --filter @fluxkit/storefront test` (`config/fonts.spec.ts`) |
| 7 | Logo, browser icons, theme colour, default social picture | `apps/storefront/src/config/brand.ts` with the files in `apps/storefront/public/` (for example a new `public/brand/` folder); contract `docs/contracts/branding.md`. Defaults: text logo, no icon, no `theme-color`, no `og:image` | yes | `pnpm --filter @fluxkit/storefront test` (`config/brand.spec.ts`: the named files exist; its one test marked TEMPLATE-DEFAULT CHECK pins upstream's empty values: delete it in the fork. Every other spec already runs once with a filled config, `vitest.brand-fork.config.ts`) |
| 8 | Light/dark default and the theme switch | `apps/storefront/src/config/theme.ts` (`defaultMode`, `showToggle`) | **no** | - |
| 9 | Admin colours, radii or font different from the shop | `packages/theme/src/admin-overrides.css` (ADR 0047; light rule only). Empty = the admin follows the shop: the light rule of step 4 reaches it. A neutral admin restates the template's values (`tokens.css`, light block) of the tokens step 4 changed. A font token of step 4 with `var(--font-...)` must be restated here without it (the admin has no `next/font`; `theme.spec.ts` names it) | yes | `pnpm --filter @fluxkit/admin test`, `pnpm --filter @fluxkit/theme test` (contrast pairs on the admin's effective values) |
| 10 | Admin name and favicon | `app.name` and `app.documentTitle` (keep `{page}`) in `apps/admin/src/messages-overrides/uk.json` and `apps/admin/src/messages-overrides/en.json` (flat key -> text over `apps/admin/src/messages/`; a key no message file has, or an empty value, stops the build; `apps/admin/README.md`); a new `favicon.svg` (or `.png`, `.ico`) in a new `apps/admin/public/` folder | yes | `pnpm --filter @fluxkit/admin test` (`build-output.spec.ts`) |
| 11 | Sender name in mail (the shop name in mail) | `EMAIL_FROM` display name in the environment (`docs/contracts/config.md`) | environment | API boot refuses a malformed value |
| 12 | Home page pictures | replace `apps/storefront/public/home/hero.svg` (640 x 480) with the same name and size, or point `apps/storefront/src/config/home.ts` at a new file; the home banners are edited in the admin (Storefront -> Home banners); the static `config` banners use `apps/storefront/public/home/banner-1.svg` to `banner-3.svg` (640 x 320) | pictures yes (replace in place), `home.ts` **no** | `pnpm --filter @fluxkit/storefront test` (`config/home.spec.ts`: file exists, `viewBox` equals the size) |
| 13 | Demo copy before a release | replace the demo texts (trust bar, shop pages, contacts, home) and the legal placeholders; `apps/storefront/src/config/legal-identity.json`, `apps/storefront/src/config/demo-content.json`; build with `STOREFRONT_REQUIRE_LEGAL_TEXT=true` | **no** | `next build` refuses while a placeholder or listed demo copy remains |

After the rebrand: `pnpm lint`, `pnpm typecheck`, `pnpm test` (builds first), `pnpm test:e2e` (builds first; needs the services) (`apps/storefront/e2e/README.md`). Unit and e2e tests read the shop name from the
merged messages (`apps/storefront/e2e/support/shop-name.ts`; `apps/storefront/src/brand-literals.spec.ts` keeps it so), so renaming the shop needs no
test edit. Other e2e locators use the template's English and Ukrainian texts: a fork that overrides such a text updates those e2e files.

To see the result against the template, `bash scripts/visual-compare.sh <upstream ref>` (computed styles and screenshots; `apps/storefront/e2e/README.md`,
"Visual comparison").

## 2. Fork-owned files

Upstream creates these once and never edits them again, so merging upstream never conflicts in them. They are empty or hold the template's defaults.

- `apps/storefront/src/messages-overrides/uk.json`, `apps/storefront/src/messages-overrides/en.json` (`{}`)
- `apps/storefront/src/messages-extra/uk.json`, `apps/storefront/src/messages-extra/en.json` (`{}`)
- `apps/storefront/src/config/fonts.ts` (no fonts)
- `apps/storefront/src/config/brand.ts` (text logo, nothing else)
- `apps/storefront/src/config/header.ts`, `apps/storefront/src/config/footer.ts` (the template's header and footer, section 3)
- `apps/storefront/src/config/custom-sections.ts` (no custom home section)
- `apps/storefront/src/components/cards/custom.ts` (no card of the fork's own; `docs/contracts/card-registry.md`)
- `apps/storefront/src/config/slots.tsx` (no slot component; `docs/contracts/slots.md`)
- `packages/theme/src/brand-overrides.css` (no rules)
- `packages/theme/src/admin-overrides.css` (no rules)
- `apps/admin/src/messages-overrides/uk.json`, `apps/admin/src/messages-overrides/en.json` (`{}`)
- files a fork adds: its pictures under `apps/storefront/public/`, the admin favicon in `apps/admin/public/`

Every other file is upstream's. Editing one is a core edit: allowed in a fork, but it may conflict on every update. Prefer a config value, a fork-owned
file, or ask upstream for an extension point (`AGENTS.md` section 17).

## 3. Layout and composition (what exists today)

- Home page sections and their order: `apps/storefront/src/config/home.ts` (upstream-owned; `apps/storefront/README.md` "Layout composition is configuration").
  Contract: `docs/contracts/home-sections.md`.
  - A section of the fork's own (for example a brand strip or a full-bleed hero): write a SERVER component in a new file (it receives
    `CustomSectionProps` from `apps/storefront/src/lib/custom-sections.ts`: id, heading id, locale, translator, first-on-page, width), register it by
    name in the fork-owned `apps/storefront/src/config/custom-sections.ts`, add `{ kind: "custom", id: "home-brands", name: "brandStrip" }` to `home.ts`
    and its texts under `custom.` in `apps/storefront/src/messages-extra/uk.json` and `en.json`.
  - Width: `width: "full"` (custom sections only) renders the section edge to edge WITHOUT a container: the component draws its own surface with token
    classes and keeps its content readable (for example `Container` of `@fluxkit/ui` inside a `bg-muted` band). `contained` is the default. The built-in
    sections are contained only (no edge-to-edge layout yet); no hero text overlay. A component that throws takes the home page down (no per-section
    error boundary): handle a failed read inside the component.
  - Tests in the fork (after `pnpm build`, section 0): run `pnpm --filter @fluxkit/storefront test`. `apps/storefront/src/components/home-config.spec.ts` checks the fork's real
    `home.ts` against its real registry (a typo in a name fails it; `next dev` fails too, production logs and leaves the section out). The specs that pin
    the template's default home page (`apps/storefront/src/lib/home-template-default.ts`) skip themselves once `home.ts` or the text overrides differ,
    with the reason in their names. One spec is upstream-only and FORK-DELETABLE: `apps/storefront/src/lib/home-template-default.upstream.spec.ts`
    (it fails once `home.ts` differs from the copy, telling upstream to update the copy): a fork that changed `home.ts` deletes it. The upstream fork
    run (`apps/storefront/vitest.home-fork.config.ts`) uses upstream's fixture config and registry, and the fork's REAL message extras with the
    fixture's texts merged over them, so the fork's own `custom.` keys still resolve there: a fork neither needs nor edits it.
- Header: `apps/storefront/src/config/header.ts` (fork-owned; contract `docs/contracts/header-footer.md`). Without a code edit a fork can:
  reorder or leave out the blocks of the one header row (menu button, logo, navigation, search box, controls), reorder or leave out the
  controls at the end (language, cart, account), set how many top-level categories show (0 to 12) and which links follow them
  (message key plus storefront path; a new text goes into `apps/storefront/src/messages-extra/uk.json` and `apps/storefront/src/messages-extra/en.json` under `custom.`).
  Supported orders: the logo is required, `controls` (when listed) is the last block, menu and navigation go together, and the menu is
  either the first block shown on a phone (before the logo; the default) or the last one (after the logo, with no controls group: "logo
  left, menu right"); the list and the browser measurement are in `docs/contracts/header-footer.md`. Any other order fails the tests and,
  if they were skipped, every page (a bare 500). Very long category names can still make the menu wider than a 320 px phone (known limit).
- Footer: `apps/storefront/src/config/footer.ts` (fork-owned, same contract): reorder or leave out the blocks (navigation, contacts,
  theme switch, copyright), add plain text lines from messages (for example the accepted payment methods), and order the link groups of
  the navigation (shop pages, legal pages, the fork's own lists of internal paths), each with an optional small heading. Which shop pages are
  linked stays `inFooter` in `apps/storefront/src/config/shop-pages.ts`; the contacts are `apps/storefront/src/config/contacts.ts`; whether
  the theme switch exists is `showToggle` in `apps/storefront/src/config/theme.ts` (the footer must list `themeSwitch` while it is true).
- Check (after `pnpm build`, section 0): `pnpm --filter @fluxkit/storefront test` (`config/header` and `config/footer` are checked by `apps/storefront/src/layout/header-layout.spec.ts`
  and `apps/storefront/src/layout/footer-layout.spec.ts`; an unknown block name fails `pnpm typecheck`). After changing either file (or `config/brand.ts`),
  delete the upstream-only, FORK-DELETABLE `apps/storefront/src/components/header-footer-defaults.upstream.spec.tsx` and its folder `apps/storefront/src/components/header-footer-defaults/`:
  a TEMPLATE-DEFAULT check of upstream's default markup. Every other spec already runs once with filled brand, header and footer configs (`apps/storefront/vitest.brand-fork.config.ts`,
  the footer there is the four-column recipe below); the specs that pin the template's own frame and footer read the template's defaults
  (`apps/storefront/src/test-support/template-defaults.ts`), so they stay green with the fork's files and need no edit.
- UI slots (S1; fork-owned `apps/storefront/src/config/slots.tsx`, contract `docs/contracts/slots.md`): SERVER components in the fork's new
  files, listed per slot, rendered in order with a plain view model (locale, translator, the slot's data); empty slots render nothing.
  - `header.top`: an announcement bar inside the header, above its row. Below `lg` it is sticky with the header, which grows by the bar's
    height, while `scroll-padding-top` (80 px, `apps/storefront/src/app/globals.css`) does not: keep the bar short, show it only from `lg`
    (`max-lg:hidden`), or raise `scroll-padding-top` there (a core edit: `brand-overrides.css` holds token values only).
  - `product-card.badges`, `product-card.actions`: badges in a row above the brand and title, actions in the image's bottom right corner
    (`grid`; the availability badge keeps the top left) or at the end of the price row (`list`) of the built-in cards. An action is a control
    of its own (a client island's button, not a second link to the product), with an opaque background, an accessible name with the title and
    a 44 px target; on `grid` it comes before the title in the focus order, and the card's focus outline shows while it has the focus. A
    fork's own card kind gets no slots unless it calls `renderSlot` of `apps/storefront/src/lib/slots.ts`.
  - `footer.columns`: columns at the top of the footer (side by side from `sm`, up to four per row from `lg`). A four-column footer (plan
    target 5): four column components, and `navigation` and `contacts` left out of `blocks` in `config/footer.ts`; the columns render the
    links and contacts from their props. Example: `apps/storefront/src/lib/slots-fork-fixture.tsx` (shop pages, legal pages, contacts, a
    newsletter placeholder). The footer's own rules in `apps/storefront/src/app/globals.css` style column content too (`ul` a wrapping row,
    links `whitespace-nowrap`): put `flex-col` on a column's list and `whitespace-normal` on its links, or long names (uk legal pages) run past
    the column. Register only columns that render: the grid counts the registered components, so one returning `null` leaves an empty cell.
  - Pictures in a slot component (payment icons, a logo strip): files under `apps/storefront/public/`, shown with `LocalPicture` of
    `apps/storefront/src/components/local-picture.tsx` and a `LocalImage` (`{ src, width, height, altKey }`, type in
    `apps/storefront/src/config/home.ts`; `altKey: null` for a decorative picture). A plain `<img>` or `next/image` in a fork's file fails
    `apps/storefront/src/source-guards.spec.ts` (images go through `StoreImage` or `LocalPicture` only). Known gap: `LocalPicture` and
    `LocalImage` are internal, not contract (`docs/contracts/slots.md` does not list them), so a minor release may change them; there is no
    contract-safe way to show a local picture in a slot yet.
  - Texts through `t` with `custom.` keys in `messages-extra`; token classes only; an interactive part is a client component the server
    component renders with plain props (a client component registered directly throws). A component that throws takes the page down
    (`header.top` and `footer.columns`: every page, Next's bare 500); handle a failed read inside it. An unknown slot name fails `tsc`,
    `next dev` and the tests; production logs it once and leaves it out.
  - Tests in the fork (after `pnpm build`, section 0): delete the upstream-only, FORK-DELETABLE `apps/storefront/src/config/slots.upstream.spec.ts` once a slot is filled
    (it pins the template's empty registry; `apps/storefront/src/customization-doc.spec.ts` allows it to be missing). The specs that check the
    template's own markup (frame, cards, the default home page) keep the slots empty, so `pnpm --filter @fluxkit/storefront test` stays green
    with filled slots; upstream runs the suite with every slot filled twice: with the default home page (`apps/storefront/vitest.brand-fork.config.ts`)
    and with a reshaped one (`apps/storefront/vitest.home-fork.config.ts`).
- **Needs a code edit** (core files `apps/storefront/src/components/site-header.tsx`, `apps/storefront/src/components/site-footer.tsx`, `apps/storefront/src/app/globals.css`):
  a centred header or a second header row (plan target 3 is NOT reached by design; an announcement bar is the `header.top` slot), a card
  badge over the image or any change inside the card other than the two slots (or a card of the fork's own, `cards/custom.ts`), a slot at
  another place (product page, cart, checkout: no slot there), payment icons as pictures in the template's blocks (a `footer.columns`
  column may show local pictures), the "powered by" line (always last). Social links: refused in `config/footer.ts` (external URLs), a
  `footer.columns` column of the fork renders them.
- Header and footer link sources besides the configs: the legal pages in `apps/storefront/src/config/legal.ts`; account and cart targets in
  `apps/storefront/src/layout/navigation.ts` (upstream-owned); trust bar: `apps/storefront/src/config/trust-bar.ts`; category page header:
  `apps/storefront/src/config/category-page.ts`.
- Product cards and the list/grid view (L2, L5): a fork overrides the `grid` or `list` card in the fork-owned
  `apps/storefront/src/components/cards/custom.ts` (contract `docs/contracts/card-registry.md`); the catalog's `?view=list` switch ships in the template.
  Tests in the fork (after `pnpm build`, section 0): delete the upstream-only `apps/storefront/src/components/cards/custom.upstream.spec.ts` (it pins the empty registry); nothing else. The specs that pin the built-in cards render them with the template's defaults
  (`apps/storefront/src/test-support/template-defaults.ts`), and upstream runs the suite with both cards overridden (`apps/storefront/vitest.brand-fork.config.ts` and `apps/storefront/vitest.home-fork.config.ts`).
- Guards that scan a fork's own files (cards, slots, custom sections, any new component). Run `pnpm --filter @fluxkit/theme test` as well as the storefront tests after such a change: the design guard lives there, not in the storefront suite.
  - Theme: no arbitrary Tailwind values (`aspect-[4/5]` is refused, `aspect-4/5` works); radii only from the roles (`rounded-control|card|panel|overlay|media`, `full`, `none`: `rounded-sm`, `rounded-md`, `rounded-lg` are refused in new files); a heading writes its `textStyles.<role>` inline (a role kept in a constant is refused); an `outline-*` colour class without a `bg-` in the same string (like `text-`, `border-`, `ring-`) counts as a contrast pair on `background` and fails unless the pair is listed: add a `bg-` class to the same string. Separately, there is no fork stylesheet and no utility for small caps or for an arbitrary grid: those have no token-safe route yet.
  - Client boundary: a component with `"use client"` must not live in `components/cards/`; put the island in another folder (for example `components/fork/`) and import it.
  - Texts and names: `messages-extra` refuses `TODO` and `fluxkit)` in shopper-visible strings (keep the placeholder wording neutral and the `TODO(fluxkit)` in a code comment); the source guards match substrings, also in comments and type names (`<form>` is matched even in a comment; the provider-name check reads code only, so "StripE" inside the type name `BrandStripEntry` fails); a new file named `payment-*` or `search-*` fails the exact file lists of the source guards, and names such as `cart*`, `account*`, `form*`, `session`, `login` or `register` fall under extra rules (no browser storage, no `console` call with values): rename instead of asking for an exception. The message check also refuses `FIXME`, source paths (`src/`, `.ts`, `.json`) and any `[...]` in a text.

## 4. Known limits

- Mail colours and the browser theme colour are literal copies in upstream files (step 5): a rebrand edits `packages/theme/src/email-theme.ts`
  and `packages/theme/src/theme-color.ts` by hand (their specs print the values).
- The admin takes the light rule of the storefront overrides: a neutral admin restates every changed token in `admin-overrides.css` (step 9),
  and a filled overrides file adds its rules to the admin's CSS too (about +2.3 KB raw, +0.4 KB gzip for the A1 rebrand).
- `packages/theme/vitest.brand-fork.config.ts` runs the theme specs on upstream's fixtures over the fork's `tokens.css`: green for a fork that
  follows step 4; a fork that still edits `tokens.css` may see it fail naming `packages/theme/src/fork-fixture/`.
- A local picture in a slot component goes through the internal `LocalPicture` (section 3, UI slots): no contract-safe way yet.
- Mail has no logo; mail buttons keep the scale radius (`emailTheme.radius`).
- Admin headings do not follow the heading roles; the admin shows its name as text (no image logo).
- `theme-color` follows the theme of the rendered page: after the footer switch changes the theme in the browser, the colour updates on the next page.
- Forced-colours mode: an image logo keeps its own colours, but the page behind it becomes the system canvas (often black or white); a
  transparent logo whose marks vanish on that canvas disappears. Choose a logo that reads on both black and white, or use the light/dark pair.
  Not verified in a browser.
- Both pictures of a light/dark logo pair are downloaded on every page; a React SVG logo component (`currentColor`) is not offered.
- The `<head>` budget: the brand tags may add at most 300 bytes (`docs/contracts/branding.md`, "Head budget"); keep icon paths short.

## 5. Updating from upstream

1. Once: `git remote add upstream <template repository URL>`.
2. `git fetch upstream`, then merge upstream `main` (or a release tag once the template publishes releases; the template follows SemVer, `AGENTS.md`
   section 17, and is not released yet) into a branch of the fork.
3. Read `CHANGELOG.md` and every new note in `docs/migrations/` (one per breaking change, with the files to touch).
4. Fork-owned files (section 2) never conflict. A conflict elsewhere is in a file the fork edited: keep upstream's change and re-apply the fork's.
5. Run the checks of section 1 and, for a design change, the visual comparison.

## 6. Contracts

What a fork may rely on across minor releases: `docs/contracts/README.md`, in particular `docs/contracts/branding.md` (this brand config),
`docs/contracts/header-footer.md` (header and footer composition), `docs/contracts/home-sections.md` (home section width and custom sections),
`docs/contracts/card-registry.md` (product cards and `?view=`), `docs/contracts/slots.md` (UI slots), `docs/contracts/theme-tokens.md` (tokens and fonts), `docs/contracts/config.md`
(environment and features) and `docs/contracts/email-templates.md`.
Anything not listed there is internal.
