import { Badge, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import type { ProductCardModel } from "../../lib/product-card-model";
import { FavouriteButton } from "../fork/favourite-button";
import { focusRing } from "../styles";

/**
 * FORK (reshape R1 and R2): the parts the fork's two cards share (`portrait-grid-card.tsx`, `horizontal-list-card.tsx`).
 * Server components; token classes only; texts from the view model or the fork's `custom.` messages.
 */

/**
 * TODO(fluxkit): a PLACEHOLDER. The list item of the store API has no compare-at price (`ProductCardModel` carries one price
 * text only), so a card cannot know whether a product is on sale. Until the view model has it, every card shows the badge so
 * the design can be judged; switch it off here before a release, or decide from the model once it carries a compare-at price.
 */
const SALE_BADGE_PLACEHOLDER_ON_EVERY_CARD: boolean = true;

/** The sale badge, or `null`; the caller places it (top right of the picture on the grid card). */
export function SaleBadge({ t, className }: { t: Translator; className: string }) {
  if (!SALE_BADGE_PLACEHOLDER_ON_EVERY_CARD) return null;
  return (
    <Badge variant="danger" className={className}>
      {t("custom.card.sale")}
    </Badge>
  );
}

/** The brand in small capitals above the title: a link above the card's link layer, or plain text. */
export function CardBrand({ brand }: { brand: ProductCardModel["brand"] }) {
  const look = "text-xs font-semibold tracking-widest text-muted-foreground uppercase";
  if (brand === null) return null;
  if (brand.href === null) return <p className={look}>{brand.name}</p>;
  return (
    <Link
      href={brand.href}
      className={`relative z-10 inline-flex min-h-6 w-fit items-center rounded-sm underline-offset-4 hover:text-foreground hover:underline pointer-coarse:pointer-events-none ${look} ${focusRing}`}
    >
      {brand.name}
    </Link>
  );
}

/** The favourite heart (a placeholder, see `FavouriteButton`), named with the product's title. */
export function CardFavourite({ card, t }: { card: ProductCardModel; t: Translator }) {
  return <FavouriteButton label={t("custom.card.favourite", { title: card.title })} />;
}
