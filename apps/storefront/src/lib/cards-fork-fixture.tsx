import { PriceText, textStyles } from "@fluxkit/ui";
import Link from "next/link";
import type { CardProps, CardRegistry } from "../components/cards/types";
import { StoreImage } from "../components/store-image";

/**
 * A FILLED `components/cards/custom.ts` as a client fork would write it (`docs/contracts/card-registry.md`): the `grid` and
 * `list` cards overridden by cards of the fork's own, for `vitest.brand-fork.config.ts` only. That run replaces the real
 * (empty) file with this one and runs the unit suite again, so a spec that pins the template's built-in cards without saying so fails upstream
 * instead of in a fork (A1 acceptance runs, PR-I2b). Specs that pin the built-in cards mock `cards/custom` to the template
 * default (`test-support/template-defaults.ts`).
 */
function ForkPortraitCard({ card, headingLevel: Heading, eager }: CardProps) {
  return (
    <article
      data-fork-card="portrait"
      className="relative flex flex-col gap-2 rounded-card bg-muted p-2"
    >
      <StoreImage
        src={card.image.src}
        alt={card.image.alt}
        width={400}
        height={500}
        sizes="(min-width: 1024px) 33vw, 50vw"
        eager={eager}
      />
      <Heading className={`${textStyles.cardTitle} line-clamp-2`}>
        <Link href={card.href} className="after:absolute after:inset-0">
          {card.title}
        </Link>
      </Heading>
      <PriceText price={card.price} priceLabel={card.priceLabel} />
    </article>
  );
}

/** The fork's `list` card (`?view=list`): a short row with a small picture. */
function ForkRowCard({ card, headingLevel: Heading, eager }: CardProps) {
  return (
    <article
      data-fork-card="row"
      className="relative flex items-center gap-3 border-b border-border py-2"
    >
      <div className="w-16 shrink-0">
        <StoreImage
          src={card.image.src}
          alt={card.image.alt}
          width={64}
          height={64}
          sizes="64px"
          eager={eager}
        />
      </div>
      <Heading className={`${textStyles.cardTitle} min-w-0 flex-1 truncate`}>
        <Link href={card.href} className="after:absolute after:inset-0">
          {card.title}
        </Link>
      </Heading>
      <PriceText price={card.price} priceLabel={card.priceLabel} />
    </article>
  );
}

export const customCards: CardRegistry = {
  grid: {
    Card: ForkPortraitCard,
    listClassName: "grid grid-cols-2 gap-2 lg:grid-cols-3",
    maxEagerImages: 2,
  },
  list: { Card: ForkRowCard, listClassName: "flex flex-col", maxEagerImages: 3 },
};
