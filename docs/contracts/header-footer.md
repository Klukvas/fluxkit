# Header and footer composition (storefront)

Status: draft (since PR-G1 of `docs/plans/2026-11-08-design-changeability.md`, L3; owner approval 2026-11-08, plan section 9).
Additive: a new block, control, link group kind or field is minor; a rename or removal is major with a note in `docs/migrations/`.
Default VALUES are not contract (plan principle 8). `check:docs` requires a change here whenever `config/header.ts` or
`config/footer.ts` changes upstream (not in a fork with the `.fluxkit-fork` marker, `docs/contracts/README.md`). The plan calls this contract `layout-config.md`; it is this file, `header-footer.md`.

## Files

| Name | Shape | Notes |
|---|---|---|
| `apps/storefront/src/config/header.ts` | `export const headerConfig: HeaderConfig` | FORK-OWNED: upstream edits it only together with this contract (a row here and a `CHANGELOG.md` line), so a fork that changed it resolves one conflict and keeps its values. The default markup is frozen byte for byte (`components/header-footer-defaults.upstream.spec.tsx`). Defaults changed once, in round 4 (2026-11-13, `docs/plans/2026-11-13-storefront-ui-round-4.md`): the `theme` control and the `picker` display; before it `controls: ["language", "cart", "account"]` without `display`. |
| `apps/storefront/src/config/footer.ts` | `export const footerConfig: FooterConfig` | FORK-OWNED, same rule. Round 4 defaults: `layout: "columns"` and no `themeSwitch` block; before it `blocks: ["navigation", "contacts", "themeSwitch", "copyright"]` without `layout`. |
| `HeaderConfig` and its parts (`apps/storefront/src/layout/header-layout.ts`) | `{ blocks: HeaderBlockName[]; controls: HeaderControlName[]; navigation: { display?: "row" \| "picker"; categoryLimit: number; links: NavigationLink[] } }` | Types only are contract; `headerView` and `headerConfigProblems` are internal. |
| `FooterConfig` and its parts (`apps/storefront/src/layout/footer-layout.ts`) | `{ layout?: "stack" \| "columns"; blocks: FooterBlock[]; navigation: { groups: FooterLinkGroup[] } }` with `FooterBlock = FooterBlockName \| { kind: "text"; textKey: string }` | Same. |
| `NavigationLink` (`apps/storefront/src/layout/navigation.ts`) | `{ labelKey: string; href: string }` | A message key (both locales) and a plain storefront path without the locale (`/catalog`, no scheme, no `//`, no `..`). |

## Header

