import { cn } from "./cn";
import { VisuallyHidden } from "./visually-hidden";

/** A discount cue next to a struck-through price: the visible badge text and what assistive technology reads instead. */
export interface PriceDiscount {
  /** Preformatted badge text, for example "−22 %". */
  text: string;
  /** Spoken text, for example "Save 22 %" (a screen reader would otherwise read "minus 22"). */
  label: string;
}

interface PriceTextBase {
  /** Preformatted price (money formatting is the caller's job). */
  price: string;
  /** Spoken before the price, for example "Now". */
  priceLabel?: string;
  className?: string;
}

export type PriceTextProps = PriceTextBase &
  (
    | { compareAt?: undefined; compareAtLabel?: undefined; discount?: undefined }
    // A struck-through price without spoken text would be read as two unrelated prices. A discount exists only with one.
    | { compareAt: string; compareAtLabel: string; discount?: PriceDiscount | null }
  );

/**
 * One price, optionally with the struck-through compare-at price and a discount badge (review D-08). It formats and computes
 * nothing: the caller passes the texts (the percentage rule lives with the caller's money code).
 */
export function PriceText({
  price,
  priceLabel,
  compareAt,
  compareAtLabel,
  discount,
  className,
}: PriceTextProps) {
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2 gap-y-1", className)}>
      {priceLabel ? <VisuallyHidden>{priceLabel}</VisuallyHidden> : null}
      <span className="font-semibold whitespace-nowrap text-foreground tabular-nums">{price}</span>
      {compareAt ? (
        <>
          <VisuallyHidden>{compareAtLabel}</VisuallyHidden>
          <s className="whitespace-nowrap text-muted-foreground tabular-nums">{compareAt}</s>
        </>
      ) : null}
      {discount ? (
        <>
          <span
            aria-hidden="true"
            className="self-center rounded-sm bg-danger px-1.5 text-sm font-semibold whitespace-nowrap text-danger-foreground"
          >
            {discount.text}
          </span>
          <VisuallyHidden>{discount.label}</VisuallyHidden>
        </>
      ) : null}
    </span>
  );
}
