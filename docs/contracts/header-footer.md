# Header and footer composition (storefront)

Status: draft (since PR-G1 of `docs/plans/2026-11-08-design-changeability.md`, L3; owner approval 2026-11-08, plan section 9).
Additive: a new block, control, link group kind or field is minor; a rename or removal is major with a note in `docs/migrations/`.
Default VALUES are not contract (plan principle 8). `check:docs` requires a change here whenever `config/header.ts` or
`config/footer.ts` changes upstream (not in a fork with the `.fluxkit-fork` marker, `docs/contracts/README.md`). The plan calls this contract `layout-config.md`; it is this file, `header-footer.md`.

## Files

| Name | Shape | Notes |
|---|---|---|
| `apps/storefront/src/config/header.ts` | `export const headerConfig: HeaderConfig` | FORK-OWNED: upstream creates it once and never edits it again. Defaults render the header as it was before the file existed (byte for byte, `components/header-footer-defaults.upstream.spec.tsx`). |
| `apps/storefront/src/config/footer.ts` | `export const footerConfig: FooterConfig` | FORK-OWNED, same rule. |
| `HeaderConfig` and its parts (`apps/storefront/src/layout/header-layout.ts`) | `{ blocks: HeaderBlockName[]; controls: HeaderControlName[]; navigation: { categoryLimit: number; links: NavigationLink[] } }` | Types only are contract; `headerView` and `headerConfigProblems` are internal. |
| `FooterConfig` and its parts (`apps/storefront/src/layout/footer-layout.ts`) | `{ blocks: FooterBlock[]; navigation: { groups: FooterLinkGroup[] } }` with `FooterBlock = FooterBlockName \| { kind: "text"; textKey: string }` | Same. |
| `NavigationLink` (`apps/storefront/src/layout/navigation.ts`) | `{ labelKey: string; href: string }` | A message key (both locales) and a plain storefront path without the locale (`/catalog`, no scheme, no `//`, no `..`). |

## Header

| Field | Values | Rule |
|---|---|---|
| `blocks` | ordered list of `"menu"`, `"logo"`, `"navigation"`, `"search"`, `"controls"` | Rendered in this order in the one header row; an unlisted block is not rendered; each at most once; not empty. `logo` is required. `menu` (the disclosure below `xl`) and `navigation` (the inline list from `xl`) go together. `controls`, when listed, is the LAST block. The place of `menu` is restricted (below). `search` shows only while the shop has search on (`GET /store/config`); the config can leave it out, never force it in. |
| `controls` | ordered list of `"language"`, `"cart"`, `"account"` | The group at the end of the row (`controls` block, pushed to the end by `ms-auto`; its dropdowns open towards the start); each at most once; not empty while the block is listed. |
| `navigation.categoryLimit` | whole number 0 to 12 (`HEADER_CATEGORY_LIMIT_MAX`) | Most top-level categories, in the API's order, before the links. |
| `navigation.links` | `NavigationLink[]` | After the categories, in both the menu and the inline list; paths unique. |

Blocks left out at render: `menu` and `navigation` when there is no link at all (no empty landmark).

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
| `blocks` | ordered list of `"navigation"`, `"contacts"`, `"themeSwitch"`, `"copyright"` and text lines `{ kind: "text"; textKey: string }` | Top to bottom in the one footer column; an unlisted block is not rendered; not empty; each named block at most once, each text key at most once. A text line is one `<p>` with the message (for example the accepted payment methods; a fork's key under `custom.` in `messages-extra`), no link, no picture. `themeSwitch` renders only while `showToggle` of `config/theme.ts` is true, and must be listed while it is (the stored choice could not be changed back otherwise). `contacts` renders the phones and email of `config/contacts.ts`, nothing when none is set. |
| `navigation.groups` | ordered list of `{ kind: "shopPages" }` (the shop pages with `inFooter`), `{ kind: "legal" }` (the legal pages), `{ kind: "links"; links: NavigationLink[] }`, each with an optional `headingKey: string` | One `<ul>` per non-empty group inside ONE labelled `nav` (`footer.nav.label`), preceded by an `h2` (role `navGroupTitle`) when `headingKey` is set; `shopPages` and `legal` at most once each; an own group must have links, each path once within that group (repeated links are checked per group only, not across groups). No group with a link: no `nav` (and no heading). |

The "powered by" line is not a block: it always closes the footer.

## Checks (what a fork runs)

`pnpm --filter @fluxkit/storefront test`: `layout/header-layout.spec.ts` and `layout/footer-layout.spec.ts` run `headerConfigProblems` /
`footerConfigProblems` on the real files with the message keys of both locales (empty block list, missing logo, repeated blocks, menu
without navigation, a menu outside the accepted places, `controls` not last or empty, a limit out of range, an unknown message, heading or text key, a path that is not
plain, a repeated link, an empty own group, a hidden switch while `showToggle` is true); an unknown block name fails `tsc`. The same
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
- Footer columns side by side: the configured blocks stay one column. Columns are the `footer.columns` slot (`docs/contracts/slots.md`,
  since PR-H): a four-column footer (plan target 5) is four column components plus `navigation` and `contacts` left out of `blocks`.
- Social links: external URLs are refused by design here (link targets are plain storefront paths); a fork renders them in a
  `footer.columns` column (its own component) or in code.
- Payment icons: only as text here (a text line); pictures need a code edit (local images only, CSP `img-src 'self'`).
- The "powered by" line: always last, not a block (the template's attribution; an owner decision to change).
