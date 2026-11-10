import { PriceText, textStyles, VisuallyHidden } from "@fluxkit/ui";
import Link from "next/link";
import { FavouriteButton } from "../favourite-button";
import { StoreImage } from "../store-image";
import { focusRing } from "../styles";
import type { CardProps } from "./types";

/**
 * The fork's `list` card (`?view=list`, registered in `cards/custom.ts`): one product per row, a 4:5 picture in a rounded frame
 * on the left, and beside it the brand in small capitals, the title, the note, the price and the favourite heart. The switch
 * between the grid and this list is the template's `ViewToggle` (`?view=list`); nothing of it is the fork's. Same accessibility
 * contract as the grid card: one link to the product (the title, stretched over the card), the brand link and the heart above
 * that layer.
 *
 * TODO(fluxkit): like the grid card, no sale badge: the API's list item has no compare-at price (see `brand-grid-card.tsx`).
 */
export function BrandListCard({ card, headingLevel: Heading, eager, t }: CardProps) {
  const { availability } = card;
  return (
    <article className="group relative flex gap-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
      <div className="relative aspect-4/5 w-28 shrink-0 overflow-hidden rounded-card bg-muted sm:w-40">
        <StoreImage
          src={card.image.src}
          alt={card.image.alt}
          width={160}
          height={200}
          sizes="(min-width: 640px) 160px, 112px"
          eager={eager}
          fill
          className="transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
        {card.brand === null ? null : card.brand.href === null ? (
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {card.brand.name}
          </p>
        ) : (
          <Link
            href={card.brand.href}
            className={`relative z-10 inline-flex min-h-6 w-fit items-center text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground hover:underline pointer-coarse:pointer-events-none ${focusRing}`}
          >
            {card.brand.name}
          </Link>
        )}
        <Heading className={`${textStyles.cardTitle} line-clamp-2`} title={card.title}>
          <Link
            href={card.href}
            className="after:absolute after:inset-0 focus-visible:outline-none"
          >
            {card.title}
          </Link>
        </Heading>
        {card.note === null ? null : <p className="text-sm text-muted-foreground">{card.note}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          <PriceText
            price={card.price}
            priceLabel={card.priceLabel}
            className="rounded-full bg-muted px-3 py-1 text-sm"
          />
          {availability === null ? null : availability.badge ? (
            <span className="rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground">
              {availability.text}
            </span>
          ) : (
            <VisuallyHidden>{availability.text}</VisuallyHidden>
          )}
          <div className="relative z-10 ms-auto">
            <FavouriteButton label={t("custom.card.favourite", { title: card.title })} />
          </div>
        </div>
      </div>
    </article>
  );
}
