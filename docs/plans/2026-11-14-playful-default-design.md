# Playful default design (concept 03)

Status: owner-approved decisions (2026-11-14). Workstream A merged (PR 285), B merged (PR 284); C in progress; D implemented, in review (PR).

## Goal

The owner picked concept 03 ("Playful", coffee) from the six storefront concepts of 2026-11-13 (design canvas, private artifact) and asked
to implement it. The template's default look becomes the playful one, and its motion (cart drawer, toasts, number roll, loader, skeleton
shimmer, button states) becomes generic, token-driven storefront behaviour that every fork gets and can retune.

## Owner decisions (2026-11-14, red zones answered in chat)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Where the look lives | **New master default**: palette, fonts, radii and shadows of concept 03 replace today's neutral token values in `packages/theme/src/tokens.css` (light, dark, system). Forks still rebrand through `brand-overrides.css`. |
| 2 | Motion tokens | **Approved, additive**: `--fk-motion-*` (durations and easings) join the theme-token contract (minor version). |
| 3 | Add-to-cart on the product card | **Approved, additive**: `defaultVariantId` (nullable) in the store `ProductSummary` (council item 9 of `2026-11-13-storefront-ui-round-4.md`). |
| 4 | Font licence | **SIL OFL 1.1 approved for unmodified font files** (woff2) shipped with the template, OFL text kept in the third-party notices. Not for code packages. |
| 5 | Light accent (asked after the WS-A review) | **Keep ochre** `#b17b15` with ink text as the light `accent`; the accent contrast rule stays. Butter `#ffd166` (1.32:1 on cream) may come back later only as decoration in WS-D. Owner, 2026-11-14: "Оставить охру". |
| 6 | Font format (asked after the WS-A review) | **Lossless WOFF2 approved**: Rubik's official TTF converted to WOFF2 with every table unchanged (about 122 KB instead of 360 KB); font name Rubik kept (no Reserved Font Name), OFL text kept. Licence wording: unmodified or losslessly converted to WOFF2, font name unchanged. Owner, 2026-11-14: "Да, WOFF2". |

Not part of this plan: the concept's "one-off / subscription -15%" toggle. Subscriptions do not exist; they would be a feature package
that touches pricing (red zone, own plan). The demo copy stays the coffee seed's.

## Concept 03 reference (values to translate into tokens)

- Colours: cream background `#fff3e3`, ink foreground `#2b1a12`, tomato primary `#ff5a36`, butter `#ffd166`, mint `#9be3c0`. The dark
  theme is derived (ink background, cream text), not in the concept; contrast must pass `contrast.spec.ts` in both themes, so the exact
  primary may darken for text on cream.
- Type: Rubik (Cyrillic), heavy display weight, round friendly body.
- Shapes: large radii (cards about 1.5rem, controls pill-shaped), thick ink borders and offset "sticker" shadows.
- Motion: pop-in, spring drawer from the right, number roll on quantity, wobble sticker, marker underline, three-bean loader, shimmer
  skeletons, all off under `prefers-reduced-motion`.
- Only existing colour roles are used (`accent` takes butter or mint). A new colour token needs the owner (red zone, not approved here).

## Existing functionality found

- Tokens: `packages/theme/src/tokens.css` (colours, radius roles, type scale, shadows; no motion tokens), guards `design-guard.spec.ts`,
  `contrast.spec.ts`, `theme.spec.ts`; email and `theme-color` defaults in `email-theme.ts`, `theme-color.ts`.
- Fonts: `apps/storefront/src/config/fonts.ts` is FORK-OWNED and empty upstream; the template therefore needs its own font module (WS-A).
- Toast: the product page's "Added" toast (`components/product-purchase.tsx`, `.fk-toast` in `app/globals.css`). No cart drawer.
- Skeletons: `packages/ui/src/skeleton.tsx`; home sections stream with same-size skeletons (batch B).
- Shipping `free_over` pricing exists (`docs/api/shipping.md`); the cart has no free-shipping progress yet.
- Visual comparison (`scripts/visual-compare.sh`, `.visual/exceptions.json`) flags every default change: WS-A declares them.

## Workstreams (one side session and one PR each; owned paths never overlap)

| WS | Scope | Owned paths | Depends on |
| --- | --- | --- | --- |
| A. Theme defaults | New token values (light, dark, system); Rubik woff2 and a template font module; motion tokens `--fk-motion-duration-fast/base/slow`, `--fk-motion-ease-standard/emphasized/spring` with Tailwind mapping and reduced-motion zeroing; contrast fixes; email and theme-color defaults; `.visual/exceptions.json`; licence docs | `packages/theme/**`, `apps/storefront/src/app/[locale]/layout.tsx` (font class only), a new template font module under `apps/storefront/src/lib/`, `docs/contracts/theme-tokens.md`, `docs/dependencies.md`, `scripts/license-policy.json`, the AGENTS.md section 16 line | none |
| B. Card add-to-cart data | `defaultVariantId` in the store `ProductSummary` (catalog lists, search results), api-client type, `openapi.json`, contract tests | `apps/api/src/**` (store catalog and search mapping), `packages/core/src/**` if the summary is built there, `packages/api-client/**`, `docs/api/*.md`, `docs/api/openapi.json` | none |
| C. Motion kit and cart drawer | Cart drawer (opens after add, spring from the right, focus trap via `dialog-focus.ts`, Escape, backdrop button), toast stack, quantity number roll, button idle-loading-done morph, shimmer skeleton, brand loader; card "Add" / "Choose" button | `packages/ui/src/**` (new components), `apps/storefront/src/components/**` (drawer, purchase, cards), `apps/storefront/src/app/globals.css`, messages (`uk`, `en`) | A (motion tokens), B (card button) |
| D. Playful home | Hero blob, spinning sticker, marker underline, pop-in sections, as configurable home-section options | `apps/storefront/src/config/home.ts` (with a contract doc change), `components/home-sections.tsx`, `docs/contracts/` | A, C |

C and D start after A merges (they need the token names and the new look). Free-shipping progress in the drawer is a follow-up: it needs
a store read of the `free_over` threshold (API shape, red zone).

## Risks

- Open blog PRs (#277 to #283) touch storefront slices and the header; C and D rebase on whatever merges first.
- `fonts.ts` stays fork-owned: the template font must not live there, and a fork's own font must still win (`--fk-font-*` in overrides).
- Every default change shows in the visual comparison; undeclared differences fail CI by design.
- Motion must never block input: drawer and toasts are interruptible, and reduced motion turns durations to 0.

## Verification

Per workstream: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm check:boundaries`, `pnpm test`; `pnpm test:e2e` for C and D;
`bash scripts/visual-compare.sh origin/main` for A, C and D; `pnpm check:licenses` and `pnpm notices` for A. Each PR gets an independent
review by a different model than its author.

## Docs to update

`docs/contracts/theme-tokens.md` (motion tokens, new defaults), `docs/api/catalog.md` and `docs/api/search.md` (`defaultVariantId`),
`docs/dependencies.md` and AGENTS.md section 16 (OFL fonts), `CHANGELOG.md`, `docs/HANDOFF.md`, `apps/storefront/README.md` (drawer).
