import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** Content for assistive technology only. */
export function VisuallyHidden({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("sr-only", className)} {...props} />;
}
