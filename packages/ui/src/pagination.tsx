import { cn } from "./cn";
import { focusRing } from "./styles";

export interface PaginationProps {
  /** Accessible name of the nav landmark. */
  label: string;
  currentPage: number;
  pageCount: number;
  hrefForPage: (page: number) => string;
  previousLabel: string;
  nextLabel: string;
  /** Accessible name of one page link, for example "Page 3". */
  pageLabel: (page: number) => string;
}

/** Page numbers to show: first, last and the neighbors of the current page, with "gap" where pages are skipped. */
export function pageItems(currentPage: number, pageCount: number): (number | "gap")[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const wanted = [...new Set([1, currentPage - 1, currentPage, currentPage + 1, pageCount])]
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  let previous = 0;
  for (const page of wanted) {
    if (page - previous === 2) {
      items.push(previous + 1);
    } else if (page - previous > 2) {
      items.push("gap");
    }
    items.push(page);
    previous = page;
  }
  return items;
}

const itemClasses = cn(
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border px-3 text-foreground",
  focusRing,
);

export function Pagination({
  label,
  currentPage,
  pageCount,
  hrefForPage,
  previousLabel,
  nextLabel,
  pageLabel,
}: PaginationProps) {
  if (pageCount <= 1) {
    return null;
  }
  const hasPrevious = currentPage > 1;
  const hasNext = currentPage < pageCount;
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap items-center gap-2">
        <li>
          {hasPrevious ? (
            <a href={hrefForPage(currentPage - 1)} rel="prev" className={itemClasses}>
              {previousLabel}
            </a>
          ) : (
            <span aria-disabled="true" className={cn(itemClasses, "opacity-50")}>
              {previousLabel}
            </span>
          )}
        </li>
        {pageItems(currentPage, pageCount).map((item, index) =>
          item === "gap" ? (
            <li key={`gap-${index}`} aria-hidden="true">
              <span className="px-1 text-muted-foreground">&hellip;</span>
            </li>
          ) : (
            <li key={item}>
              <a
                href={hrefForPage(item)}
                aria-label={pageLabel(item)}
                aria-current={item === currentPage ? "page" : undefined}
                className={cn(
                  itemClasses,
                  item === currentPage && "bg-primary text-primary-foreground",
                )}
              >
                {item}
              </a>
            </li>
          ),
        )}
        <li>
          {hasNext ? (
            <a href={hrefForPage(currentPage + 1)} rel="next" className={itemClasses}>
              {nextLabel}
            </a>
          ) : (
            <span aria-disabled="true" className={cn(itemClasses, "opacity-50")}>
              {nextLabel}
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
