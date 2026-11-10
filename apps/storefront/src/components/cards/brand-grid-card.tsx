import { PriceText, textStyles, VisuallyHidden } from "@fluxkit/ui";
import Link from "next/link";
import { StoreImage } from "../store-image";
import { focusRing } from "../styles";
import { FavouriteButton } from "../favourite-button";
import type { CardProps } from "./types";

/**
 * The fork's `grid` card (registered in `cards/custom.ts`): a portrait 4:5 picture in a rounded frame that zooms on hover, the
 * price in a pill over its bottom left corner, a sale badge in the top right corner, the brand in small capitals above the
 * title, and a favourite heart. Same accessibility contract as the built-in card: one link to the product (the title, stretched
 * over the card), the brand link and the heart above that layer, the price with its spoken label.
 *
 * TODO(fluxkit): the sale badge is a labelled placeholder. The store API's list item has no compare-at price (and so
 * `ProductCardModel` has none), so no real sale can be shown; a real badge needs that field in the API and the model. The card
 * slots (`product-card.badges` / `.actions`) are not rendered: this card draws its own badge and heart.
 */
export function BrandGridCard({ card, headingLevel: Heading, eager, t }: CardProps) {
  const { availability } = card;
  return (
    <article className="group relative flex h-full flex-col gap-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
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
        <span
          data-todo="fluxkit-sale-badge"
          className="pointer-events-none absolute top-3 right-3 rounded-full border border-dashed border-danger bg-background px-3 py-1 text-xs font-semibold text-danger"
        >
          {t("custom.card.sale")}
        </span>
        {availability !== null && availability.badge ? (
          <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-background px-3 py-1 text-xs font-medium text-foreground shadow-card">
            {availability.text}
          </span>
        ) : null}
        <PriceText
          price={card.price}
          priceLabel={card.priceLabel}
          className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-background px-3 py-1 text-sm shadow-card"
        />
        <div className="absolute right-3 bottom-3 z-10">
          <FavouriteButton label={t("custom.card.favourite", { title: card.title })} />
        </div>
      </div>
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
        <Link href={card.href} className="after:absolute after:inset-0 focus-visible:outline-none">
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
