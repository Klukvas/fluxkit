import { Badge, PriceText, VisuallyHidden } from "@fluxkit/ui";
import Link from "next/link";
import { allowedImageUrl } from "../lib/image-source";
import { localizedHref } from "../lib/locale-path";
import { cardDisplay, PRODUCT_OFFER, type ProductCardProps } from "./product-card";
import { StoreImage } from "./store-image";
import { focusRing, linkButton } from "./styles";

/**
 * Reshape experiment (client request 2): the horizontal card of the list view. Picture left, brand, title, note and
 * availability in the middle, price and the action on the right (under the text on a phone). Same props and same display
 * rules as `ProductCard` (`cardDisplay`).
 *
 * The action is a LINK to the product page, not an add-to-cart button: a list item (`ProductSummary`) carries no variant id,
 * and adding needs one (cart lines reference `variant_id`, AGENTS.md 2.3). TODO(fluxkit): a real "Add to cart" here needs the
 * default variant id in the list item (API change) and the cart store's client island (`product-purchase.tsx` logic).
 */
export function ProductListCard({
  product,
  locale,
  t,
  exponent,
  imageHosts,
  brandPath,
  headingLevel: Heading,
  eager = false,
  offer = PRODUCT_OFFER,
}: ProductCardProps) {
  const { availability, badgeShown, priceText, href, note } = cardDisplay(
    product,
    offer,
    locale,
    t,
    exponent,
  );
  return (
    <article className="group relative flex gap-4 rounded-lg border border-border bg-background p-3 transition-shadow hover:border-border-input hover:shadow-raised focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring motion-reduce:transition-none">
      <div className="aspect-4/5 w-24 shrink-0 overflow-hidden rounded-md bg-muted sm:w-32">
        <StoreImage
          src={allowedImageUrl(product.image?.url, imageHosts)}
          alt={product.image?.alt ?? product.title}
          width={256}
          height={320}
          sizes="(min-width: 640px) 8rem, 6rem"
          eager={eager}
          fill
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          {product.brand === null ? null : brandPath === null ? (
            <p className="text-xs tracking-wider text-muted-foreground uppercase">
              {product.brand.name}
            </p>
          ) : (
            <Link
              href={localizedHref(locale, brandPath)}
              className={`relative z-10 w-fit rounded-sm text-xs tracking-wider text-muted-foreground uppercase underline-offset-4 hover:text-foreground hover:underline pointer-coarse:pointer-events-none ${focusRing}`}
            >
              {product.brand.name}
            </Link>
          )}
          <Heading className="line-clamp-2 font-medium text-foreground" title={product.title}>
            <Link
              href={href}
              className="after:absolute after:inset-0 group-hover:underline group-hover:underline-offset-4 focus-visible:outline-none"
            >
              {product.title}
            </Link>
          </Heading>
          {note === null ? null : <p className="text-sm text-muted-foreground">{note}</p>}
          {availability === null ? null : badgeShown ? (
            <Badge variant={availability.variant} className="w-fit">
              {t(availability.messageKey)}
            </Badge>
          ) : (
            <VisuallyHidden>{t(availability.messageKey)}</VisuallyHidden>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 sm:flex-col sm:items-end">
          <PriceText price={priceText} priceLabel={t("product.price.label")} />
          {/* Above the title's stretched link, so it is its own target; it leads to the same page. */}
          <Link
            href={href}
            className={`relative z-10 ${linkButton}`}
            tabIndex={-1}
            aria-hidden="true"
          >
            {t("catalog.card.choose")}
          </Link>
        </div>
      </div>
    </article>
  );
}
