# UI open items: council decisions (2026-11-11)

Source: the "Observations that need an owner decision" of `docs/plans/2026-11-11-improve-ui-audit-2.md` and the three proposals of the
`ui-quality` pass (`docs/HANDOFF.md`, UI quality bullet). The owner delegated these decisions (2026-11-11: "мои решения не жди, если нужно
решения - собирай консиллиум агентов"). Council: three read-only agents with different lenses: UX and product (Opus), template
changeability and architecture (Sonnet), accessibility and i18n (Sonnet). Rule: majority; the orchestrator breaks ties and states why.
No item needs a red zone (AGENTS.md section 14): no token, contract, dependency, schema or config default changes.

| # | Item | UX | Architecture | A11y/i18n | Decision |
| --- | --- | --- | --- | --- | --- |
| 1 | Header category list clipped mid-word at 1280 px | DO | DO | DO | DO, CSS only |
| 2 | Footer links 8 px right of the other footer lines | DO | DO | DO | DO, CSS only |
| 3 | Legal pages without breadcrumbs | DO | DON'T | DO | DO |
| 4 | Admin back-link and counter copy | DO | DO | DO | DO, message values only |
| 5 | Admin standalone links ~18 px on a phone | DO | DO | DO | DO |
| 6 | Page-shaped placeholders on admin detail screens | DEFER | DEFER | DO | DEFER |
| 7 | Delay before the storefront loading placeholder | DO | DON'T | DON'T | DO, limited (see below) |
| 8 | Offline notice | DON'T | DON'T | DEFER | DON'T |

## What to build

1. **Header** (`apps/storefront/src/app/globals.css`, `.fk-header-nav`): an end-edge fade (`mask-image`, logical end side) so the cut reads as
   scrollable, shown only while the list can scroll (scroll-driven animation `animation-timeline: scroll(self inline)`; browsers without it
   skip the fade, never hide content); `scroll-snap-type: x proximity` with items snapping at their start. Markup unchanged; keep
   `categoryLimit` as it is (`config/header.ts` is fork-owned, a lower default never reaches forks), no wrap (one-row rule), no "more" menu.
2. **Footer** (`globals.css`): `-ms-2` (negative start margin equal to the links' `px-2`) on the footer link lists and the contacts
   `address`, so their text lines up with "Тема" and the copyright. Keep `px-2` and the 44 px hit area.
3. **Legal pages** (`apps/storefront/src/components/legal-page.tsx` or its route): `Breadcrumbs` Home / page title above the `h1`, exactly as
   the shop pages do, with the existing message keys. Tie-break: two of three for; the architecture objection ("optional polish") does not
   outweigh orientation consistency with the sibling pages in the same footer list.
4. **Admin copy** (`apps/admin/src/messages/{en,uk}/*.json`, values only, keys unchanged so fork overrides stay valid):
   - back links: en "Back to …", uk "Назад до …" everywhere (order detail "Back to orders" / "Назад до замовлень"; no bare "До …");
   - page-range counters: one format without a noun (the heading names the list): en "{from}–{to} of {total}", uk "{from}–{to} з {total}"
     (en dash, no spaces). Tie-break: the three members agreed on one range form but not on the noun; no noun, because the page heading
     already says what is counted and it keeps one string shape for every list;
   - `payment.list.shown` (no total exists) keeps its own wording.
   Update any spec or e2e that asserts the old strings (that is updating an expectation of copy, not weakening a test).
5. **Admin standalone links**: one shared module in `apps/admin/src/views/` (next to `sub-nav.ts`) replacing the duplicated area `linkClass`
   copies. Two exports: the in-sentence link class (today's look, unchanged) and a standalone link class (table cells, back links, pagers)
   with `inline-flex min-h-6 items-center pointer-coarse:min-h-11`, the sizing of `Breadcrumbs` and the sub-navigation. Each call site picks
   the one that matches its context; links inside running text keep the plain class.
7. **Storefront loading delay**: the UX member found the premise outdated: `apps/storefront/src/app/[locale]/(home)/loading.tsx` is already a
   client component, so no new client component and no token is needed. Apply the admin's `LoadingView` pattern (keep the box, `invisible`
   until a 200 ms timer) to loading boundaries that are already client components; leave server-rendered ones as they are. With the red-zone
   objection gone, the remaining argument (a fast navigation flashes the placeholder) carries.

## Not built

- 6: three bespoke placeholders would drift from the detail layouts that forks reshape; the admin spinner already waits 200 ms. Revisit with
  one generic detail placeholder when the detail screens get design work.
- 8: failed requests already offer retry and keep input; `navigator.onLine` is unreliable and a shell listener costs every page and every
  fork's translations.

## Verification

- `pnpm build`, `typecheck`, `lint`, `format:check`, `check:boundaries`, admin and storefront Vitest; e2e and `visual` in CI.
- The header and footer changes alter storefront screenshots on every page: declare them in `.visual/exceptions.json` with these plan
  references (computed styles should not change for the recorded properties; if they do, declare the exact entries).
