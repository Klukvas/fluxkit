import type { ReactNode } from "react";
import { cn } from "./cn";
import { focusRing, textStyles } from "./styles";

export interface DisclosureProps {
  /** The heading text; it stays a real heading (`headingAs`) inside the summary, so the page outline keeps it. */
  title: ReactNode;
  /** Id of the heading, for `aria-labelledby` of the content. */
  headingId: string;
  headingAs?: "h2" | "h3";
  /** Open on the first render (the default): nothing is hidden before the shopper chooses to. */
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * A collapsible section on native `<details>`: works without a script, Enter/Space on the summary toggle it, and the
 * browser's find-in-page opens it. The chevron is decorative; the state is the summary's expanded state.
 */
export function Disclosure({
  title,
  headingId,
  headingAs: Heading = "h2",
  defaultOpen = true,
  children,
  className,
}: DisclosureProps) {
  return (
    <details open={defaultOpen} className={cn("group border-b border-border", className)}>
      <summary
        className={cn(
          "flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 rounded-md py-2 [&::-webkit-details-marker]:hidden",
          focusRing,
        )}
      >
        <Heading id={headingId} className={textStyles.sectionTitle}>
          {title}
        </Heading>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5 shrink-0 fill-none stroke-current stroke-2 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div role="region" aria-labelledby={headingId} className="pb-6">
        {children}
      </div>
    </details>
  );
}
