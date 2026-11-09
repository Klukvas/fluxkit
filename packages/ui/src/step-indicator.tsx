import { cn } from "./cn";
import { focusRing } from "./styles";

export interface Step {
  label: string;
  /** A link back to a completed step; omit it for the current and later steps (and for steps that cannot be revisited). */
  href?: string;
}

export interface StepIndicatorProps {
  /** Accessible name of the `nav`, for example "Checkout progress". */
  label: string;
  steps: readonly Step[];
  /** Zero-based index of the current step. */
  current: number;
  /** Spoken after a completed step's label, for example "completed". */
  completedLabel: string;
  /** The compact line shown below `md` instead of the list, for example "Step 2 of 3: Checkout". */
  compactText: string;
  className?: string;
}

/**
 * Where the shopper is in a short funnel (cart, checkout, order; review recommendation 3). An ordered list with
 * `aria-current="step"` on the current step and the word for "completed" on earlier ones. Below `md` the list is only for
 * assistive technology and the compact line ("Step 2 of 3: ...") is shown instead (hidden from assistive technology, which
 * reads the list).
 */
export function StepIndicator({
  label,
  steps,
  current,
  completedLabel,
  compactText,
  className,
}: StepIndicatorProps) {
  return (
    <nav aria-label={label} className={className}>
      <p aria-hidden="true" className="text-sm font-medium text-muted-foreground md:hidden">
        {compactText}
      </p>
      <ol className="flex items-center gap-2 text-sm max-md:sr-only">
        {steps.map((step, index) => {
          const state = index < current ? "done" : index === current ? "current" : "next";
          const number = (
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                state === "current"
                  ? "border-primary bg-primary text-primary-foreground"
                  : state === "done"
                    ? "border-primary text-foreground"
                    : "border-border-input text-muted-foreground",
              )}
            >
              {index + 1}
            </span>
          );
          const text = (
            <span
              className={
                state === "current" ? "font-semibold text-foreground" : "text-muted-foreground"
              }
            >
              {step.label}
            </span>
          );
          const done =
            state === "done" ? <span className="sr-only">{` ${completedLabel}`}</span> : null;
          return (
            <li
              key={`${index}-${step.label}`}
              className="flex items-center gap-2"
              {...(state === "current" ? { "aria-current": "step" as const } : {})}
            >
              {state === "done" && step.href ? (
                <>
                  {/* Below `md` the list is only for assistive technology: a link there would be a focus stop nobody sees
                      (review m2 of PR 217, WCAG 2.4.7), so the step is plain text there and a link from `md`. */}
                  <a
                    href={step.href}
                    className={cn(
                      "inline-flex min-h-6 items-center gap-2 rounded-control underline-offset-4 hover:underline max-md:hidden",
                      focusRing,
                    )}
                  >
                    {number}
                    {text}
                    {done}
                  </a>
                  <span className="inline-flex items-center gap-2 md:hidden">
                    {number}
                    {text}
                    {done}
                  </span>
                </>
              ) : (
                <span className="inline-flex items-center gap-2">
                  {number}
                  {text}
                  {done}
                </span>
              )}
              {index < steps.length - 1 ? (
                <span aria-hidden="true" className="h-px w-8 bg-border" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
