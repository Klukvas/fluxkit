# Admin area sub-navigation: links at least 24 px, 44 px on touch screens

Written against: `a3f78cd4` (`main`). Source: the touch-target spot check of `docs/plans/2026-11-11-improve-ui-audit-2.md` ("ui-quality spot
checks"), selected by the owner on 2026-11-11 and treated as a finding.

## Evidence chain

- Surface: the sub-navigation above five admin areas: catalog dictionaries (Attributes / Options / Product types / Brands / Categories),
  shipping (Shipping / Carriers), e-mail (Status / Messages / Templates), catalog search (Status / Synonyms), personal data (Requests /
  Look up by email).
- Problem: measured at 375 px (touch, Chromium): each sub-navigation link is an inline element about 18 px tall, below both sizes the admin
  and the UI library use for links and controls.
- Cause, shared by all five: an identical `<nav><ul className="flex flex-wrap gap-x-5 gap-y-2">` with a react-router `<Link>` whose class is
  `"font-semibold text-foreground underline underline-offset-4"` (current) or `"text-muted-foreground underline underline-offset-4"` (others):
  no `display` and no minimum height, so the link is as tall as its text line. Duplicated verbatim in:
  - `apps/admin/src/areas/catalog-dictionaries/dictionary-frame.tsx:24-42`
  - `apps/admin/src/areas/shipping/shipping-frame.tsx:18-36`
  - `apps/admin/src/areas/email/email-frame.tsx:25-43`
  - `apps/admin/src/areas/search/search-frame.tsx:23-41`
  - `apps/admin/src/areas/privacy/privacy-frame.tsx:24-42`
- Design evidence:
  - `packages/ui/src/breadcrumbs.tsx:33-39`: a list of navigation links shown inline, `"inline-flex min-h-6 items-center underline pointer-coarse:min-h-11"`
    with the comment "At least 24 px high (WCAG 2.5.8), 44 px on a touch screen (review A-02)". The admin already loads this variant
    (`apps/admin/src/styles.css` scans `packages/ui/src`; Tailwind 4.3.3).
  - The admin's own navigation and controls are 44 px: `packages/ui/src/side-nav.tsx:65-66` (`flex min-h-11 items-center`, the admin's main
    menu), `packages/ui/src/styles.ts` `controlBase` (`min-h-11`).
- Owner: the five frame files above (each owns its sub-navigation markup); no shared owner exists yet.
- Scope and affected surfaces: the links of those five sub-navigations on every screen of the five areas, at every width.
- Uncertainty: the measured height of the e-mail status table links (about 18 px) has a DIFFERENT cause: they use the area's generic inline
  `linkClass` (`apps/admin/src/areas/email/status-view.tsx:208`, defined in `email-frame.tsx`), which ten admin files duplicate for every
  inline link, including links inside sentences (exempt from WCAG 2.5.8). They are excluded here (see Scope).

## Design decision

Give the five sub-navigations one shared link class with the Breadcrumbs sizing: `inline-flex min-h-6 items-center` (24 px with a mouse,
WCAG 2.5.8) and `pointer-coarse:min-h-11` (44 px on a touch screen), keeping today's look (current item bold, body colour, underline;
others muted, underline). With a mouse the row grows from about 18 px to 24 px; on a phone each link becomes a 44 px target. The class
lives in one place, so the five frames can no longer drift apart.

## Reuse

- Sizing: `inline-flex min-h-6 items-center pointer-coarse:min-h-11`, exemplar `packages/ui/src/breadcrumbs.tsx:36`.
- Look: the current strings of the five frames, unchanged.
- No new token, no `@fluxkit/ui` change, no contract change.

A shared constant, not a component: the five frames differ in their screen lists, message keys (`labelKey` or `titleKey`), `aria-label`
keys and current-id variable, and they already share the markup shape; a component would add props for each difference without removing
more than the class strings. It belongs in the admin (no other consumer), next to the other presentational helpers in `apps/admin/src/views/`.

## Changes

