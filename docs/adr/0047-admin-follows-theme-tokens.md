# 0047. The admin follows the shop's theme tokens, with a fork-owned admin overrides file

Status: accepted (owner decision 2026-11-08, plan `docs/plans/2026-11-08-design-changeability.md` section 9 item 3, work package WP2 B2,
PR-E1). Builds on ADR 0002 (one UI library and one token set for the storefront and the admin); changes none of it.

## Context

- The admin SPA imports the same `packages/theme/src/tokens.css` and `tailwind.css` as the storefront (`apps/admin/src/styles.css`) and
  renders `<html data-theme="light">` (fixed; `apps/admin/src/theme-isolation.spec.ts`). A rebrand of `tokens.css` therefore rebrands the
  admin too (plan, evidence E7). This was never written down as a decision.
- Some clients want the admin in the shop's colours, others a neutral admin while the shop gets a strong brand. Editing `tokens.css` or
  `apps/admin/src/styles.css` for that is a core edit (AGENTS.md section 17) that conflicts with every upstream change of those files.
- The admin's name was in five places (plan, evidence E5): `app.name` and `app.documentTitle` in `apps/admin/src/messages/{uk,en}/common.json`
  and a literal `<title>` in `apps/admin/index.html`. The SPA already reads the name only through `t("app.name")` (header) and
  `t("app.documentTitle")` (`src/i18n/use-document-title.ts`). The admin has no favicon.

## Decision

1. **The admin follows the shop's tokens by default.** No separate admin token set, no admin `brand.ts` (plan B2).
2. **Fork-owned `packages/theme/src/admin-overrides.css`.** Empty upstream (a comment only) and never edited upstream after its creation.
   Exported as `@fluxkit/theme/admin-overrides.css` and imported by `apps/admin/src/styles.css` LAST, after `tokens.css` and
   `tailwind.css`, so a rule of equal specificity (`:root, [data-theme="light"]`) wins for the admin alone. It holds token overrides (the
   names of `docs/contracts/theme-tokens.md`, 6-digit hex colours) and, for a client font, `@font-face` with a self-hosted woff2 file. It
   must not hold a dark, `system` or `prefers-color-scheme` rule (the admin is light only).
3. **The storefront never receives it.** `apps/admin/src/theme-isolation.spec.ts` checks the import order of the admin stylesheet, the
   package export, that the file adds no dark or OS-following rule, and that no file of `apps/storefront`, `packages/ui` or the other
   files of `packages/theme/src` mentions it. The design guard does not scan `packages/theme/src`, so the file may hold hex values.
4. **The admin's document title and favicon come from one build-time place.** `apps/admin/brand-html.ts`, a Vite `transformIndexHtml`
   plugin (built-in hook, no dependency, no environment variable), writes `index.html`'s one `<title>` from the English `app.name` (the
   static title shown before the SPA picks the UI language, unchanged: `Fluxkit Admin`) and, when a fork drops `favicon.svg`, `favicon.png`
   or `favicon.ico` into `apps/admin/public/`, an icon link to `/admin-ui/<file>` (Vite copies the file to the build root; the edge proxy
   serves it through `try_files`; `img-src 'self'` allows it). Upstream ships no favicon, so the built page is unchanged. The name stays in
   the messages (no second name source); `index.html` has an empty `<title>` the plugin fills, and it fails the build without exactly one.
5. **Admin headings are not covered by the heading-role guard.** The admin has 71 headings (the plan's count), none on `textStyles` roles; the guard of
   `packages/theme/src/design-guard.spec.ts` scans `packages/ui` and `apps/storefront` only. A display font set through the overrides
   reaches the admin's headings only where they use `font-display` (none today). Known limit, recorded in `docs/contracts/theme-tokens.md`.

## What a fork edits

| Goal | File |
|---|---|
| Admin in the shop's brand | nothing (default) |
| Admin with other colours, radii or font | `packages/theme/src/admin-overrides.css` |
| Admin name (header, tab title, static title) | `app.name` and `app.documentTitle` in `apps/admin/src/messages/{uk,en}/common.json` |
| Admin favicon | a new `apps/admin/public/favicon.svg` (or `.png`, `.ico`) |

## Consequences

- A fork themes the admin without a core edit and without merge conflicts (the overrides file and the favicon are fork-owned).
- The admin's colour pairs are only as safe as the overrides: `packages/theme/src/contrast.spec.ts` checks `tokens.css` alone. Reading the
  overrides there (effective admin values = light block plus overrides) is planned (plan B2) but not part of this change; until then a fork
  that sets admin colours checks the pairs of `docs/contracts/theme-tokens.md` itself.
- Changing the name in the messages changes the static title at the next build; `apps/admin/build-output.spec.ts` pins the built title to
  `app.name` and the favicon link to the file in `public/`.
- An image logo for the admin is not part of this decision (the header shows `app.name` as text).
