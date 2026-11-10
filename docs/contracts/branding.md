# Contract: storefront brand config

Status: draft (added 2026-11-09, plan `docs/plans/2026-11-08-design-changeability.md` B1; owner approval of the contract addition 2026-11-08). Covered by
SemVer: a new field or logo variant is minor, renaming or removing a field, a variant or the file is major with a note in `docs/migrations/`. Default
values are NOT contract. How to use it: `docs/customization.md`.

## File

`apps/storefront/src/config/brand.ts` is **fork-owned**: upstream created it once and never edits it again, so a fork fills it without merge conflicts. It
exports `brand: BrandConfig`, data only. The types and every reader live in `apps/storefront/src/lib/brand.ts` (internal: how a field is rendered may
change in a minor release; the fields below may not). `check:docs` fails a PR that changes `config/brand.ts` without a change under `docs/contracts/`.

## Shape (`BrandConfig`, `apps/storefront/src/lib/brand.ts`)

| Field | Type | Default | Rendered as |
|---|---|---|---|
| `logo` | `{ kind: "text" }` or `{ kind: "image"; light: BrandPicture; dark: BrandPicture }` or `{ kind: "image"; light: BrandPicture; darkSafe: true }` | `{ kind: "text" }` | the header's home link: `text` = `site.name` in the display face with a `title`; `image` = the picture(s) as plain `<img>` (no `next/image` client code in the shell of every page) with `alt` = `site.name`, no `title`, `loading="eager"`, `fetchpriority="low"` (React adds no preload), height `h-8`, width from the ratio. A light/dark pair is switched by CSS on `<html data-theme>` (`.fk-logo-light`, `.fk-logo-dark` in `app/globals.css`, including `system`). One picture must be declared `darkSafe: true` |
| `icons` | `readonly BrandIcon[]` | `[]` | one `<link rel="icon" href type sizes>` each (root layout `metadata.icons`); none = no tag |
| `appleIcon` | `{ src: "/<path under public/>" } \| null` | `null` | `<link rel="apple-touch-icon" href>` (180 x 180 PNG; no type or dimensions, to save head bytes) |
| `themeColor` | `boolean` | `false` | `true`: `<meta name="theme-color">` from the root layout's `generateViewport` with the page background of the rendered theme: one tag for the `light` or `dark` theme of the `fluxkit_theme` cookie, two with `media` for `system`. The colours are `themeColors` of `@fluxkit/theme` (`packages/theme/src/theme-color.ts`; apps hold no hex colour, design guard), kept equal to `--fk-color-background` by `theme-color.spec.ts` |
| `ogImage` | `BrandPicture \| null` | `null` | the default `og:image` (absolute from `STOREFRONT_PUBLIC_URL`, `alt` = `site.name`) of the home page, the catalog and category lists, the shop pages and a product without its own picture. Pages without `openGraph` (cart, account, legal, search) get none |

`BrandPicture` = `{ src: "/<path under public/>"; width: number; height: number }` (intrinsic size in whole pixels). `BrandIcon` = `{ src: "/<path under
public/>"; type: string; sizes: string }`. Paths must be site-relative files under `apps/storefront/public/`: one rule, `isPublicFilePath` of `lib/brand.ts` (one leading `/`, no `//`
and no `..` anywhere), applied by `brandConfigProblems` and again at render by `components/brand-logo.tsx`, so no remote host comes in
(`config/brand.spec.ts` checks that every named file exists).

Logo notes: both pictures of a light/dark pair are downloaded on every page (the hidden one is `display: none`, which does not stop the
fetch); keep them small (SVG). A fork-supplied React SVG component (with `currentColor` fills) is NOT offered: the logo is a file under
`public/`. In forced-colours mode an `<img>` keeps its own colours while the page behind it becomes the system canvas (often black or
white): a transparent logo whose marks vanish on that canvas disappears, so choose a logo that reads on both black and white, or use the
light/dark pair.

## Not in this file

- The shop name: messages `site.name` and `site.title` (override in `apps/storefront/src/messages-overrides/<locale>.json`).
- Colours, radii, fonts: `packages/theme/src/tokens.css` (`theme-tokens.md`), `apps/storefront/src/config/fonts.ts`.
- The sender of mails: `EMAIL_FROM` (`config.md`); mails have no logo (known limit).
- The admin: name from its messages, favicon `apps/admin/public/favicon.*`, colours `packages/theme/src/admin-overrides.css` (ADR 0047).

## Defaults

The template's values render exactly what the storefront rendered before the file existed: the text logo, no icon link, no `theme-color`, no `og:image`
(head growth 0 bytes).

## Head budget

Every tag here is in the first HTML of every page. Plan B1 caps the growth of the `<head>` at 300 bytes.

- Defaults: 0 bytes. On `next start` (CI e2e `first-html`, which prints `FIRST-HTML {... "head": ...}` per route) the total, head and header
  bytes of all 24 measured routes equal those of `main` (2026-11-09; e.g. `/uk/account/register` head 1,345, `/en/account/register` 1,262).
- The example of the file's comment, measured on `next dev` only (2026-11-09, `/uk|en/account/register`; not yet on `next start`): the brand
  tags are `<link rel="icon" ...>` 74 bytes, `<link rel="apple-touch-icon" ...>` 59 bytes and the `theme-color` meta: 44 bytes for a `light` or
  `dark` cookie (74 + 59 + 44 = 177), 82 + 81 with `media` for `system` (74 + 59 + 163 = 296, the worst case, 4 bytes under the cap).
- Every extra character of a path counts once per tag: longer paths than `/brand/icon.svg` and `/brand/apple-icon.png`, or a second icon size,
  exceed the cap in `system` mode. One SVG icon covers every size. `og:image` tags are only on the pages listed above (not on the
  registration and sign-in pages).
