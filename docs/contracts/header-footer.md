# Header and footer composition (storefront)

Status: draft (since PR-G1 of `docs/plans/2026-11-08-design-changeability.md`, L3; owner approval 2026-11-08, plan section 9).
Additive: a new block, control, link group kind or field is minor; a rename or removal is major with a note in `docs/migrations/`.
Default VALUES are not contract (plan principle 8). `check:docs` requires a change here whenever `config/header.ts` or
`config/footer.ts` changes upstream. The plan calls this contract `layout-config.md`; it is this file, `header-footer.md`.

## Files

| Name | Shape | Notes |
|---|---|---|
| `apps/storefront/src/config/header.ts` | `export const headerConfig: HeaderConfig` | FORK-OWNED: upstream creates it once and never edits it again. Defaults render the header as it was before the file existed (byte for byte, `components/header-footer-defaults.spec.tsx`). |
| `apps/storefront/src/config/footer.ts` | `export const footerConfig: FooterConfig` | FORK-OWNED, same rule. |
| `HeaderConfig` and its parts (`apps/storefront/src/layout/header-layout.ts`) | `{ blocks: HeaderBlockName[]; controls: HeaderControlName[]; navigation: { categoryLimit: number; links: NavigationLink[] } }` | Types only are contract; `headerView` and `headerConfigProblems` are internal. |
| `FooterConfig` and its parts (`apps/storefront/src/layout/footer-layout.ts`) | `{ blocks: FooterBlockName[]; navigation: { groups: FooterLinkGroup[] } }` | Same. |
| `NavigationLink` (`apps/storefront/src/layout/navigation.ts`) | `{ labelKey: string; href: string }` | A message key (both locales) and a plain storefront path without the locale (`/catalog`, no scheme, no `//`, no `..`). |

## Header

| Field | Values | Rule |
|---|---|---|
| `blocks` | ordered list of `"menu"`, `"logo"`, `"navigation"`, `"search"`, `"controls"` | Rendered in this order in the one header row; an unlisted block is not rendered; each at most once; not empty. `logo` is required. `menu` (the disclosure below `xl`) and `navigation` (the inline list from `xl`) go together. `controls`, when listed, is the LAST block. `search` shows only while the shop has search on (`GET /store/config`); the config can leave it out, never force it in. |
| `controls` | ordered list of `"language"`, `"cart"`, `"account"` | The group at the end of the row (`controls` block, pushed to the end by `ms-auto`; its dropdowns open towards the start); each at most once; not empty while the block is listed. |
| `navigation.categoryLimit` | whole number 0 to 12 (`HEADER_CATEGORY_LIMIT_MAX`) | Most top-level categories, in the API's order, before the links. |
| `navigation.links` | `NavigationLink[]` | After the categories, in both the menu and the inline list; paths unique. |

Blocks left out at render: `menu` and `navigation` when there is no link at all (no empty landmark).

Supported orders (why `controls` must be last): the row is a flex line whose `controls` group carries `ms-auto` and whose language and
account dropdowns are end-aligned; first or in the middle it would push the rest of the row and its panels would open past the start
edge. The menu's dropdown follows its position: from a button in the first half of the configured row it opens towards the end
(`start-0`, the default with the menu first), from the second half towards the start (`end-0`), so a "logo left, menu right" header
keeps its panel on screen. Checked by unit tests on the rendered classes; NOT checked in a real browser (no e2e with a non-default
order: the e2e stack runs the template's own config files).

## Footer

| Field | Values | Rule |
|---|---|---|
| `blocks` | ordered list of `"navigation"`, `"contacts"`, `"themeSwitch"`, `"copyright"` and text lines `{ kind: "text"; textKey: string }` | Top to bottom in the one footer column; an unlisted block is not rendered; not empty; each named block at most once, each text key at most once. A text line is one `<p>` with the message (for example the accepted payment methods; a fork's key under `custom.` in `messages-extra`), no link, no picture. `themeSwitch` renders only while `showToggle` of `config/theme.ts` is true, and must be listed while it is (the stored choice could not be changed back otherwise). `contacts` renders the phones and email of `config/contacts.ts`, nothing when none is set. |
| `navigation.groups` | ordered list of `{ kind: "shopPages" }` (the shop pages with `inFooter`), `{ kind: "legal" }` (the legal pages), `{ kind: "links"; links: NavigationLink[] }`, each with an optional `headingKey: string` | One `<ul>` per non-empty group inside ONE labelled `nav` (`footer.nav.label`), preceded by an `h2` (role `navGroupTitle`) when `headingKey` is set; `shopPages` and `legal` at most once each; an own group must have links, each path once. No group with a link: no `nav` (and no heading). |

The "powered by" line is not a block: it always closes the footer.

## Checks (what a fork runs)

`pnpm --filter @fluxkit/storefront test`: `layout/header-layout.spec.ts` and `layout/footer-layout.spec.ts` run `headerConfigProblems` /
`footerConfigProblems` on the real files with the message keys of both locales (empty block list, missing logo, repeated blocks, menu
without navigation, `controls` not last or empty, a limit out of range, an unknown message, heading or text key, a path that is not
plain, a repeated link, an empty own group, a hidden switch while `showToggle` is true); an unknown block name fails `tsc`. The same
checks without the message keys run at render (`headerView`, `footerView` throw), so a fork that skipped the tests fails on the first
page; an unknown message key throws in the translator. The unit suite runs a second time with a filled fork config (`apps/storefront/vitest.brand-fork.config.ts`,
`src/lib/layout-fork-fixture.ts`). `components/header-footer-defaults.spec.tsx` is a TEMPLATE-DEFAULT check of the default markup:
a fork that changes either file deletes it.

## Not contract, not configurable (cut from plan L3, with the reason)

- The header and footer CSS (`.fk-site-header`, `.fk-header-*`, `.fk-site-footer` in `app/globals.css`) and the markup inside a block.
- A centred header, a second header row, an announcement bar: plan target 3 is not targeted (code edit of `components/site-header.tsx`;
  the `header.top` slot is planned in WP5, not yet available).
- Footer columns side by side: the footer is one column; the plan's four-column footer (target 5) needs a CSS layout change or the
  planned `footer.columns` slot (WP5, not yet available). What L3 gives towards it: ordered link groups with headings and text lines.
- Social links: external URLs are refused by design (link targets are plain storefront paths); a fork adds them in code or, later, a slot.
- Payment icons: only as text here (a text line); pictures need a code edit (local images only, CSP `img-src 'self'`).
- The "powered by" line: always last, not a block (the template's attribution; an owner decision to change).
