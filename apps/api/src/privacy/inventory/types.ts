/**
 * The personal-data inventory vocabulary (ADR 0033 decisions 2 and 3). Every database column of the Drizzle schema is
 * classified here, so a new column cannot store personal data unnoticed: the guard specs in this folder fail until
 * someone classifies it. Pure data: nothing in this folder reads the database or changes behaviour.
 *
 * The types live in `@fluxkit/core` (ADR 0049: feature packages classify their tables with them); re-exported here under
 * the names this folder has always used.
 */
export type {
  PersonalDataClass as DataClass,
  PersonalDataColumnEntry as ColumnEntry,
  PersonalDataErasureAction as ErasureAction,
  PersonalDataExportAction as ExportAction,
  PersonalDataInventory as Inventory,
  PersonalDataSchemaTable as SchemaTable,
} from "@fluxkit/core";
