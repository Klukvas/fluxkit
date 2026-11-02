import { StepIndicator, type Locale, type Translator } from "@fluxkit/ui";
import { localizedHref } from "../lib/locale-path";

export const FUNNEL_STEPS = ["cart", "checkout", "order"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/**
 * The three steps of buying (review recommendation 3): cart, checkout, order. The checkout links back to the cart; the order
 * page links nowhere (the order is placed, the cart is empty). Pure: the page says which step it is.
 */
export function CheckoutSteps({
  t,
  locale,
  current,
  className,
}: {
  t: Translator;
  locale: Locale;
  current: FunnelStep;
  className?: string;
}) {
  const index = FUNNEL_STEPS.indexOf(current);
  const labels = FUNNEL_STEPS.map((step) => t(`funnel.${step}`));
  return (
    <StepIndicator
      label={t("funnel.label")}
      className={className}
      current={index}
      completedLabel={t("funnel.completed")}
      compactText={t("funnel.compact", {
        step: index + 1,
        total: FUNNEL_STEPS.length,
        label: labels[index] as string,
      })}
      steps={FUNNEL_STEPS.map((step, position) => ({
        label: labels[position] as string,
        ...(step === "cart" && current === "checkout"
          ? { href: localizedHref(locale, "/cart") }
          : {}),
      }))}
    />
  );
}
