import type { ReactNode } from "react";
import { cn } from "./cn";

export interface LiveRegionProps {
  children?: ReactNode;
  /** Announce only: no visible text. */
  visuallyHidden?: boolean;
}

/**
 * Polite, atomic status region for messages such as "Saved". Render it from the start and change its content
 * later: most screen readers announce changes to a region that was already in the page, not a region that just appeared.
 */
export function LiveRegion({ children, visuallyHidden }: LiveRegionProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(visuallyHidden && "sr-only") || undefined}
    >
      {children}
    </div>
  );
}
