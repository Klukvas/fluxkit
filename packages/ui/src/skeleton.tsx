import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** Decorative loading placeholder; announce the loading state elsewhere (aria-busy or a Spinner). Size it with className. */
export function Skeleton({
  className,
  variant = "pulse",
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: "pulse" | "shimmer" }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        variant === "pulse"
          ? "animate-pulse rounded-media bg-muted motion-reduce:animate-none"
          : "fk-skeleton-shimmer relative overflow-hidden rounded-media bg-muted motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}
