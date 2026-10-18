import { cn } from "./cn";
import { VisuallyHidden } from "./visually-hidden";

interface PriceTextBase {
  /** Preformatted price (money formatting is the caller's job). */
  price: string;
  /** Spoken before the price, for example "Now". */
  priceLabel?: string;
  className?: string;
}

export type PriceTextProps = PriceTextBase &
  (
    | { compareAt?: undefined; compareAtLabel?: undefined }
    // A struck-through price without spoken text would be read as two unrelated prices.
    | { compareAt: string; compareAtLabel: string }
  );

export function PriceText({
  price,
  priceLabel,
  compareAt,
  compareAtLabel,
  className,
}: PriceTextProps) {
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-2", className)}>
      {priceLabel ? <VisuallyHidden>{priceLabel}</VisuallyHidden> : null}
      <span className="font-semibold text-foreground">{price}</span>
      {compareAt ? (
        <>
          <VisuallyHidden>{compareAtLabel}</VisuallyHidden>
          <s className="text-muted-foreground">{compareAt}</s>
        </>
      ) : null}
    </span>
  );
}
