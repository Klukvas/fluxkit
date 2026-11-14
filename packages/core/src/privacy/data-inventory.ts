/*
 * The personal-data inventory vocabulary and its rules (ADR 0033 decisions 2 and 3). Moved unchanged from
 * `apps/api/src/privacy/inventory/{types,rules}.ts` (ADR 0049) so a feature package can classify its own tables with the
 * same shape (`personalDataInventory`) and check them in its own spec; the API re-exports them under their old names.
 * Pure data and rules: nothing here reads the database or changes behaviour.
 */

/** `personal` P, `pseudonymous` Q, `staff` S, `secret_hash` H, `free_text` F (plan "Data inventory"). */
export type PersonalDataClass =
  "personal" | "pseudonymous" | "staff" | "secret_hash" | "free_text" | "none";

/** `excluded` and `not_applicable` follow the rules of `checkPersonalDataInventory` below: a reason for the first, class `none` only for the second. */
export type PersonalDataExportAction = "included" | "excluded" | "not_applicable";

/**
 * What an erasure of the subject does to the column: the row goes (`delete_row`, `cascade`), the column is made
 * anonymous (`anonymise`, `set_null`, `clear`), stays (`keep`, accounting record or expiring operational data) or is
 * outside the privacy features (`out_of_scope`). `not_applicable` is for class `none` only.
 */
export type PersonalDataErasureAction =
  | "delete_row"
  | "cascade"
  | "anonymise"
  | "set_null"
  | "clear"
  | "keep"
  | "out_of_scope"
  | "not_applicable";

export interface PersonalDataColumnEntry {
  readonly class: PersonalDataClass;
  /** The row of the plan's data inventory (`D6`, ...), the link to `docs/privacy/data-inventory.md` once it exists. */
  readonly ref: string;
  readonly export: PersonalDataExportAction;
  readonly erasure: PersonalDataErasureAction;
  /** Required for `excluded`, `keep` and `out_of_scope`: why the column is treated that way. */
  readonly reason?: string;
}

/** `table name -> column name -> entry`, with the SQL names of the schema. */
export type PersonalDataInventory = Readonly<
  Record<string, Readonly<Record<string, PersonalDataColumnEntry>>>
>;

/** A table and its columns as the Drizzle schema declares them. */
export interface PersonalDataSchemaTable {
  readonly name: string;
  readonly columns: readonly string[];
}

/**
 * Column names that look like personal data. A column with such a name must not be classified `none`: the author either
 * classifies it as personal data or renames it, so a copy-and-paste of the `none` helper cannot hide an address column.
 */
const PERSONAL_LOOKING_NAME =
  /(^|_)(email|phone|first_name|last_name|address|recipient|birth_date|ip_address|user_agent)($|_)/;

function checkEntry(table: string, column: string, entry: PersonalDataColumnEntry): string[] {
  const where = `${table}.${column}`;
  const problems: string[] = [];
  if (entry.ref.trim() === "") problems.push(`${where}: empty ref`);
  if (entry.class === "none") {
    if (entry.export !== "not_applicable" || entry.erasure !== "not_applicable") {
      problems.push(`${where}: class none must have export and erasure not_applicable`);
    }
    if (PERSONAL_LOOKING_NAME.test(column)) {
      problems.push(`${where}: a column named like personal data cannot be class none`);
    }
    return problems;
  }
  if (entry.export === "not_applicable") problems.push(`${where}: no export decision`);
  if (entry.erasure === "not_applicable") problems.push(`${where}: no erasure decision`);
  const needsReason =
    entry.export === "excluded" || entry.erasure === "keep" || entry.erasure === "out_of_scope";
  if (needsReason && (entry.reason ?? "").trim() === "") {
    problems.push(`${where}: export excluded, keep or out_of_scope needs a reason`);
  }
  if (entry.class === "personal" && entry.erasure === "keep") {
    problems.push(`${where}: a personal column cannot be kept`);
  }
  if (entry.class === "secret_hash" && entry.export !== "excluded") {
    problems.push(`${where}: a secret hash must never be exported`);
  }
  return problems;
}

/**
 * Compares the inventory with the schema and checks every entry. Returns one line per problem; empty means the inventory
 * is complete and consistent. The guard specs assert an empty result, and mutate copies of the inventory and the schema to
 * prove each rule fires.
 */
export function checkPersonalDataInventory(
  inventory: PersonalDataInventory,
  schema: readonly PersonalDataSchemaTable[],
): string[] {
  const problems: string[] = [];
  const schemaNames = new Set(schema.map((table) => table.name));
  for (const table of schema) {
    const entries = inventory[table.name];
    if (entries === undefined) {
      problems.push(`${table.name}: table has no inventory entry`);
      continue;
    }
    for (const column of table.columns) {
      const entry = entries[column];
      if (entry === undefined) {
        problems.push(`${table.name}.${column}: column has no inventory entry`);
        continue;
      }
      problems.push(...checkEntry(table.name, column, entry));
    }
    const declared = new Set(table.columns);
    for (const column of Object.keys(entries)) {
      if (!declared.has(column)) {
        problems.push(`${table.name}.${column}: entry for a column that does not exist`);
      }
    }
  }
  for (const name of Object.keys(inventory)) {
    if (!schemaNames.has(name)) problems.push(`${name}: entry for a table that does not exist`);
  }
  return problems;
}
