import { Badge, textStyles, VisuallyHidden } from "@fluxkit/ui";
import Link from "next/link";
import { slots } from "../../config/slots";
import { renderSlot } from "../../lib/slots";
import { StoreImage } from "../store-image";
import { focusRing } from "../styles";
import type { CardProps } from "./types";

/**
 * FORK card (registered as `grid` in `cards/custom.ts`): a portrait 4:5 image in a rounded frame that zooms on hover, the
 * price in a pill over the image's bottom left corner, the brand in small capitals above the title, the availability badge in
 * the top left corner and the card actions (`product-card.actions`, the favourite heart) in the top right corner.
 *
 * TODO(fluxkit): the "sale" badge (top right) is not shown: the list item (`ProductSummary`) and `ProductCardModel` carry no
 * compare-at price, so a card cannot know that a product is on sale. It needs the API list item and `cardDisplay` to expose it.
 *
 * Same accessibility contract as the built-in cards: one link to the product (the title, stretched over the card), the brand
 * link above that layer, the price with its spoken label, availability as a badge only for an exception.
 */
export function PortraitCard({ card, headingLevel: Heading, eager, locale, t }: CardProps) {
  const { availability } = card;
  const slotProps = { card, kind: "grid", locale, t };
  const badges = renderSlot("product-card.badges", slotProps, slots);
  const actions = renderSlot("product-card.actions", slotProps, slots);
  return (
    <article className="group relative flex h-full flex-col gap-2 rounded-card focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-ring">
      <div className="relative aspect-4/5 overflow-hidden rounded-card bg-muted">
        <StoreImage
          src={card.image.src}
          alt={card.image.alt}
          width={480}
          height={600}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          eager={eager}
          fill
          className="transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
        <p className="pointer-events-none absolute bottom-3 left-3 inline-flex items-center rounded-full bg-background px-3 py-1 text-sm font-medium text-foreground shadow-card">
          <VisuallyHidden>{card.priceLabel} </VisuallyHidden>
          {card.price}
        </p>
        {availability !== null && availability.badge ? (
          <Badge
            variant={availability.variant}
            className="pointer-events-none absolute top-3 left-3 w-fit shadow-card"
          >
            {availability.text}
          </Badge>
        ) : null}
        {actions === null ? null : (
          <div className="absolute top-2 right-2 z-10 flex gap-1">{actions}</div>
        )}
      </div>
      {badges === null ? null : <div className="flex flex-wrap gap-1">{badges}</div>}
      {card.brand === null ? null : card.brand.href === null ? (
        <p className="text-xs tracking-wide text-muted-foreground uppercase">{card.brand.name}</p>
      ) : (
        <Link
          href={card.brand.href}
          className={`relative z-10 inline-flex min-h-6 w-fit items-center rounded-control text-xs tracking-wide text-muted-foreground uppercase underline-offset-4 hover:text-foreground hover:underline pointer-coarse:pointer-events-none ${focusRing}`}
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
      {availability !== null && !availability.badge ? (
        <VisuallyHidden>{availability.text}</VisuallyHidden>
      ) : null}
    </article>
  );
}
