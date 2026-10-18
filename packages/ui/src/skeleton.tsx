import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** Decorative loading placeholder; announce the loading state elsewhere (aria-busy or a Spinner). Size it with className. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)}
      {...props}
    />
  );
}
