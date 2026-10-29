/**
 * The personal-data inventory vocabulary (ADR 0033 decisions 2 and 3). Every database column of the Drizzle schema is
 * classified here, so a new column cannot store personal data unnoticed: the guard specs in this folder fail until
 * someone classifies it. Pure data: nothing in this folder reads the database or changes behaviour.
 */

/** `personal` P, `pseudonymous` Q, `staff` S, `secret_hash` H, `free_text` F (plan "Data inventory"). */
export type DataClass =
  "personal" | "pseudonymous" | "staff" | "secret_hash" | "free_text" | "none";

/** `excluded` and `not_applicable` follow the rules in `rules.ts`: a reason for the first, class `none` only for the second. */
export type ExportAction = "included" | "excluded" | "not_applicable";

/**
 * What an erasure of the subject does to the column: the row goes (`delete_row`, `cascade`), the column is made
 * anonymous (`anonymise`, `set_null`, `clear`), stays (`keep`, accounting record or expiring operational data) or is
 * outside the privacy features (`out_of_scope`). `not_applicable` is for class `none` only.
 */
export type ErasureAction =
  | "delete_row"
  | "cascade"
  | "anonymise"
  | "set_null"
  | "clear"
  | "keep"
  | "out_of_scope"
  | "not_applicable";

export interface ColumnEntry {
  readonly class: DataClass;
  /** The row of the plan's data inventory (`D6`, ...), the link to `docs/privacy/data-inventory.md` once it exists. */
  readonly ref: string;
  readonly export: ExportAction;
  readonly erasure: ErasureAction;
  /** Required for `excluded`, `keep` and `out_of_scope`: why the column is treated that way. */
  readonly reason?: string;
}

/** `table name -> column name -> entry`, with the SQL names of the schema. */
export type Inventory = Readonly<Record<string, Readonly<Record<string, ColumnEntry>>>>;

/** A table and its columns as the Drizzle schema declares them. */
export interface SchemaTable {
  readonly name: string;
  readonly columns: readonly string[];
}
