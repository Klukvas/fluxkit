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
                // At least 24 px high (WCAG 2.5.8), 44 px on a touch screen (review A-02).
                <a
                  href={item.href}
                  className={cn(
                    "inline-flex min-h-6 items-center underline pointer-coarse:min-h-11",
                    focusRing,
                  )}
                >
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
