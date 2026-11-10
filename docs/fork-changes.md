# Fork changes (reshape)

What this client fork changed on top of the template, for whoever merges upstream next (`docs/customization.md` section 5).
Fork-owned and new files never conflict; the core edits below may.

## Fork-owned files filled

- `apps/storefront/src/components/cards/custom.ts` — `grid` and `list` overridden.
- `apps/storefront/src/config/header.ts` — `layout: "centred"`.
- `apps/storefront/src/config/footer.ts` — blocks `themeSwitch`, `copyright` (the columns render the rest).
- `apps/storefront/src/config/slots.tsx` — `header.top` (announcement bar), `footer.columns` (four columns).
- `apps/storefront/src/config/custom-sections.ts` — `fullBleedHero`, `brandStrip`.
- `apps/storefront/src/messages-extra/{uk,en}.json` — the `custom.` texts.

## New files of the fork

- `apps/storefront/src/components/cards/portrait-grid-card.tsx` — the `grid` card (4:5 picture, price pill, badges, heart).
- `apps/storefront/src/components/cards/horizontal-list-card.tsx` — the `list` card (`?view=list`).
- `apps/storefront/src/components/cards/fork-card-parts.tsx` — sale badge, small-caps brand, heart of both cards.
- `apps/storefront/src/components/fork/favourite-button.tsx` — client island of the heart (stores nothing).
- `apps/storefront/src/components/fork/announcement-bar.tsx`, `apps/storefront/src/config/announcement.ts` — the bar and its config.
- `apps/storefront/src/components/fork/full-bleed-hero.tsx` — the home hero with text over the picture.
- `apps/storefront/src/components/fork/brand-strip.tsx`, `apps/storefront/src/config/brand-strip.ts` — the brand logos.
- `apps/storefront/src/components/fork/footer-columns.tsx`, `apps/storefront/src/config/footer-extras.ts` — the footer columns, social links, pay pictures.
- `apps/storefront/public/fork/` — the fork's pictures (all placeholders).
- Specs next to them: `portrait-grid-card.spec.tsx`, `horizontal-list-card.spec.tsx`, `fork/centred-header.spec.tsx`,
  `fork/home-sections.spec.tsx`, `fork/footer-columns.spec.tsx`.

## Core edits (upstream-owned files; expect conflicts)

| File | Change | Why |
|---|---|---|
| `apps/storefront/src/layout/header-layout.ts` | optional `HeaderConfig.layout` (`row` default, `centred`), checked | a centred header is a code edit by the guide; an option keeps the default markup |
| `apps/storefront/src/components/site-header.tsx` | `centredRow`, a `label` for a second inline navigation | same |
| `apps/storefront/src/app/globals.css` | `.fk-header-side`, `.fk-header-centred` rules; `scroll-padding-top` 7rem with an announcement bar | same; the bar makes the sticky header taller |
| `apps/storefront/src/components/slots.fork.spec.tsx` | mocks `config/header` with the template's default | it pins the template's header row and read the fork's real header config |
| `apps/storefront/src/config/home.ts` | the home composition | the guide's place for it (upstream-owned) |

## Upstream-only specs deleted (as the guide says)

`fork-marker.upstream.spec.ts`, `cards/custom.upstream.spec.ts`, `header-footer-defaults.upstream.spec.tsx` and its folder,
`config/slots.upstream.spec.ts`, `lib/home-template-default.upstream.spec.ts`.

## Placeholders (`TODO(fluxkit)`)

- Sale badge on every card: the list item has no compare-at price (`cards/fork-card-parts.tsx`).
- Favourite heart: toggles its own state only; no wishlist feature (`fork/favourite-button.tsx`).
- "Bestsellers": the four newest products; the store API has no sales ranking (`config/home.ts`).
- Brand logos: one neutral picture under invented names; the API has no brand pictures (`config/brand-strip.ts`).
- Newsletter: text only; social addresses, glyphs and pay pictures are neutral stand-ins (`config/footer-extras.ts`).
- Hero picture: a neutral illustration (`public/fork/hero-wide.svg`).

## Not verified

No browser run: the layout of the centred header, the cards, the hero and the footer columns is checked by markup specs only.
