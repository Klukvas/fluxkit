# Product card registry and the `view` URL parameter

Status: draft (since PR-F of `docs/plans/2026-11-08-design-changeability.md`, L2 and L5; owner approval 2026-11-08, plan section 9).
Additive: a new kind, field or view is minor; a rename or removal is major with a note in `docs/migrations/`.

## Card registry (storefront)

| Name | Shape | Notes |
|---|---|---|
| `apps/storefront/src/components/cards/custom.ts` | `export const customCards: CardRegistry` | FORK-OWNED, empty upstream, never edited by upstream after creation. A fork registers new kinds or overrides `grid` / `list` here, with the cards in new files. |
| `CardRegistry` (`cards/types.ts`) | `Readonly<Record<string, CardKindEntry>>` | Kinds by name. |
| `CardKindEntry` | `{ Card: CardComponent; listClassName: string; maxEagerImages: number }` | `listClassName`: literal Tailwind classes of the `<ul>` (no arbitrary values, design guard); `maxEagerImages`: leading images loaded eagerly. |
| `CardComponent` / `CardProps` | `(props: { card: ProductCardModel; headingLevel: "h2" \| "h3"; eager: boolean; locale; t }) => ReactNode` | A SERVER component; never a `'use client'` file (`client-boundary.spec.ts`). `t` is for the card's own extra text (`custom.*` keys). |
| `ProductCardModel` (`lib/product-card-model.ts`, built by `cardDisplay`) | `{ id, title, href, image: { src, alt }, brand: { name, href } \| null, price, priceLabel, note, availability: { text, variant, badge } \| null }` | Plain data, all texts translated, links localized. A card renders this, never the API's list item. |
| Built-in kinds | `grid` (default; the card of before the registry, markup unchanged), `list` (one per row, image beside the text) | `resolveCard(kind)`: an unknown kind renders `grid` and logs `console.error` (never silent). |

Accessibility rules every kind keeps (the built-in kinds are the reference): one link to the product (the title, stretched over the card),
the brand link above that layer, the price with `priceLabel`, availability as a badge only when `badge` is true (else visually hidden text),
the heading level given by `headingLevel`, no action inside the product link.

## `view` URL parameter (catalog, category and search result pages)

| Value | Meaning |
|---|---|
| absent | the `grid` card kind (default; never written into an address) |
| `list` | the `list` card kind |
| `grid` or anything else | redirect to the same address without `view` (no error page) |

Kept by every filter, chip, sort, page and brand link and by the filter form; never sent to `GET /store/search` or `GET /store/products`,
never part of a cache key, a canonical URL, hreflang or the sitemap. The switch is two links in a labelled group with `aria-current`
(`components/view-toggle.tsx`, messages `catalog.view.label`, `catalog.view.grid`, `catalog.view.list`).

Not contract: the markup and classes of the built-in cards and of the switch, the position of the switch, default values.
