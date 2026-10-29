import { customerTables } from "./tables-customer.js";
import { fulfilmentTables } from "./tables-fulfilment.js";
import { noPersonalDataTables } from "./tables-no-personal-data.js";
import { orderTables } from "./tables-orders.js";
import { privacyTables } from "./tables-privacy.js";
import { staffTables } from "./tables-staff.js";
import type { Inventory } from "./types.js";

export { checkInventory } from "./rules.js";
export { listSchemaTables } from "./schema-tables.js";
export type {
  ColumnEntry,
  DataClass,
  ErasureAction,
  ExportAction,
  Inventory,
  SchemaTable,
} from "./types.js";

/**
 * The personal-data inventory of the core schema (ADR 0033 decision 3). One entry per table and column; the guard specs
 * in this folder fail when the Drizzle schema and this registry disagree.
 */
export const coreInventory: Inventory = {
  ...noPersonalDataTables,
  ...customerTables,
  ...orderTables,
  ...fulfilmentTables,
  ...staffTables,
  ...privacyTables,
};
