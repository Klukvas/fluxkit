import type { ReactNode } from "react";
import { cn } from "./cn";

export interface TrustBarItem {
  /** Stable key of the item (its message key works). */
  key: string;
  /** A decorative icon (`aria-hidden`); the text carries the meaning. */
  icon: ReactNode;
  text: string;
}

export interface TrustBarProps {
  /** Accessible name of the list, for example "Why shop with us". */
  label: string;
  items: readonly TrustBarItem[];
  className?: string;
}

/**
 * Short reassurance lines next to a call to action (delivery, payment, contact): a labelled list of icon + text. Renders
 * nothing without items, so a shop that lists none shows no empty box. Texts come from props (the app's config and
 * messages); this component promises nothing itself.
 */
export function TrustBar({ label, items, className }: TrustBarProps) {
  if (items.length === 0) return null;
  return (
    <ul
      aria-label={label}
      data-trust-bar=""
      className={cn(
        "flex flex-col gap-2 rounded-md border border-border bg-background p-3 text-sm text-foreground",
        className,
      )}
    >
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-flex shrink-0 text-muted-foreground">
            {item.icon}
          </span>
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}
