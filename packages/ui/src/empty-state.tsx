import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  headingAs?: "h2" | "h3";
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  headingAs: Heading = "h2",
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-2 p-8 text-center", className)}>
      <Heading className="text-lg font-semibold text-foreground">{title}</Heading>
      {description ? <p className="text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
