import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { focusRing } from "./styles";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  /** The label (the hit area) takes the whole row, not only the text's width (a list of filter values on a phone). */
  fullWidth?: boolean;
}

/** The label wraps the input (and `htmlFor` repeats the link when an `id` is given). */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, id, className, fullWidth = false, ...props },
  ref,
) {
  return (
    <label
      htmlFor={id}
      className={cn(
        fullWidth ? "flex w-full" : "inline-flex",
        "min-h-11 items-center gap-2 text-foreground",
      )}
    >
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className={cn(
          "size-5 rounded-sm border border-border-input accent-primary",
          focusRing,
          className,
        )}
        {...props}
      />
      <span>{label}</span>
    </label>
  );
});
