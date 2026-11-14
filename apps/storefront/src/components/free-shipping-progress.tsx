import type { Cart } from "@fluxkit/api-client";
import type { Locale, Translator } from "@fluxkit/ui";
import { useId } from "react";
import { formatMoney } from "../lib/money";

/** Displays server money only; the native progress element clamps its visual fill. */
export function FreeShippingProgress({
  freeShipping,
  subtotal,
  t,
  locale,
  exponent,
  className = "",
}: {
  freeShipping: Cart["freeShipping"];
  subtotal: Cart["subtotal"];
  t: Translator;
  locale: Locale;
  exponent: number;
  /** Extra layout classes from the host (the cart page limits the width). */
  className?: string;
}) {
  const labelId = useId();
  if (freeShipping === null) {
    return null;
  }
  return (
    <div className={`flex flex-col gap-2 text-sm text-foreground tabular-nums ${className}`}>
      <p id={labelId}>
        {freeShipping.remaining.amount === 0
          ? t("cart.freeShipping.reached")
          : t("cart.freeShipping.remaining", {
              amount: formatMoney(freeShipping.remaining, exponent, locale),
            })}
      </p>
      {freeShipping.threshold.amount === 0 ? null : (
        <progress
          className="fk-progress w-full rounded-control"
          aria-labelledby={labelId}
          value={subtotal.amount}
          max={freeShipping.threshold.amount}
        />
      )}
    </div>
  );
}