1. New `apps/admin/src/views/sub-nav.ts`
   - Change: export `subNavLinkClass(isCurrent: boolean): string` returning
     `"inline-flex min-h-6 items-center underline underline-offset-4 pointer-coarse:min-h-11 font-semibold text-foreground"` when current and
     `"inline-flex min-h-6 items-center underline underline-offset-4 pointer-coarse:min-h-11 text-muted-foreground"` otherwise (a shared
     base string plus the two looks). A one-line comment says why: 24 px for WCAG 2.5.8, 44 px on touch, like `Breadcrumbs`.
   - Preserve: nothing else in `views/`.
   - Verify: Tailwind emits both utilities (the class strings are literals in the file, so the scanner finds them).
2. `dictionary-frame.tsx`, `shipping-frame.tsx`, `email-frame.tsx`, `search-frame.tsx`, `privacy-frame.tsx` (the `<Link>` inside each
   sub-navigation, lines listed above)
   - Change: `className={subNavLinkClass(screen.id === current)}` (`active` instead of `current` in `privacy-frame.tsx`), importing it from
     `../../views/sub-nav`. Remove the inline ternaries.
   - Preserve: `aria-current`, `to`, the label key, the `nav` and its `aria-label`, the `ul` classes (`flex flex-wrap gap-x-5 gap-y-2`), and the
     other exports of each frame (`linkClass`, `focusClass`, `primaryLinkClass`, ...).
   - Verify: at 375 px with a touch emulation each sub-navigation link measures at least 44 px tall; at 1280 px with a mouse at least 24 px;
     the current item is still bold, body colour and underlined, the others muted and underlined.
3. `docs/files/admin.md`, the `views/` line
   - Change: add `sub-nav.ts` (`subNavLinkClass`: the link class of the five area sub-navigations; sizing like `Breadcrumbs`; must NOT carry
     area-specific looks).

## Scope

- Inherit: every screen of the catalog dictionaries, shipping, e-mail, catalog search and personal data areas.
- Verify: the space between the sub-navigation and the page `h1` (each frame's `flex flex-col gap-6`) still looks right with the taller row;
  wrapping of the five dictionary links at 375 px; the admin's built CSS contains `@media (pointer: coarse)` rules for `min-h-11`.
- Exclude: the e-mail status table links and every other use of an area `linkClass` (different cause, used for in-sentence links too; a
  separate decision); focus styling of the sub-navigation links (they show the browser default like every admin link today); the e-mail
  template preview's locale switch (`email/templates-view.tsx:102-125`, a different control); the main `SideNav`.

## Validation

- Product: an admin on a phone switches between Shipping and Carriers, the e-mail screens, the dictionaries, the search screens and the
  personal data screens by tapping the sub-navigation.
- Interface: 375 px with a touch emulation and 1280 px with a mouse; current and other items; a long label set (dictionaries) wrapping on
  a phone; keyboard focus still visible.
- System: `grep -rn "underline underline-offset-4\"" apps/admin/src/areas/*/*-frame.tsx` no longer finds the sub-navigation ternaries; one
  helper owns the class; no parallel copy left.
- Repository:
  - `pnpm --filter @fluxkit/admin test` → passes (the specs that count `aria-current="page"` stay green: the attribute is unchanged).
  - `pnpm --filter @fluxkit/theme test` → passes (the design guard scans `apps/admin`; no new size, radius or shadow).
  - `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm check:boundaries` → pass.
  - `pnpm --filter @fluxkit/admin test:e2e` → passes.

## Stop conditions

- Stop if the five frames no longer share the class strings quoted above, or if a shared sub-navigation component already exists: use it.
- Stop if the admin's built CSS does not contain the `pointer-coarse` rule (Tailwind variant not generated): report it instead of switching
  to a raw media query.
- Stop if the owner wants 44 px with a mouse too (`min-h-11` without the variant): that is a different look on desktop and widens the change.

## Design documentation

- After acceptance and validation: the `docs/files/admin.md` line above. No contract or token change; `CHANGELOG.md` optional (admin-only
  visual change).
