import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../database/schema/index.js";
import type { SchemaTable } from "./types.js";

/** Every table of the Drizzle schema with its SQL column names, sorted by table name. */
export function listSchemaTables(): SchemaTable[] {
  const exports: unknown[] = Object.values(schema);
  return exports
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => {
      const config = getTableConfig(table);
      return { name: config.name, columns: config.columns.map((column) => column.name) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
