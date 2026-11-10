# Header and footer composition (storefront)

Status: draft (since PR-G1 of `docs/plans/2026-11-08-design-changeability.md`, L3; owner approval 2026-11-08, plan section 9).
Additive: a new block, control, link group kind or field is minor; a rename or removal is major with a note in `docs/migrations/`.
Default VALUES are not contract (plan principle 8). `check:docs` requires a change here whenever `config/header.ts` or
`config/footer.ts` changes upstream.

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
| `blocks` | ordered list of `"menu"`, `"logo"`, `"navigation"`, `"search"`, `"controls"` | Rendered in this order in the one header row; an unlisted block is not rendered; each at most once. `menu` (the disclosure below `xl`) and `navigation` (the inline list from `xl`) go together. `search` shows only while the shop has search on (`GET /store/config`); the config can leave it out, never force it in. |
| `controls` | ordered list of `"language"`, `"cart"`, `"account"` | The group at the end of the row (`controls` block); each at most once; an empty list renders no group. |
| `navigation.categoryLimit` | whole number 0 to 12 (`HEADER_CATEGORY_LIMIT_MAX`) | Most top-level categories, in the API's order, before the links. |
| `navigation.links` | `NavigationLink[]` | After the categories, in both the menu and the inline list; paths unique. |

Blocks left out at render: `menu` and `navigation` when there is no link at all (no empty landmark), `controls` when empty.

## Footer

| Field | Values | Rule |
|---|---|---|
| `blocks` | ordered list of `"navigation"`, `"contacts"`, `"themeSwitch"`, `"copyright"` | Top to bottom in the one footer column; an unlisted block is not rendered; each at most once. `themeSwitch` renders only while `showToggle` of `config/theme.ts` is true, and must be listed while it is (the stored choice could not be changed back otherwise). `contacts` renders the phones and email of `config/contacts.ts`, nothing when none is set. |
| `navigation.groups` | ordered list of `{ kind: "shopPages" }` (the shop pages with `inFooter`), `{ kind: "legal" }` (the legal pages), `{ kind: "links"; links: NavigationLink[] }` | One `<ul>` per non-empty group inside ONE labelled `nav` (`footer.nav.label`); `shopPages` and `legal` at most once each; an own group must have links. No group with a link: no `nav`. |

The "powered by" line is not a block: it always closes the footer.

## Checks (what a fork runs)

`pnpm --filter @fluxkit/storefront test`: `layout/header-layout.spec.ts` and `layout/footer-layout.spec.ts` run `headerConfigProblems` /
`footerConfigProblems` on the real files (repeated blocks, menu without navigation, a limit out of range, an unknown message key, a
path that is not plain, a repeated link, an empty own group, a hidden switch while `showToggle` is true); an unknown block name fails
`tsc`. The unit suite runs a second time with a filled fork config (`apps/storefront/vitest.brand-fork.config.ts`,
`src/lib/layout-fork-fixture.ts`). `components/header-footer-defaults.spec.tsx` is a TEMPLATE-DEFAULT check of the default markup:
a fork that changes either file deletes it.

## Not contract, not configurable

The header and footer CSS (`.fk-site-header`, `.fk-header-*`, `.fk-site-footer` in `app/globals.css`), the markup inside a block,
a centred header, a second header row, an announcement bar, footer columns side by side, headings in the footer, social or payment
icons: those are code edits of `components/site-header.tsx`, `components/site-footer.tsx` and `app/globals.css` (plan section 1:
request 3 is not targeted; slots `header.top` and `footer.columns` are planned in WP5, not yet available).
