import type { ReactNode } from "react";
import { focusRing } from "./styles";
import { cn } from "./cn";

export interface SkipLinkProps {
  /** Id of the main content element, without "#". */
  targetId: string;
  children: ReactNode;
}

/** First focusable element of the page; visible only while focused. */
export function SkipLink({ targetId, children }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className={cn(
        "sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground",
        focusRing,
      )}
    >
      {children}
    </a>
  );
}
