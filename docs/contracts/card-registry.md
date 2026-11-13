# Product card registry and the `view` URL parameter

Status: draft (since PR-F of `docs/plans/2026-11-08-design-changeability.md`, L2 and L5; owner approval 2026-11-08, plan section 9).
Additive: a new kind, field or view is minor; a rename or removal is major with a note in `docs/migrations/`.

## Card registry (storefront)

| Name | Shape | Notes |
|---|---|---|
| `apps/storefront/src/components/cards/custom.ts` | `export const customCards: CardRegistry` | FORK-OWNED, empty upstream, never edited by upstream after creation. A fork overrides `grid` and/or `list` here, with the cards in new files. **Today only overrides of `grid` / `list` take effect:** the lists pick the kind from `?view=` (or the default `grid`) only, so a registered NEW kind name (e.g. `compact`) is never selected yet. Selecting a kind by name arrives with `config/catalog.ts` (plan L2; NOT YET AVAILABLE). |
| `CardRegistry` (`cards/types.ts`) | `Readonly<Record<string, CardKindEntry>>` | Kinds by name. |
| `CardKindEntry` | `{ Card: CardComponent; listClassName: string; maxEagerImages: number }` | `listClassName`: literal Tailwind classes of the `<ul>` (no arbitrary values, design guard); `maxEagerImages`: leading images loaded eagerly. |
| `CardComponent` / `CardProps` | `(props: { card: ProductCardModel; headingLevel: "h2" \| "h3"; eager: boolean; locale; t }) => ReactNode` | A SERVER component; never a `'use client'` file (`client-boundary.spec.ts`). `t` is for the card's own extra text (`custom.*` keys). |
| `ProductCardModel` (`lib/product-card-model.ts`, built by `cardDisplay`) | `{ id, title, href, image: { src, alt }, brand: { name, href } \| null, price, priceLabel, note, availability: { text, variant, badge } \| null, purchase }` | Plain data, all texts translated, links localized. A card renders this, never the API's list item. `purchase` (additive, 2026-11-13): `{ kind: "add", variantId }` (the API's `defaultVariantId`: the product's only sellable variant), `{ kind: "choose", label }` (several variants: link to `href` to choose) or `null` (the shown availability is out of stock or unknown). |
| `CardPurchaseAction` (`components/cards/card-purchase.tsx`) | `(props: { card: ProductCardModel }) => ReactNode` | What the built-in cards render for `purchase`: the client island `CardAddButton` (`components/card-add-button.tsx`, `{ variantId, title }`: adds one unit through the shared cart store) or the choose link. A fork's card may render it, or `CardAddButton` itself; it must sit outside the product link. |
| Built-in kinds | `grid` (default; the card of before the registry, markup unchanged), `list` (one per row, image beside the text) | The effective kind is `grid` or `list` (from `?view=`). `resolveCard(kind)`: an unknown kind renders `grid` and logs `console.error` (never silent). It falls back instead of failing because `grid` is a complete stand-in: the shopper still sees the same products. Custom home sections have no such stand-in and fail instead (`home-sections.md`). |

Accessibility rules every kind keeps (the built-in kinds are the reference): one link to the product (the title, stretched over the card),
the brand link above that layer, the price with `priceLabel`, availability as a badge only when `badge` is true (else visually hidden text),
the heading level given by `headingLevel`, no action inside the product link. The purchase action (since 2026-11-13) is a sibling of the title link,
above its layer (`relative z-10`), at least 44 px high, its name the visible label plus the product title (visually hidden). A product with several
variants gets a second link to its page ("choose options"), so such a card has TWO links to the same product page with different names:
the title ("Demo Linen Shirt") and the action ("Choose options Demo Linen Shirt"); a test that finds the title link by name uses an exact
match. The add button of a one-variant product is, until the island hydrates (and without a script), a link to the product page with the
same words and size, so it never sits there disabled.

Card slots (`docs/contracts/slots.md`, since PR-H): the built-in `grid` and `list` cards render the `product-card.badges` and
`product-card.actions` slots of `config/slots.tsx`. A fork's own card kind (or an override of `grid` or `list` in `cards/custom.ts`) gets
NO slots unless it calls `renderSlot` of `lib/slots.ts` itself, with `{ card, kind, locale, t }`.

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
