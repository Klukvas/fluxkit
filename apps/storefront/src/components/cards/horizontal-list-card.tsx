import { Badge, PriceText, textStyles, VisuallyHidden } from "@fluxkit/ui";
import Link from "next/link";
import { StoreImage } from "../store-image";
import { CardBrand, CardFavourite, SaleBadge } from "./fork-card-parts";
import type { CardProps } from "./types";

/**
 * FORK (reshape R2): the `list` card of this shop (`?view=list`; `cards/custom.ts`, `docs/contracts/card-registry.md`): one
 * product per row, the portrait picture at the start, the text beside it and the price row at the bottom with the favourite
 * heart at its end. The same accessibility contract as the grid card (`portrait-grid-card.tsx`).
 */
export function HorizontalListCard({ card, headingLevel: Heading, eager, t }: CardProps) {
  const { availability } = card;
  return (
    <article className="group relative flex gap-4 rounded-card border border-border bg-background p-3 transition-shadow hover:shadow-raised focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring motion-reduce:transition-none">
      <div className="relative aspect-4/5 w-28 shrink-0 self-start overflow-hidden rounded-card bg-muted sm:w-44">
        <StoreImage
          src={card.image.src}
          alt={card.image.alt}
          width={176}
          height={220}
          sizes="(min-width: 640px) 176px, 112px"
          eager={eager}
          fill
          className="transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
        <SaleBadge
          t={t}
          className="pointer-events-none absolute top-2 right-2 w-fit shadow-card"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <CardBrand brand={card.brand} />
        <Heading className={`${textStyles.cardTitle} line-clamp-2 sm:text-lg`} title={card.title}>
          <Link
            href={card.href}
            className="after:absolute after:inset-0 group-hover:underline group-hover:underline-offset-4 focus-visible:outline-none"
          >
            {card.title}
          </Link>
        </Heading>
        {card.note === null ? null : <p className={textStyles.meta}>{card.note}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          <PriceText
            price={card.price}
            priceLabel={card.priceLabel}
            className="rounded-full bg-muted px-3 py-1"
          />
          {availability === null ? null : availability.badge ? (
            <Badge variant={availability.variant} className="w-fit">
              {availability.text}
            </Badge>
          ) : (
            <VisuallyHidden>{availability.text}</VisuallyHidden>
          )}
          {/* Above the card's link layer, pushed to the row's end. */}
          <div className="relative z-10 ms-auto">
            <CardFavourite card={card} t={t} />
          </div>
        </div>
      </div>
    </article>
  );
}
