import type { FormHTMLAttributes } from "react";
import { cn } from "./cn";

export interface FilterBarProps extends Omit<FormHTMLAttributes<HTMLFormElement>, "aria-label"> {
  /** Accessible name of the form region, for example "Filter orders". */
  label: string;
}

/**
 * Row of filter controls above a list. A labelled `form` (a landmark), not `role="toolbar"`: a toolbar promises arrow-key
 * navigation between its controls, which inputs and selects cannot offer. The default method is `get` (a filter is
 * not a secret); pass `onSubmit` to handle it in the app.
 */
export function FilterBar({
  label,
  className,
  method = "get",
  children,
  ...props
}: FilterBarProps) {
  return (
    <form
      aria-label={label}
      method={method}
      className={cn("flex flex-wrap items-end gap-3", className)}
      {...props}
    >
      {children}
    </form>
  );
}
