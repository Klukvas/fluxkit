# Home sections: width and custom sections

Status: draft (since PR-G2 of `docs/plans/2026-11-08-design-changeability.md`, L4; owner approval 2026-11-08, plan section 9).
Additive: a new width, a width for more kinds, a section kind or a field is minor; a rename or removal is major with a note in
`docs/migrations/`.

The home page is the ordered list `homeSections` in `apps/storefront/src/config/home.ts` (upstream-owned; a fork edits it). What is
contract here is the shape of the section types (`width`, the `custom` kind) and the fork-owned registry; the default composition,
texts and pictures are not. Changes to `config/home.ts` need a change under `docs/contracts/` (`check:docs`).

## Section width

| Name | Shape | Notes |
|---|---|---|
| `width` on the built-in kinds (`hero`, `banners`, `categories`, `productRow`, `trust`, `richText`) | `"contained"`, optional | The only value (and the default) for now: these sections have no edge-to-edge layout (their cards, grids and the hero's rounded surface would touch the window's edges). Allowing `full` for one of them later is additive. |
| `width` on `custom` | `"contained" \| "full"`, optional | Default `contained`. `HOME_SECTION_WIDTHS` lists the values. |
| `contained` | - | The section sits in the page's content width (`Container` of `@fluxkit/ui`). With every section contained the page keeps ONE container around all sections: the markup from before `width` existed, byte for byte. |
| `full` | - | The section renders WITHOUT a container: it spans the window edge to edge and chooses its own inner width and surface (for example a `bg-muted` band with `Container` inside; see `width` in `CustomSectionProps`). Once one section is `full`, every other section gets its own `Container`. A `full` section first on the page sits flush under the header; two adjacent `full` sections touch (no gap between them); every other pair keeps the stack's gap. |
| `checkHomeSections(sections)` | `(sections: readonly HomeSection[]) => void` | Runs on every render of the home page. Throws on an unknown `width`, `full` on a built-in kind, a duplicate `id`, or a `custom` section whose `name` is not letters, digits and `-` starting with a letter. TypeScript refuses the same at compile time; the check covers casts and plain JavaScript. |

A section that renders nothing (no data, a custom section returning `null`) leaves no frame and no gap. Known limits (spacing is decided from the
config, not from what rendered): a `full` section right after a `full` section that rendered nothing still pulls up over the gap, and
when a first `full` section renders nothing the next section starts without the stack's top padding. No hero text overlay, no other widths; a full-bleed
hero today is a custom section (its own markup, `Hero` of `@fluxkit/ui` is a rounded card).

## Custom sections

| Name | Shape | Notes |
|---|---|---|
| `CustomSection` (`config/home.ts`) | `{ kind: "custom"; id: string; name: string; width?: "contained" \| "full" }` | Placed in `homeSections` like any other section. `name` is a key of `customSections`. |
| `apps/storefront/src/config/custom-sections.ts` | `export const customSections: CustomSectionRegistry` | FORK-OWNED, empty upstream, never edited by upstream after creation. Maps names to components in the fork's new files. |
| `CustomSectionRegistry` (`lib/custom-sections.ts`) | `Readonly<Record<string, CustomSectionComponent>>` | Own keys only (a name such as `toString` does not resolve). |
| `CustomSectionComponent` / `CustomSectionProps` | `(props: { id: string; headingId: string; locale: Locale; t: Translator; isFirst: boolean; width: "contained" \| "full" }) => ReactNode` | A SERVER component (it may be `async`); never a `'use client'` file (`client-boundary.spec.ts`; a client reference registered directly throws on render). It gets this plain view model only, never an API object. `headingId` = `<id>-title` for its heading (`aria-labelledby`); its heading is an `h2` (the page's `h1` is the first hero, or a visually hidden one). `t` with keys of the fork's `custom.` namespace (`src/messages-extra/{uk,en}.json`). `isFirst`: above the fold, load pictures eagerly. `width`: with `full` the component draws its own surface with token classes and keeps its content readable (for example inside `Container`). Return `null` to show nothing. An interactive part is a client component the server component renders with plain, translated props. |
| `resolveCustomSection(section, registry)` | `=> CustomSectionComponent \| null` | Unknown name: throws in development and tests (`next dev` shows it); in production `console.error` once per name and server process, and the section is left out while the rest of the page renders. Never silent. |

Why an unknown custom section fails while an unknown card kind falls back (`resolveCard`, `card-registry.md`): an unknown card kind
has an obvious stand-in (the `grid` card shows the same products), so the shopper loses nothing. An unknown custom section has none:
showing anything else would be content nobody configured, so development stops and production leaves the section out. A fork-proof
spec (`components/home-config.spec.ts`) checks the real `config/home.ts` against the real registry, so a typo fails `pnpm test` too.

Errors: a custom section that THROWS while rendering takes the whole home page down to the route's error page (there is no error
boundary per section: a server component cannot catch a sibling's error without a client boundary, and the data sections' error view
`SectionError` covers failed API reads only). A custom section that reads data handles its own failure (renders `null` or a message).

First HTML (ADR 0048): a custom section renders in place, with no `Suspense` boundary and no loading view of its own. Data a custom
section reads itself must be fast and cached: an `async` custom section delays the whole home page (the route's existing loading
view stays meanwhile).

Not contract: the markup and classes of the frames, the default home composition, the built-in sections' markup.
