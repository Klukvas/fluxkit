import type { ColumnEntry, DataClass, ErasureAction, ExportAction } from "./types.js";

const NO_PERSONAL_DATA: ColumnEntry = {
  class: "none",
  ref: "D24",
  export: "not_applicable",
  erasure: "not_applicable",
};

/** Columns that hold no personal data (catalog, pricing, inventory, shipping method texts, health, row ids of such tables). */
export function none(ref: string, ...columns: string[]): Record<string, ColumnEntry> {
  return Object.fromEntries(columns.map((name) => [name, { ...NO_PERSONAL_DATA, ref }]));
}

/** One classified column. */
export function classified(
  dataClass: Exclude<DataClass, "none">,
  ref: string,
  exportAction: Exclude<ExportAction, "not_applicable">,
  erasure: Exclude<ErasureAction, "not_applicable">,
  reason?: string,
): ColumnEntry {
  return reason === undefined
    ? { class: dataClass, ref, export: exportAction, erasure }
    : { class: dataClass, ref, export: exportAction, erasure, reason };
}

/** The same classified entry for several columns of one table. */
export function many(entry: ColumnEntry, ...columns: string[]): Record<string, ColumnEntry> {
  return Object.fromEntries(columns.map((name) => [name, entry]));
}
