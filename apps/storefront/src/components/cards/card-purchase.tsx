import { VisuallyHidden } from "@fluxkit/ui";
import Link from "next/link";
import type { ProductCardModel } from "../../lib/product-card-model";
import { CardAddButton } from "../card-add-button";
import { focusRing } from "../styles";

/** The link twin of the card's secondary button: the same size and look, so both purchase kinds line up in a grid. */
const chooseLinkClass = `relative z-10 inline-flex min-h-11 w-full items-center justify-center rounded-control border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted ${focusRing}`;

/**
 * The purchase action of the built-in cards (`card.purchase`, owner design 2026-11-13), a SIBLING of the card's stretched
 * title link and above its layer (`relative z-10`), never inside it: the add-to-cart island for a product with one sellable
 * variant, a "choose options" link to the product page for one with several, nothing when it cannot be bought here (the
 * availability badge already says so). Both name the product too (visually hidden), so a list of them stays distinct.
 */
export function CardPurchaseAction({ card }: { card: ProductCardModel }) {
  const { purchase } = card;
  if (purchase === null) return null;
  if (purchase.kind === "add") {
    return <CardAddButton variantId={purchase.variantId} title={card.title} />;
  }
  return (
    <Link href={card.href} className={chooseLinkClass}>
      <span>{purchase.label}</span> <VisuallyHidden>{card.title}</VisuallyHidden>
    </Link>
  );
}
