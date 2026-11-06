"use client";

import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "./cn";
import { Skeleton } from "./skeleton";
import { focusRing } from "./styles";
import { VisuallyHidden } from "./visually-hidden";

export interface DataTableColumn<Row> {
  id: string;
  /** Header text, from the caller's translations. */
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** `end` for numbers and money. */
  align?: "start" | "end";
}

export interface DataTableProps<Row> {
  /** Names the table for assistive technology; see `captionHidden`. */
  caption: ReactNode;
  captionHidden?: boolean;
  columns: DataTableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Column rendered as the row header (`th scope="row"`). Defaults to the first column. */
  rowHeaderColumnId?: string;
  /** Shown in one row that spans the table when there are no rows and nothing is loading. */
  emptyMessage: ReactNode;
  /** Renders skeleton rows instead of `rows` and the empty message, and sets `aria-busy`. */
  loading?: boolean;
  loadingRowCount?: number;
  /** Spoken while loading (visually hidden). */
  loadingLabel?: ReactNode;
  /** Optional last column, for example row buttons. `header` stays in the table for assistive technology. */
  actions?: { header: ReactNode; render: (row: Row) => ReactNode };
}

/**
 * A short text the app provides once (its own words, for example "Swipe the table sideways to see every column"): the
 * first table of the page shows it above itself on small screens (`isFirstScrollHint`), where a wide table scrolls inside its box and its right part is out of
 * view. `null` (the default): no hint.
 */
export const DataTableScrollHint = createContext<ReactNode>(null);

/** Marks the scroll hint in the page, so only the first one is shown (`isFirstScrollHint`). */
export const SCROLL_HINT_ATTRIBUTE = "data-fk-scroll-hint";

/** The part of a document `isFirstScrollHint` uses, so the rule runs without a DOM in tests. */
export interface ScrollHintRoot {
  querySelector(selector: string): unknown;
}

/**
 * Whether this hint is the first one in the page: a page with several tables (an order: lines, history, payments,
 * shipments) shows the callout once, above the first table, instead of once per table (review m5 of PR 235). The other
 * tables keep the text as their description for assistive technology.
 */
export function isFirstScrollHint(hint: unknown, root: ScrollHintRoot): boolean {
  return root.querySelector(`[${SCROLL_HINT_ATTRIBUTE}]`) === hint;
}

const cellClasses = "px-3 py-2 align-top";
const alignClass = (align: DataTableColumn<unknown>["align"]): string | false =>
  align === "end" && "text-end";

/**
 * Plain, presentational data table: no sorting, no paging, no fetching. The caller owns the data and the state
 * (loading, empty); the borders collapse through Tailwind's preflight. Every row has a row header so a screen reader announces the row's name with each cell.
 */
export function DataTable<Row>({
  caption,
  captionHidden,
  columns,
  rows,
  rowKey,
  rowHeaderColumnId,
  emptyMessage,
  loading = false,
  loadingRowCount = 5,
  loadingLabel,
  actions,
}: DataTableProps<Row>) {
  const rowHeaderId = rowHeaderColumnId ?? columns[0]?.id;
  if (!columns.some((column) => column.id === rowHeaderId)) {
    throw new Error(`DataTable: row header column "${rowHeaderId}" is not one of the columns`);
  }
  const columnCount = columns.length + (actions ? 1 : 0);
  const scrollHint = useContext(DataTableScrollHint);
  const hasHint = scrollHint !== null && scrollHint !== undefined;
  const captionId = useId();
  const hintId = useId();
  const hintRef = useRef<HTMLParagraphElement>(null);
  const [repeated, setRepeated] = useState(false);
  // Decided before the first paint (a layout effect), so a later table's callout never flashes.
  useLayoutEffect(() => {
    const hint = hintRef.current;
    if (hint !== null) setRepeated(!isFirstScrollHint(hint, hint.ownerDocument));
  }, [hasHint]);

  return (
    <div>
      {/* A callout with an arrow, not a grey line: a plain muted sentence under a form's grey notes was read as part of
          them and missed (UX round 2 on the orders list at 390 px). */}
      {hasHint ? (
        <p
          id={hintId}
          ref={hintRef}
          {...{ [SCROLL_HINT_ATTRIBUTE]: "" }}
          className={cn(
            "mb-2 items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm font-medium text-foreground",
            repeated ? "hidden" : "flex md:hidden",
          )}
        >
          <span aria-hidden="true">↔</span>
          {scrollHint}
        </p>
      ) : null}
      {/* `relative`: the containing block of the visually hidden (absolutely positioned) texts, so they scroll with the
          table instead of stretching the page sideways. A focusable region named by the caption, so a keyboard can scroll
          it where the browser does not (Firefox, Safari); it is a Tab stop even when nothing overflows (measuring that
          would need a resize observer in every table). */}
      <div
        role="region"
        tabIndex={0}
        aria-labelledby={captionId}
        aria-describedby={hasHint ? hintId : undefined}
        className={cn("relative overflow-x-auto", focusRing)}
      >
        <table aria-busy={loading || undefined} className="w-full text-start">
          <caption
            id={captionId}
            className={cn(
              captionHidden ? "sr-only" : "pb-2 text-start font-semibold text-foreground",
            )}
          >
            {caption}
          </caption>
          <thead>
            <tr className="bg-muted text-foreground">
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className={cn(
                    cellClasses,
                    "font-semibold",
                    alignClass(column.align) || "text-start",
                  )}
                >
                  {column.header}
                </th>
              ))}
              {actions ? (
                <th scope="col" className={cn(cellClasses, "text-end")}>
                  <VisuallyHidden>{actions.header}</VisuallyHidden>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: loadingRowCount }, (_, rowIndex) => (
                <tr key={rowIndex} className="border-b border-border">
                  {columns.map((column) => {
                    const skeleton = <Skeleton className="h-5 w-full" />;
                    return column.id === rowHeaderId ? (
                      <th key={column.id} scope="row" className={cn(cellClasses, "text-start")}>
                        {rowIndex === 0 && loadingLabel ? (
                          <VisuallyHidden>{loadingLabel}</VisuallyHidden>
                        ) : null}
                        {skeleton}
                      </th>
                    ) : (
                      <td key={column.id} className={cellClasses}>
                        {skeleton}
                      </td>
                    );
                  })}
                  {actions ? (
                    <td className={cellClasses}>
                      <Skeleton className="ms-auto h-5 w-12" />
                    </td>
                  ) : null}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="p-6 text-center text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={rowKey(row)} className="border-b border-border">
                  {columns.map((column) =>
                    column.id === rowHeaderId ? (
                      <th
                        key={column.id}
                        scope="row"
                        className={cn(
                          cellClasses,
                          "font-medium",
                          alignClass(column.align) || "text-start",
                        )}
                      >
                        {column.cell(row)}
                      </th>
                    ) : (
                      <td key={column.id} className={cn(cellClasses, alignClass(column.align))}>
                        {column.cell(row)}
                      </td>
                    ),
                  )}
                  {actions ? (
                    <td className={cn(cellClasses, "text-end")}>{actions.render(row)}</td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
