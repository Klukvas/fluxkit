import { focusRing } from "./styles";
import { cn } from "./cn";

export interface BreadcrumbItem {
  label: string;
  /** Omit on the last item: it is the current page. */
  href?: string;
}

export interface BreadcrumbsProps {
  /** Accessible name of the nav landmark. */
  label: string;
  items: BreadcrumbItem[];
}

export function Breadcrumbs({ label, items }: BreadcrumbsProps) {
  if (items.length === 0) {
    return null;
  }
  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;
          return (
            <li key={`${index}-${item.label}`} className="inline-flex items-center gap-2">
              {isCurrent || !item.href ? (
                <span aria-current={isCurrent ? "page" : undefined} className="text-foreground">
                  {item.label}
                </span>
              ) : (
                <a href={item.href} className={cn("underline", focusRing)}>
                  {item.label}
                </a>
              )}
              {isCurrent ? null : <span aria-hidden="true">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
