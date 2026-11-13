import { Badge, PriceText, textStyles, VisuallyHidden } from "@fluxkit/ui";
import Link from "next/link";
import { slots } from "../../config/slots";
import { renderSlot } from "../../lib/slots";
import { StoreImage } from "../store-image";
import { focusRing } from "../styles";
import { CardPurchaseAction } from "./card-purchase";
import type { CardProps } from "./types";

/**
 * The `grid` card kind (the default): one product in a grid of cards. The whole card is one click target (the title link
 * stretches over it); the brand link sits above that layer so it stays separately clickable. Its markup is exactly the
 * product card of before the registry plus the purchase action at the bottom (`registry.spec.tsx` compares them) while the
 * card slots of `config/slots.tsx` are empty: their badges render in a row under the image, their actions in the image's
 * bottom right corner.
 */
export function GridCard({ card, headingLevel: Heading, eager, locale, t }: CardProps) {
  const { availability } = card;
  // The card slots (`config/slots.tsx`). Each takes the place of an element that is always there (the image), so an empty
  // slot adds no child: the same markup and React payload as without slots.
  const slotProps = { card, kind: "grid", locale, t };
  const badges = renderSlot("product-card.badges", slotProps, slots);
  const actions = renderSlot("product-card.actions", slotProps, slots);
  const image = (
    <StoreImage
      src={card.image.src}
      alt={card.image.alt}
      width={480}
      height={480}
      sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
      eager={eager}
    />
  );
  // With actions, the image gets a frame of its own and the actions sit in its bottom right corner: away from the availability
  // badge (top left, core) at every width, above the card's link layer (`z-10`), and before the brand and title in the focus
  // order, as they come first on screen. Without actions the image stays the card's direct child, as before slots.
  const imageBlock =
    actions === null ? (
      image
    ) : (
      <div className="relative flex flex-col">
        {image}
        <div className="absolute right-2 bottom-2 z-10 flex gap-1">{actions}</div>
      </div>
    );
  const availabilityBadge =
    availability !== null && availability.badge ? (
      // Over the image's corner (after the title in reading order): the text column keeps one shape on every card.
      <Badge
        variant={availability.variant}
        className="pointer-events-none absolute top-5 left-5 w-fit shadow-card"
      >
        {availability.text}
      </Badge>
    ) : null;
  return (
    <article className="group relative flex h-full flex-col gap-2 rounded-card border border-border bg-background p-3 transition-shadow hover:border-border-input hover:shadow-raised focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring motion-reduce:transition-none">
      {badges === null ? (
        imageBlock
      ) : (
        <>
          {imageBlock}
          <div className="flex flex-wrap gap-1">{badges}</div>
        </>
      )}
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
      {/* The action's slot has one height in every card of a row, so the prices share one line: room for a label wrapped onto
          two lines in the two-column phone grid (60 px), one line from `md` (44 px). Empty when there is nothing to buy (the
          badge says why). */}
      <div className="flex min-h-11 flex-col">
        <CardPurchaseAction card={card} />
      </div>
      {availabilityBadge}
    </article>
  );
}
