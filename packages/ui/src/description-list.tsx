import type { ReactNode } from "react";
import { cn } from "./cn";

export interface DescriptionListItem {
  id: string;
  term: ReactNode;
  description: ReactNode;
}

export interface DescriptionListProps {
  items: DescriptionListItem[];
  className?: string;
}

/** Read-only facts as term and description pairs (`dl`), for example the fields of a customer or an order. */
export function DescriptionList({ items, className }: DescriptionListProps) {
  return (
    <dl className={cn("flex flex-col gap-3", className)}>
      {items.map((item) => (
        <div key={item.id} className="flex flex-col gap-1 sm:flex-row sm:gap-6">
          <dt className="font-medium text-muted-foreground sm:w-48 sm:shrink-0">{item.term}</dt>
          <dd className="text-foreground">{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}
