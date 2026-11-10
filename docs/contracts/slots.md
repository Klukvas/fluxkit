# UI slots

Status: draft (since PR-H of `docs/plans/2026-11-08-design-changeability.md`, S1; owner approval 2026-11-08, plan section 9 decision 2).
Additive: a new slot, a new prop in a slot's view model or a new place for an existing slot on a new built-in card kind is minor; a renamed
or removed slot or prop, or a slot moved to another place, is major with a note in `docs/migrations/`.

A slot is a fixed place in the storefront where a fork adds its own SERVER components without editing core files. There are exactly four.
What is contract: the slot names, their places (as described below), the props each component receives, the fork-owned registry and the
failure rules. Not contract: the markup and classes around the places (the header row, the card's other elements, the footer blocks) and
the classes of the slot frames listed below beyond what the table promises. Changes to `config/slots.tsx` or `lib/slots.ts` need a change
under `docs/contracts/` (`check:docs`; in a fork with the `.fluxkit-fork` marker only `lib/slots.ts`, `docs/contracts/README.md`).

## Registry

| Name | Shape | Notes |
|---|---|---|
| `apps/storefront/src/config/slots.tsx` | `export const slots: SlotRegistry` | FORK-OWNED, empty upstream (`{}`), never edited by upstream after creation. |
| `SlotRegistry` (`lib/slots.ts`) | `{ readonly [Name in SlotName]?: readonly SlotComponent<Name>[] }` | Per slot an ordered list of components; they render in that order. A name outside `SlotName` is a TypeScript error in the object literal. Own keys only. |
| `SlotName`, `SLOT_NAMES` (`lib/slots.ts`) | `"header.top" \| "product-card.badges" \| "product-card.actions" \| "footer.columns"` | The four slots. |
| `SlotComponent<Name>` | `(props: SlotPropsByName[Name]) => ReactNode` | A SERVER component (it may be `async`); never a `'use client'` file (`client-boundary.spec.ts`). Returning `null` shows nothing. An interactive part is a client component that the server component renders with plain, already translated props. |
| `renderSlot(name, props, registry)` | `=> ReactNode[] \| null` | For a fork's own card kind (`docs/contracts/card-registry.md`) that wants the card slots: the elements in order, or `null` when the slot has no components. Place the result (and any frame) only when it is not `null`. |

## Slots

Every component receives `locale` and `t` (the page's translator: keys of the fork's `custom.` namespace in `src/messages-extra/{uk,en}.json`,
or any template key) plus the slot's data below. All props are plain view models: strings, numbers, `null`, arrays and objects of those,
and the translator; never an API object.

| Slot | Place | Extra props | Frame when filled |
|---|---|---|---|
| `header.top` | Inside `<header>` (the banner landmark), before the header row, on every page. Below `lg` the header is sticky, so this is too. | none (`HeaderTopSlotProps`) | none: the components are the header's first children. They draw their own full-width surface (for example `bg-primary text-primary-foreground` with `Container` of `@fluxkit/ui` inside). |
| `product-card.badges` | On the built-in `grid` and `list` cards: a row under the image and above the brand and title (`grid`), above the brand and title in the text column (`list`). | `card: ProductCardModel` (`docs/contracts/card-registry.md`), `kind: string` (`"grid"` or `"list"`) | one `div` (`flex flex-wrap gap-1`) around the components. |
| `product-card.actions` | On the same cards, above the card's link layer: in the image's bottom right corner (`grid`; the core availability badge keeps the top left corner, so they never meet: measured at 320, 375 and 1280 px) and at the end of the price row (`list`). | as `product-card.badges` | `grid`: the image moves into a `div` (`relative flex flex-col`) that also holds one `div` (`absolute right-2 bottom-2 z-10 flex gap-1`) around the components; `list`: one `div` (`relative z-10 ms-auto flex gap-1`). Each action is a control of its own (a client island's button, or a link to ANOTHER target): the card title stays the card's link to the product. It brings its own opaque background (no text directly on a photo), an accessible name (with the product's title) and a 44 px target (`min-h-11 min-w-11`). |
| `footer.columns` | At the top of the footer, before the blocks of `config/footer.ts`. Each component is one column. | `shopLinks`, `legalLinks: readonly SlotLink[]` (`{ label, href }`: translated, localized), `contacts: ContactsView` (`FooterContacts` of `components/contact-details.tsx` renders it) | one grid `div`: 1 column; 2 side by side from `sm`; 3 or 4 per row from `lg`; more than 4 wrap into rows of 4. The column count comes from the number of registered components, so a component that returns `null` leaves an empty cell (return `null` only from the last ones, or register only what renders). A component should return ONE element (a fragment's parts become separate grid cells). |

A four-column footer (plan target 5) with config and new files only: four column components in `config/slots.tsx`, and `navigation` and
`contacts` left out of `blocks` in `config/footer.ts` (the columns render them from `shopLinks`, `legalLinks` and `contacts`). Each link
column is its own labelled `nav` with a heading; contacts stay in one `<address>`. Upstream's fork runs show exactly that
(`src/lib/slots-fork-fixture.tsx`, `src/components/slots.fork.spec.tsx`).

Inherited footer rules: the footer's own component rules in `app/globals.css` also apply to what a column renders: `.fk-site-footer nav`
(a column of gap 1), `.fk-site-footer ul` and `address` (a WRAPPING ROW, `flex flex-wrap gap-x-2`) and `.fk-site-footer ul a`,
`address a` (a 44 px tall, `whitespace-nowrap`, padded link). In a column, stack the list (`flex-col` on the `ul`) and let long link texts
wrap (`whitespace-normal` on the link): utilities win over these rules. Without that, a long name (uk "Повідомлення про конфіденційність")
runs past a quarter-width column (measured: 8 px at 640, 70 px at 1024, 38 px at 1280 px); with it, nothing overflows in uk or en at
640, 1024 and 1280 px (probe below).

Geometry probe (LOCAL ONLY, not in CI: it needs Playwright's Chromium, no database): `apps/storefront/e2e/support/slots-geometry/`
renders the fork fixture with the real compiled stylesheet and asserts no overlap of the actions frame with the availability badge (grid
card, 320, 375, 1280 px) and no overflowing link or overlapping column in the four-column footer (uk and en, 640, 1024, 1280 px):
`PLAYWRIGHT_BROWSERS_PATH=<browsers> pnpm --filter @fluxkit/storefront exec vitest run -c e2e/support/slots-geometry/vitest.config.ts`.

## Accessibility and layout notes

- `header.top` and the sticky header: below `lg` the header is sticky and the bar is part of it, so the header grows (with the fixture's
  one-line bar it measured 97 px tall in review) and takes more of a phone's screen. `scroll-padding-top` (`app/globals.css`, 5 rem =
  80 px below `lg`) does NOT grow with it: an anchor or a focused field can land under the header. There is no fork-owned stylesheet for
  the storefront yet, so a fork with a bar either keeps it short, shows it only from `lg` (`max-lg:hidden` on the bar), or raises
  `scroll-padding-top` in `app/globals.css` (a core edit).
- `product-card.actions` focus order: on `grid` the actions come before the brand link and the title in the DOM, as they come first on
  screen (the image is above the text); on `list` they come after the price, at the row's end. While an action has the focus, the whole
  card shows its `focus-within` outline, as for the title and brand links.
- Texts through `t` only; token classes only (the design guard applies to a fork's files as to any other).

## Empty slots

A slot without components renders NOTHING: no element, no frame, no empty landmark, and no entry in the page's React payload (the place
adds a child only when the slot has components). With the template's empty `config/slots.tsx` the header, footer and cards render the
markup they rendered before slots existed, byte for byte (`components/slot-places.spec.tsx`, the frozen header and footer in
`components/header-footer-defaults/`, the frozen card in `components/cards/registry.spec.tsx`). A slot whose components all return `null`
still renders its frame (the card and footer slots) or nothing (`header.top`).

## Failures (checked on every render)

| Case | Development and tests | Production |
|---|---|---|
| A name that is not a slot (a typo; `tsc` already refuses it in the literal, this covers casts and plain JavaScript) | throws: `next dev` shows the error, `pnpm test` fails | `console.error` once per name and server process; that entry is left out, the known slots render |
| A slot's value that is not a list, an entry that is not a function, or a client component registered directly | throws | throws (it could not render: a client component cannot receive the translator) |
| A slot component that THROWS while rendering | the page fails | the page fails |

The whole registry is checked whenever a slot renders, and the header renders `header.top` on every page, so a broken entry breaks (or, for
an unknown name in production, is logged on) every page. A throwing component, or a check that throws, inside the header or footer takes
down EVERY page: `SiteShell` renders inside `app/[locale]/layout.tsx`, its `error.tsx` sits inside that layout and cannot catch it, and the
app has no `global-error.tsx`, so the answer is Next's bare 500 page (the error in the server log). On a card it takes down the page with
the list (catalog, category, search, home sections). The slot host adds no error boundary (a boundary is a client component, and catching
would hide the failure): a component that reads data handles its own failure (renders `null` or a message).

## First HTML (ADR 0048)

Slot components render in place, in the server's first HTML, with no `Suspense` boundary and no loading view added by the slot host. An
`async` component delays the page it is on (`header.top` and `footer.columns`: every page), so data a component reads must be fast and
cached. A component must not wrap anything a shopper types into or must use without a script in a `Suspense` boundary.

## Tests in a fork

`config/slots.upstream.spec.ts` pins the template's empty registry: upstream-only, FORK-DELETABLE (a fork that fills a slot deletes it).
The specs that check the template's own header, footer and cards pin the slots empty with `vi.mock`, so they stay green whatever a fork
registers (with filled slots, the default home page's frozen copy and the frozen header, footer and card markup still pass). Upstream
runs the whole unit suite twice more with every slot filled: `apps/storefront/vitest.brand-fork.config.ts` (with the DEFAULT home page,
the fork's brand, header and footer) and `apps/storefront/vitest.home-fork.config.ts` (with a reshaped home page). Deleting
`config/slots.upstream.spec.ts` keeps `src/customization-doc.spec.ts` green (it lists the fork-deletable files). A fork tests its own slot
components in its own specs.