| Field | Values | Rule |
|---|---|---|
| `blocks` | ordered list of `"menu"`, `"logo"`, `"navigation"`, `"search"`, `"controls"` | Rendered in this order in the one header row; an unlisted block is not rendered; each at most once; not empty. `logo` is required. `menu` (the disclosure below `xl`) and `navigation` (the inline list from `xl`) go together. `controls`, when listed, is the LAST block. The place of `menu` is restricted (below). `search` shows only while the shop has search on (`GET /store/config`); the config can leave it out, never force it in. |
| `controls` | ordered list of `"language"`, `"theme"` (round 4), `"cart"`, `"account"` | The group at the end of the row (`controls` block, pushed to the end by `ms-auto`; its dropdowns open towards the start); each at most once; not empty while the block is listed. `theme`: a disclosure named "Theme" / "Тема" whose sun or moon icon shows the theme `<html data-theme>` resolves to (CSS only, the system mode follows the device); its panel holds the three `aria-pressed` buttons, a `POST /theme` form without a script. Rendered only while `showToggle` of `config/theme.ts` is true. Below `sm` it is hidden and the menu's panel carries the same switch, when the header renders a menu (otherwise it stays in the row). |
| `navigation.display` | `"row"` or `"picker"` (round 4); optional, left out = `"row"` | `row`: the `navigation` block is the inline list from `xl` (scrolls sideways), the `menu` block the disclosure below `xl`, the links in the markup twice. `picker`: the `menu` block is ONE disclosure for every width: the menu icon below `xl` (named "Menu"), a "Categories" / "Категорії" text with a chevron from `xl` (named by that text); its panel lists the top-level categories with their children (at most 8 each, `HEADER_CATEGORY_CHILDREN_MAX`, one level, from the same `GET /store/categories` tree) in three columns from `xl`, then the links; plain links in lists, no menu roles; Escape and an outside click close it, Escape puts the focus back on the summary. Below `xl` the panel shows the top-level categories and the links only, as the `row` menu does. The `navigation` block renders nothing (it stays listed next to `menu`), so the list is in the markup once. |
| `navigation.categoryLimit` | whole number 0 to 12 (`HEADER_CATEGORY_LIMIT_MAX`) | Most top-level categories, in the API's order, before the links. |
| `navigation.links` | `NavigationLink[]` | After the categories, in both the menu and the inline list (or the picker's panel); paths unique. |

Blocks left out at render: `menu` and `navigation` when there is no link at all (no empty landmark); `navigation` in `picker` mode; the `theme` control while `showToggle` is false, and `controls` when that leaves it empty.

Supported orders. Below `lg` the logo grows (`max-lg:grow`), so every block after it packs at the END of the row; `navigation` shows
only from `xl`; the search block shows an icon. So a block's place on a phone depends on what is shown before and after it, not on its
index. Accepted (anything else is refused by the check, also at render):
- `controls`, when listed, is the last block (it carries `ms-auto`; its language and account dropdowns open towards the start).
- Without `menu`: any order of `logo` and `search` (then `controls`).
- `menu` FIRST on a phone: before `logo`, with only `navigation` before it; its dropdown opens towards the end (`start-0`). Examples:
  `menu, logo, navigation, search, controls` (the default), `menu, search, logo, navigation, controls`, `navigation, menu, logo, controls`.
- `menu` LAST on a phone: after `logo`, with only `navigation` after it, and no `controls` block; its dropdown opens towards the start
  (`end-0`). Examples: `logo, menu, navigation`, `logo, search, menu, navigation`, `search, logo, navigation, menu` ("logo left, menu right").

Measured in Chromium (PR 249) at 320, 360 and 390 px, left-to-right and right-to-left, for every accepted order (39) with four control
sets, the search box on and off and the demo seed's category names: 1 128 dropdown measurements, none past a screen edge. Refused
places were measured past an edge (menu after the logo with controls after it: 12 px past the start edge at 320 and 360 px; menu after
the logo with nothing after it but in the first half: 132 px past the end edge) or as close to it (menu after the search icon: a long
category name crossed the end edge at 360 px). Known limit, not caused by this config (same on the default order before it existed): a
category name of about 30 characters makes the menu's dropdown (`w-max`) wider than a 320 px screen. The measurement is a scratch probe
(compiled Tailwind CSS plus Playwright), not part of CI; the unit tests pin the accepted shapes and the rendered `start-0`/`end-0`.

## Footer

| Field | Values | Rule |
|---|---|---|
| `layout` | `"stack"` or `"columns"` (round 4); optional, left out = `"stack"` | `stack`: the blocks top to bottom in one column (the footer before round 4). `columns`: a grid, two columns on a phone and four from `lg`, of one `nav` per non-empty link group, `aria-labelledby` its visible `h2` (the group's `headingKey`, else `footer.group.shop` "Покупцям" / "Customer service" and `footer.group.legal` "Правова інформація" / "Legal" for the built-in groups), and the contacts as a column with the heading `footer.group.contacts` (left out without a phone or an email), in the order of their blocks; the other blocks (text lines, `themeSwitch`, `copyright`) and the "powered by" line in a bottom row, in their order. |
| `blocks` | ordered list of `"navigation"`, `"contacts"`, `"themeSwitch"`, `"copyright"` and text lines `{ kind: "text"; textKey: string }` | Top to bottom in the one footer column (`stack`); an unlisted block is not rendered; not empty; each named block at most once, each text key at most once. A text line is one `<p>` with the message (for example the accepted payment methods; a fork's key under `custom.` in `messages-extra`), no link, no picture. `themeSwitch` renders only while `showToggle` of `config/theme.ts` is true; while it is, the footer lists `themeSwitch` OR the header lists the `theme` control (both is allowed; the stored choice could not be changed back otherwise; a shared check, `headerHasThemeControl`). `contacts` renders the phones and email of `config/contacts.ts`, nothing when none is set. |
| `navigation.groups` | ordered list of `{ kind: "shopPages" }` (the shop pages with `inFooter`), `{ kind: "legal" }` (the legal pages), `{ kind: "links"; links: NavigationLink[] }`, each with an optional `headingKey: string` | `stack`: one `<ul>` per non-empty group inside ONE labelled `nav` (`footer.nav.label`), preceded by an `h2` (role `navGroupTitle`) when `headingKey` is set. `columns`: a `nav` per group (above); an own `links` group needs a `headingKey`. `shopPages` and `legal` at most once each; an own group must have links, each path once within that group (repeated links are checked per group only, not across groups). No group with a link: no `nav` (and no heading). |

The "powered by" line is not a block: it always closes the footer.

## Feature links (since blog plan PR 4a, `docs/plans/2026-11-13-blog.md` E7; additive)

An optional feature's storefront slice declares header and footer links in its manifest (`docs/contracts/README.md`, "Feature extension
points"). While the feature is in `GET /store/config` `features`, they are added to what the config renders, without any edit of
`config/header.ts` or `config/footer.ts`; without an enabled feature (or while the config cannot be read) the markup is byte for byte
the config's (`header-footer-defaults.upstream.spec.tsx` stays green).

| Place | Rule |
|---|---|
| Header | After `navigation.links`, wherever those show (the `menu` and `navigation` blocks, or the `picker`'s panel), in registry order (slice name). A header without any link gets its `menu`/`navigation` blocks from a feature link (when it lists them). |
| Footer | Appended to the `shopPages` group; when the config lists no such group, a group of their own after the configured ones, headed `footer.group.more` ("Більше" / "More") in the `columns` layout and without a heading in `stack`. The `footer.columns` slot's `shopLinks` stay the shop pages only. |
| Both | A feature link whose path the config (or that group) already links is left out: a fork's own entry keeps its place. No switch in v1: a fork that wants no link leaves the feature off; its label is a message a fork may override. |

## Checks (what a fork runs)

`pnpm --filter @fluxkit/storefront test`: `layout/header-layout.spec.ts` and `layout/footer-layout.spec.ts` run `headerConfigProblems` /
`footerConfigProblems` on the real files with the message keys of both locales (empty block list, missing logo, repeated blocks, menu
without navigation, a menu outside the accepted places, `controls` not last or empty, a limit out of range, an unknown message, heading or text key, a path that is not
plain, a repeated link, an empty own group, an own group without a heading in the `columns` layout, no theme switch in the footer nor the
header while `showToggle` is true); an unknown block name fails `tsc`. The same
checks without the message keys run at render (`headerView`, `footerView` throw), so a fork that skipped the tests fails on the first
page; an unknown message key throws in the translator. What that failure looks like: `SiteShell` renders inside
`app/[locale]/layout.tsx` (its `error.tsx` sits inside that layout and cannot catch it) and the app has no `global-error.tsx`, so EVERY page answers with Next's bare 500 page (the error and its
message in the server log). `next build` does not catch it (the pages render per request); the unit tests do. The unit suite runs a second time with a filled fork config (`apps/storefront/vitest.brand-fork.config.ts`,
`src/lib/header-fork-fixture.ts`, `src/lib/footer-fork-fixture.ts`). `components/header-footer-defaults.upstream.spec.tsx` is a TEMPLATE-DEFAULT check of the default markup:
a fork that changes either file deletes it.

## Not contract, not configurable (cut from plan L3, with the reason)

- The header and footer CSS (`.fk-site-header`, `.fk-header-*`, `.fk-site-footer` in `app/globals.css`) and the markup inside a block.
- A centred header, a second header row: plan target 3 is not targeted (code edit of `components/site-header.tsx`). An announcement
  bar above the header row is the `header.top` slot (`docs/contracts/slots.md`, since PR-H).
- Footer columns other than the `columns` layout (since round 4: one column per link group and the contacts): fork-made columns are the
  `footer.columns` slot (`docs/contracts/slots.md`, since PR-H): a four-column footer of the fork's own components (plan target 5) is four
  column components plus `navigation` and `contacts` left out of `blocks`.
- The theme control's place inside the controls group below `sm` (it moves into the menu's panel) and the picker's column count.
- Social links: external URLs are refused by design here (link targets are plain storefront paths); a fork renders them in a
  `footer.columns` column (its own component) or in code.
- Payment icons: only as text here (a text line); pictures need a code edit (local images only, CSP `img-src 'self'`).
- The "powered by" line: always last, not a block (the template's attribution; an owner decision to change).
