import type { ReactNode } from "react";
import { cn } from "./cn";
import { Skeleton } from "./skeleton";
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

  return (
    <div className="overflow-x-auto">
      <table aria-busy={loading || undefined} className="w-full text-start">
        <caption
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
  );
}
