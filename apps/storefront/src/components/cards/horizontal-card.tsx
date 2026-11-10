import { Badge, textStyles, VisuallyHidden } from "@fluxkit/ui";
import Link from "next/link";
import { slots } from "../../config/slots";
import { renderSlot } from "../../lib/slots";
import { StoreImage } from "../store-image";
import { focusRing } from "../styles";
import type { CardProps } from "./types";

/**
 * FORK card (registered as `list` in `cards/custom.ts`, shown with `?view=list`): the horizontal companion of `PortraitCard`.
 * A rounded 4:5 image on the start side (zooms on hover), then the brand in small capitals, the title, the note and a row
 * with the price pill, the availability and the card actions (the favourite heart) at its end.
 *
 * TODO(fluxkit): no "sale" badge, as on the portrait card: the card model carries no compare-at price.
 */
export function HorizontalCard({ card, headingLevel: Heading, eager, locale, t }: CardProps) {
  const { availability } = card;
  const slotProps = { card, kind: "list", locale, t };
  const badges = renderSlot("product-card.badges", slotProps, slots);
  const actions = renderSlot("product-card.actions", slotProps, slots);
  return (
    <article className="group relative flex gap-4 rounded-card border border-border bg-background p-3 transition-shadow hover:shadow-raised focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring motion-reduce:transition-none sm:gap-6">
      <div className="relative aspect-4/5 w-28 shrink-0 overflow-hidden rounded-card bg-muted sm:w-44">
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
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
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
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-sm font-medium text-foreground">
            <VisuallyHidden>{card.priceLabel} </VisuallyHidden>
            {card.price}
          </p>
          {availability === null ? null : availability.badge ? (
            <Badge variant={availability.variant} className="w-fit">
              {availability.text}
            </Badge>
          ) : (
            <VisuallyHidden>{availability.text}</VisuallyHidden>
          )}
          {actions === null ? null : (
            <div className="relative z-10 ms-auto flex gap-1">{actions}</div>
          )}
        </div>
      </div>
    </article>
  );
}
