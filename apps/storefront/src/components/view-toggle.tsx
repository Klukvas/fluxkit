import { cn, type Translator } from "@fluxkit/ui";
import { CARD_VIEWS, type CardView } from "../lib/card-view";
import { focusRing } from "./styles";

/**
 * The list/grid switch of a product list (plan 2026-11-08-design-changeability.md, L2/L5; owner decision 2026-11-08: shipped,
 * grid by default). Server markup: a labelled group of two plain links to the same address with `?view=` changed, so it
 * works without scripts; the current view is marked `aria-current` (a link to a state, not a toggle button). 44 px targets;
 * `className` places it in the caller's toolbar.
 */
export function ViewToggle({
  t,
  view,
  hrefFor,
  className,
}: {
  t: Translator;
  view: CardView;
  /** The localized address of this list shown as `view` (filters, sort and page kept). */
  hrefFor: (view: CardView) => string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={t("catalog.view.label")} className={cn("flex gap-1", className)}>
      {CARD_VIEWS.map((option) => (
        <a
          key={option}
          href={hrefFor(option)}
          aria-current={option === view ? "true" : undefined}
          className={`inline-flex min-h-11 items-center rounded-control px-3 text-sm ${
            option === view
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground hover:underline"
          } ${focusRing}`}
        >
          {t(`catalog.view.${option}`)}
        </a>
      ))}
    </div>
  );
}
