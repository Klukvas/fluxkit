import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "./cn";
import { controlBase, focusRing } from "./styles";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/** Native select; pass `<option>` children. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, ...props },
  ref,
) {
  return <select ref={ref} className={cn(controlBase, focusRing, className)} {...props} />;
});
