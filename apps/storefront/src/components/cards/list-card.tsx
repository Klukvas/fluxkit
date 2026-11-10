import { Badge, PriceText, textStyles, VisuallyHidden } from "@fluxkit/ui";
import Link from "next/link";
import { StoreImage } from "../store-image";
import { focusRing } from "../styles";
import type { CardProps } from "./types";

/**
 * The `list` card kind (`?view=list`): one product per row, the image beside the text. The same accessibility contract as
 * the grid card: one link to the product (the title, stretched over the card), the brand link above that layer, the price
 * with its spoken label, availability as a badge only for an exception (in stock stays text for assistive technology).
 * Token and role classes only; every text comes translated from the view model. No add-to-cart: the list item has no
 * variant id, so the product page is where a variant is chosen.
 */
export function ListCard({ card, headingLevel: Heading, eager }: CardProps) {
  const { availability } = card;
  return (
    <article className="group relative flex gap-4 rounded-card border border-border bg-background p-3 transition-shadow hover:border-border-input hover:shadow-raised focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring motion-reduce:transition-none">
      <div className="w-24 shrink-0 sm:w-40">
        <StoreImage
          src={card.image.src}
          alt={card.image.alt}
          width={160}
          height={160}
          sizes="(min-width: 640px) 160px, 96px"
          eager={eager}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {card.brand === null ? null : card.brand.href === null ? (
          <p className="text-sm text-muted-foreground">{card.brand.name}</p>
        ) : (
          <Link
            href={card.brand.href}
            className={`relative z-10 inline-flex min-h-6 w-fit items-center rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline pointer-coarse:pointer-events-none ${focusRing}`}
          >
            {card.brand.name}
          </Link>
        )}
        <Heading className={`${textStyles.cardTitle} line-clamp-2`} title={card.title}>
          <Link
            href={card.href}
            className="after:absolute after:inset-0 group-hover:underline group-hover:underline-offset-4 focus-visible:outline-none"
          >
            {card.title}
          </Link>
        </Heading>
        {card.note === null ? null : <p className="text-sm text-muted-foreground">{card.note}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          <PriceText price={card.price} priceLabel={card.priceLabel} />
          {availability === null ? null : availability.badge ? (
            <Badge variant={availability.variant} className="w-fit">
              {availability.text}
            </Badge>
          ) : (
            <VisuallyHidden>{availability.text}</VisuallyHidden>
          )}
        </div>
      </div>
    </article>
  );
}
