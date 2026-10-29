import type { ColumnEntry, Inventory, SchemaTable } from "./types.js";

/**
 * Column names that look like personal data. A column with such a name must not be classified `none`: the author either
 * classifies it as personal data or renames it, so a copy-and-paste of the `none` helper cannot hide an address column.
 */
const PERSONAL_LOOKING_NAME =
  /(^|_)(email|phone|first_name|last_name|address|recipient|birth_date|ip_address|user_agent)($|_)/;

function checkEntry(table: string, column: string, entry: ColumnEntry): string[] {
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
export function checkInventory(inventory: Inventory, schema: readonly SchemaTable[]): string[] {
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
