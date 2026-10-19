import type { FormHTMLAttributes } from "react";
import { cn } from "./cn";

export interface FilterBarProps extends Omit<
  FormHTMLAttributes<HTMLFormElement>,
  "aria-label" | "method"
> {
  /** Accessible name of the form region, for example "Filter orders". */
  label: string;
}

/**
 * Row of filter controls above a list. A labelled `form` (a landmark), not `role="toolbar"`: a toolbar promises arrow-key
 * navigation between its controls, which inputs and selects cannot offer. The method is always `post` (the repository
 * guard: a submit before the script runs must never put field values into the URL); handle `onSubmit` in the app.
 */
export function FilterBar({ label, className, children, ...props }: FilterBarProps) {
  return (
    <form
      aria-label={label}
      method="post"
      className={cn("flex flex-wrap items-end gap-3", className)}
      {...props}
    >
      {children}
    </form>
  );
}
