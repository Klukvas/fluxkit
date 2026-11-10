# Customizing a client fork

The one entry point for a fork author (plan `docs/plans/2026-11-08-design-changeability.md`, B5). It lists what exists on `main` today; planned work is
marked **not yet available**. Rules behind it: `AGENTS.md` sections 2.2, 15 and 17. Client work happens in a fork, never in this repository.

## 1. Rebrand checklist (target: under 2 hours)

Do these in order. Each step names the file, whether the fork owns it (section 2) and how to check it.

| # | What | Where | Fork-owned | Check |
|---|---|---|---|---|
| 1 | Shop name and page title | `site.name`, `site.title`, `site.description` in `apps/storefront/src/messages-overrides/uk.json` and `apps/storefront/src/messages-overrides/en.json` (flat key -> text; a key the base does not have fails the build) | yes | `pnpm --filter @fluxkit/storefront test` (parity, placeholders) |
| 2 | Other storefront texts (hero, trust bar, shop pages, contacts) | the same overrides files; the keys are in `apps/storefront/src/messages/uk/` and `apps/storefront/src/messages/en/` (one file per area) | yes | same |
| 3 | The fork's own new texts | `apps/storefront/src/messages-extra/uk.json` and `apps/storefront/src/messages-extra/en.json`, keys under `custom.` only | yes | same |
| 4 | Colours, radii, shadows, type scale (storefront and, by default, admin) | `packages/theme/src/tokens.css`: the light block, the dark block and the `system` block (colours and shadows in all three; every other token in the light block only). Names and roles: `docs/contracts/theme-tokens.md` | **no** (upstream edits this file: expect a merge conflict on update; a storefront overrides file is not yet available) | `pnpm --filter @fluxkit/theme test` (contrast pairs in all three modes, mail colours equal the tokens) |
| 5 | Mail colours and the browser theme colour | `packages/theme/src/email-theme.ts` and, for a changed `--fk-color-background`, `packages/theme/src/theme-color.ts` (literal copies: mail and `<meta name="theme-color">` cannot read CSS variables; `email-theme.spec.ts` and `theme-color.spec.ts` fail until they equal the tokens) | **no** | `pnpm --filter @fluxkit/theme test` |
| 6 | Web fonts | `apps/storefront/src/config/fonts.ts` (self-hosted `next/font/local`, woff2 next to it), then `--fk-font-display` or `--fk-font-sans` in the light block of `tokens.css`; rules in `apps/storefront/README.md` "Fonts" and `docs/contracts/theme-tokens.md` "Fonts" | yes (`fonts.ts`) | `pnpm --filter @fluxkit/storefront test` (`config/fonts.spec.ts`) |
| 7 | Logo, browser icons, theme colour, default social picture | `apps/storefront/src/config/brand.ts` with the files in `apps/storefront/public/` (for example a new `public/brand/` folder); contract `docs/contracts/branding.md`. Defaults: text logo, no icon, no `theme-color`, no `og:image` | yes | `pnpm --filter @fluxkit/storefront test` (`config/brand.spec.ts`: the named files exist; its one test marked TEMPLATE-DEFAULT CHECK pins upstream's empty values: delete it in the fork. Every other spec already runs once with a filled config, `vitest.brand-fork.config.ts`) |
| 8 | Light/dark default and the theme switch | `apps/storefront/src/config/theme.ts` (`defaultMode`, `showToggle`) | **no** | - |
| 9 | Admin colours, radii or font different from the shop | `packages/theme/src/admin-overrides.css` (ADR 0047); empty = the admin follows the shop | yes | `pnpm --filter @fluxkit/admin test` |
| 10 | Admin name and favicon | `app.name`, `app.documentTitle` in `apps/admin/src/messages/uk/common.json` and `apps/admin/src/messages/en/common.json`; a new `favicon.svg` (or `.png`, `.ico`) in a new `apps/admin/public/` folder | name **no**, favicon yes | `pnpm --filter @fluxkit/admin test` (`build-output.spec.ts`) |
| 11 | Sender name in mail (the shop name in mail) | `EMAIL_FROM` display name in the environment (`docs/contracts/config.md`) | environment | API boot refuses a malformed value |
| 12 | Home page pictures | replace `apps/storefront/public/home/hero.svg` (640 x 480) with the same name and size, or point `apps/storefront/src/config/home.ts` at a new file; the home banners are edited in the admin (Storefront -> Home banners); the static `config` banners use `apps/storefront/public/home/banner-1.svg` to `banner-3.svg` (640 x 320) | pictures yes (replace in place), `home.ts` **no** | `pnpm --filter @fluxkit/storefront test` (`config/home.spec.ts`: file exists, `viewBox` equals the size) |
| 13 | Demo copy before a release | replace the demo texts (trust bar, shop pages, contacts, home) and the legal placeholders; `apps/storefront/src/config/legal-identity.json`, `apps/storefront/src/config/demo-content.json`; build with `STOREFRONT_REQUIRE_LEGAL_TEXT=true` | **no** | `next build` refuses while a placeholder or listed demo copy remains |

After the rebrand: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` (`apps/storefront/e2e/README.md`). Unit and e2e tests read the shop name from the
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
- `packages/theme/src/admin-overrides.css` (no rules)
- files a fork adds: its pictures under `apps/storefront/public/`, the admin favicon in `apps/admin/public/`

Every other file is upstream's. Editing one is a core edit: allowed in a fork, but it may conflict on every update. Prefer a config value, a fork-owned
file, or ask upstream for an extension point (`AGENTS.md` section 17).

## 3. Layout and composition (what exists today)

- Home page sections and their order: `apps/storefront/src/config/home.ts` (upstream-owned; `apps/storefront/README.md` "Layout composition is configuration").
- Header: `apps/storefront/src/config/header.ts` (fork-owned; contract `docs/contracts/header-footer.md`). Without a code edit a fork can:
  reorder or leave out the blocks of the one header row (menu button, logo, navigation, search box, controls), reorder or leave out the
  controls at the end (language, cart, account), set how many top-level categories show (0 to 12) and which links follow them
  (message key plus storefront path; a new text goes into `apps/storefront/src/messages-extra/uk.json` and `apps/storefront/src/messages-extra/en.json` under `custom.`).
- Footer: `apps/storefront/src/config/footer.ts` (fork-owned, same contract): reorder or leave out the blocks (navigation, contacts,
  theme switch, copyright) and the link groups of the navigation (shop pages, legal pages, the fork's own lists). Which shop pages are
  linked stays `inFooter` in `apps/storefront/src/config/shop-pages.ts`; the contacts are `apps/storefront/src/config/contacts.ts`; whether
  the theme switch exists is `showToggle` in `apps/storefront/src/config/theme.ts` (the footer must list `themeSwitch` while it is true).
- Check: `pnpm --filter @fluxkit/storefront test` (`config/header` and `config/footer` are checked by `apps/storefront/src/layout/header-layout.spec.ts`
  and `apps/storefront/src/layout/footer-layout.spec.ts`; an unknown block name fails `pnpm typecheck`). After changing either file (or `config/brand.ts`),
  delete `apps/storefront/src/components/header-footer-defaults.spec.tsx` and its folder `apps/storefront/src/components/header-footer-defaults/`:
  a TEMPLATE-DEFAULT check of upstream's default markup. Every other spec already runs once with filled configs (`apps/storefront/vitest.brand-fork.config.ts`).
- **Needs a code edit** (core files `apps/storefront/src/components/site-header.tsx`, `apps/storefront/src/components/site-footer.tsx`, `apps/storefront/src/app/globals.css`):
  a centred header, a second header row or an announcement bar (plan target 3 is NOT reached by design), footer columns side by side,
  headings in the footer, social or payment icons, the "powered by" line (always last). The `header.top` and `footer.columns` slots are planned (plan WP5), **not yet available**.
- Header and footer link sources besides the configs: the legal pages in `apps/storefront/src/config/legal.ts`; account and cart targets in
  `apps/storefront/src/layout/navigation.ts` (upstream-owned); trust bar: `apps/storefront/src/config/trust-bar.ts`; category page header:
  `apps/storefront/src/config/category-page.ts`.
- Product card variants and the list/grid toggle (L2, L5): `docs/contracts/card-registry.md`.
- **Not yet available** (plan WP4 and WP5): full-width and custom home sections (L4), slots for cards, header and footer (S1).

## 4. Known limits

- Storefront colours live in the upstream `tokens.css` (step 4): no storefront overrides file yet.
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
`docs/contracts/header-footer.md` (header and footer composition), `docs/contracts/theme-tokens.md` (tokens and fonts), `docs/contracts/config.md` (environment and features) and `docs/contracts/email-templates.md`.
Anything not listed there is internal.
