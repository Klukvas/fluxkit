# Home sections: width and custom sections

Status: draft (since PR-G2 of `docs/plans/2026-11-08-design-changeability.md`, L4; owner approval 2026-11-08, plan section 9).
Additive: a new width, section kind or field is minor; a rename or removal is major with a note in `docs/migrations/`.

The home page is the ordered list `homeSections` in `apps/storefront/src/config/home.ts` (upstream-owned; a fork edits it). What is
contract here is the shape of a section's `width`, the `custom` kind and the fork-owned registry; the default composition, texts and
pictures are not.

## Section width

| Name | Shape | Notes |
|---|---|---|
| `width` (every section kind) | `"contained" \| "full"`, optional | Default `contained`. `HOME_SECTION_WIDTHS` lists the values. |
| `contained` | - | The section sits in the page's content width (`Container` of `@fluxkit/ui`). With every section contained the page keeps ONE container around all sections: the markup from before `width` existed, byte for byte. |
| `full` | - | A band over the whole window width on the `muted` token surface behind the section; the section's own content stays in the content width, aligned with the contained sections. A hero (its surface is `muted` too) blends into the band: a full-bleed hero. Once one section is `full`, every section gets a frame of its own (the stack itself spans the window). |
| `checkHomeSections(sections)` | `(sections: readonly HomeSection[]) => void` | Runs on every render of the home page. Throws on an unknown `width`, a duplicate `id`, or a `custom` section whose `name` is not letters, digits and `-` starting with a letter. TypeScript refuses the same at compile time; the check covers casts and plain JavaScript. |

A section that renders nothing (no data, an empty custom section) leaves no frame and no gap. No hero text overlay, no other widths.

## Custom sections

| Name | Shape | Notes |
|---|---|---|
| `CustomSection` (`config/home.ts`) | `{ kind: "custom"; id: string; name: string; width?: "contained" \| "full" }` | Placed in `homeSections` like any other section. `name` is a key of `customSections`. |
| `apps/storefront/src/config/custom-sections.ts` | `export const customSections: CustomSectionRegistry` | FORK-OWNED, empty upstream, never edited by upstream after creation. Maps names to components in the fork's new files. |
| `CustomSectionRegistry` (`lib/custom-sections.ts`) | `Readonly<Record<string, CustomSectionComponent>>` | Own keys only (a name such as `toString` does not resolve). |
| `CustomSectionComponent` / `CustomSectionProps` | `(props: { id: string; headingId: string; locale: Locale; t: Translator; isFirst: boolean }) => ReactNode` | A SERVER component (it may be `async`); never a `'use client'` file (`client-boundary.spec.ts`; a client reference registered directly throws on render). It gets this plain view model only, never an API object. `headingId` = `<id>-title` for its heading (`aria-labelledby`); its heading is an `h2` (the page's `h1` is the first hero, or a visually hidden one). `t` with keys of the fork's `custom.` namespace (`src/messages-extra/{uk,en}.json`). `isFirst`: above the fold, load pictures eagerly. Return `null` to show nothing. An interactive part is a client component the server component renders with plain, translated props. |
| `resolveCustomSection(section, registry)` | `=> CustomSectionComponent \| null` | Unknown name: throws in development and tests (`next dev` shows it); in production `console.error` on every render and the section is left out while the rest of the page renders. Never silent. |

First HTML (ADR 0048): a custom section renders in place, with no `Suspense` boundary and no loading view of its own. Data a custom
section reads itself must be fast and cached: an `async` custom section delays the whole home page (the route's existing loading
view stays meanwhile).

Not contract: the markup and classes of the frames and the band, the default home composition, the built-in sections' markup.
