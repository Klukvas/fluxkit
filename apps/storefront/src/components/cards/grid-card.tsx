import { Badge, PriceText, textStyles, VisuallyHidden } from "@fluxkit/ui";
import Link from "next/link";
import { StoreImage } from "../store-image";
import { focusRing } from "../styles";
import type { CardProps } from "./types";

/**
 * The `grid` card kind (the default): one product in a grid of cards. The whole card is one click target (the title link
 * stretches over it); the brand link sits above that layer so it stays separately clickable. Its markup is exactly the
 * product card of before the registry (`registry.spec.tsx` compares them).
 */
export function GridCard({ card, headingLevel: Heading, eager }: CardProps) {
  const { availability } = card;
  return (
    <article className="group relative flex h-full flex-col gap-2 rounded-card border border-border bg-background p-3 transition-shadow hover:border-border-input hover:shadow-raised focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring motion-reduce:transition-none">
      <StoreImage
        src={card.image.src}
        alt={card.image.alt}
        width={480}
        height={480}
        sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
        eager={eager}
      />
      {card.brand === null ? null : card.brand.href === null ? (
        <p className="text-sm text-muted-foreground">{card.brand.name}</p>
      ) : (
        // A small meta line, not a second button (review D-07). A 24 px target with a mouse; on a touch screen not a target of
        // its own (review N5): a tap there opens the product (the card's link lies under it). Keyboards and screen readers
        // still reach the brand link.
        <Link
          href={card.brand.href}
          className={`relative z-10 inline-flex min-h-6 w-fit items-center rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline pointer-coarse:pointer-events-none ${focusRing}`}
        >
          {card.brand.name}
        </Link>
      )}
      {/* The full title as a tooltip where two lines cut it (review m5 of PR 217); on the heading, not the link, so the
          link's name is not repeated as its description. */}
      <Heading className={`${textStyles.cardTitle} line-clamp-2`} title={card.title}>
        <Link
          href={card.href}
          className="after:absolute after:inset-0 group-hover:underline group-hover:underline-offset-4 focus-visible:outline-none"
        >
          {card.title}
        </Link>
      </Heading>
      {/* Pushed to the bottom: in a row of equal-height cards the prices share one line whatever the titles' length. */}
      <div className="mt-auto flex flex-col gap-1 pt-1">
        {card.note === null ? null : <p className="text-sm text-muted-foreground">{card.note}</p>}
        <PriceText price={card.price} priceLabel={card.priceLabel} />
        {availability !== null && !availability.badge ? (
          <VisuallyHidden>{availability.text}</VisuallyHidden>
        ) : null}
      </div>
      {availability !== null && availability.badge ? (
        // Over the image's corner (after the title in reading order): the text column keeps one shape on every card.
        <Badge
          variant={availability.variant}
          className="pointer-events-none absolute top-5 left-5 w-fit shadow-card"
        >
          {availability.text}
        </Badge>
      ) : null}
    </article>
  );
}
