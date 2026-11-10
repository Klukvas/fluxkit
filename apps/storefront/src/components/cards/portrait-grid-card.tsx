import { Badge, PriceText, textStyles, VisuallyHidden } from "@fluxkit/ui";
import Link from "next/link";
import { StoreImage } from "../store-image";
import { CardBrand, CardFavourite, SaleBadge } from "./fork-card-parts";
import type { CardProps } from "./types";

/**
 * FORK (reshape R1): the `grid` card of this shop (`cards/custom.ts`, `docs/contracts/card-registry.md`). A portrait 4:5
 * picture in a rounded frame that zooms on hover; over the picture the availability badge (top left, exceptions only), the sale
 * badge (top right), the price in a pill (bottom left) and the favourite heart (bottom right); under it the brand in small
 * capitals and the title.
 *
 * The accessibility contract of every card kind is kept: one link to the product (the title, stretched over the card), the
 * brand link and the heart above that layer, the price with its spoken label, availability as a badge only for an exception.
 * The pill and the badges bring their own opaque surface (no text directly on a photo).
 */
export function PortraitGridCard({ card, headingLevel: Heading, eager, t }: CardProps) {
  const { availability } = card;
  return (
    <article className="group relative flex h-full flex-col gap-2 rounded-card focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
      <div className="relative aspect-4/5 overflow-hidden rounded-card bg-muted">
        <StoreImage
          src={card.image.src}
          alt={card.image.alt}
          width={480}
          height={600}
          sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
          eager={eager}
          fill
          className="transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
        {availability !== null && availability.badge ? (
          <Badge
            variant={availability.variant}
            className="pointer-events-none absolute top-2 left-2 w-fit shadow-card"
          >
            {availability.text}
          </Badge>
        ) : null}
        <SaleBadge
          t={t}
          className="pointer-events-none absolute top-2 right-2 w-fit shadow-card"
        />
        <PriceText
          price={card.price}
          priceLabel={card.priceLabel}
          className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-background px-3 py-1 shadow-card"
        />
        {/* Above the card's link layer, and before the brand and title in the focus order, as it comes first on screen. */}
        <div className="absolute right-2 bottom-2 z-10">
          <CardFavourite card={card} t={t} />
        </div>
      </div>
      <CardBrand brand={card.brand} />
      <Heading className={`${textStyles.cardTitle} line-clamp-2`} title={card.title}>
        <Link
          href={card.href}
          className="after:absolute after:inset-0 group-hover:underline group-hover:underline-offset-4 focus-visible:outline-none"
        >
          {card.title}
        </Link>
      </Heading>
      {card.note === null ? null : <p className={textStyles.meta}>{card.note}</p>}
      {availability !== null && !availability.badge ? (
        <VisuallyHidden>{availability.text}</VisuallyHidden>
      ) : null}
    </article>
  );
}
