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
| `logo` | `{ kind: "text" }` or `{ kind: "image"; light: BrandPicture; dark: BrandPicture }` or `{ kind: "image"; light: BrandPicture; darkSafe: true }` | `{ kind: "text" }` | the header's home link: `text` = `site.name` in the display face with a `title`; `image` = the picture(s) with `alt` = `site.name`, no `title`, `loading="eager"`, `fetchpriority="low"` (no preload), height `h-8`. A light/dark pair is switched by CSS on `<html data-theme>` (`.fk-logo-light`, `.fk-logo-dark` in `app/globals.css`, including `system`). One picture must be declared `darkSafe: true` |
| `icons` | `readonly BrandIcon[]` | `[]` | one `<link rel="icon" href type sizes>` each (root layout `metadata.icons`); none = no tag |
| `appleIcon` | `BrandIcon \| null` | `null` | `<link rel="apple-touch-icon">` |
| `themeColor` | `{ light: "#rrggbb"; dark: "#rrggbb" } \| null` | `null` | `<meta name="theme-color">` from the root layout's `generateViewport`: one tag for the `light` or `dark` theme of the `fluxkit_theme` cookie, two with `media` for `system`. Must equal `--fk-color-background` of each theme (`config/brand.spec.ts`) |
| `ogImage` | `BrandPicture \| null` | `null` | the default `og:image` (absolute from `STOREFRONT_PUBLIC_URL`, `alt` = `site.name`) of the home page, the catalog and category lists, the shop pages and a product without its own picture. Pages without `openGraph` (cart, account, legal, search) get none |

`BrandPicture` = `{ src: "/<path under public/>"; width: number; height: number }` (intrinsic size in whole pixels). `BrandIcon` = `{ src: "/<path under
public/>"; type: string; sizes: string }`. Paths must be site-relative files under `apps/storefront/public/` (remote hosts are refused by `LocalPicture`
and by `brandConfigProblems`; `config/brand.spec.ts` checks that every named file exists).

## Not in this file

- The shop name: messages `site.name` and `site.title` (override in `apps/storefront/src/messages-overrides/<locale>.json`).
- Colours, radii, fonts: `packages/theme/src/tokens.css` (`theme-tokens.md`), `apps/storefront/src/config/fonts.ts`.
- The sender of mails: `EMAIL_FROM` (`config.md`); mails have no logo (known limit).
- The admin: name from its messages, favicon `apps/admin/public/favicon.*`, colours `packages/theme/src/admin-overrides.css` (ADR 0047).

## Defaults

The template's values render exactly what the storefront rendered before the file existed: the text logo, no icon link, no `theme-color`, no `og:image`
(head growth 0 bytes).
