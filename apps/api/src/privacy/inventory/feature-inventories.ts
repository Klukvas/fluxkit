import { z } from "zod";
import { checkInventory } from "./rules.js";
import type { Inventory } from "./types.js";

/** What the merge reads of a loaded feature (ADR 0049, E3). */
export interface FeatureInventorySource {
  readonly name: string;
  /** The feature's `personalDataInventory` export as loaded; unchecked. */
  readonly personalDataInventory?: unknown;
  /** Present when the feature ships migrations, so it has tables to classify. */
  readonly migrationsFolder?: string;
}

const columnEntrySchema = z
  .object({
    class: z.enum(["personal", "pseudonymous", "staff", "secret_hash", "free_text", "none"]),
    ref: z.string(),
    export: z.enum(["included", "excluded", "not_applicable"]),
    erasure: z.enum([
      "delete_row",
      "cascade",
      "anonymise",
      "set_null",
      "clear",
      "keep",
      "out_of_scope",
      "not_applicable",
    ]),
    reason: z.string().optional(),
  })
  .strict();

const inventorySchema = z.record(z.string(), z.record(z.string(), columnEntrySchema));

/**
 * The core inventory plus the `personalDataInventory` of every enabled feature (ADR 0033 "Feature rule", ADR 0049).
 * Throws, naming the feature, when its export is not an inventory, breaks an entry rule of `checkInventory`, classifies a
 * table that core or another feature already classifies, or is missing while the feature ships migrations (a table
 * nobody classified). Whether every column of the feature's tables is listed is the feature's own spec's job: only
 * the feature knows its Drizzle tables.
 */
export function mergeFeatureInventories(
  core: Inventory,
  features: readonly FeatureInventorySource[],
): Inventory {
  let merged: Inventory = core;
  for (const feature of features) {
    if (feature.personalDataInventory === undefined) {
      if (feature.migrationsFolder !== undefined) {
        throw new Error(
          `Feature "${feature.name}" ships migrations but exports no personalDataInventory (ADR 0033, docs/contracts/features.md).`,
        );
      }
      continue;
    }
    const parsed = inventorySchema.safeParse(feature.personalDataInventory);
    if (!parsed.success) {
      throw new Error(
        `Feature "${feature.name}": personalDataInventory is not an inventory: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    const inventory: Inventory = parsed.data;
    // The feature's own tables and columns as it lists them: checks every entry's rules, not completeness.
    const listed = Object.entries(inventory).map(([name, columns]) => ({
      name,
      columns: Object.keys(columns),
    }));
    const problems = checkInventory(inventory, listed);
    const clashes = Object.keys(inventory).filter((table) => table in merged);
    if (clashes.length > 0) {
      problems.push(...clashes.map((table) => `${table}: already classified by core or a feature`));
    }
    if (problems.length > 0) {
      throw new Error(
        `Feature "${feature.name}": personalDataInventory is invalid: ${problems.join("; ")}`,
      );
    }
    merged = { ...merged, ...inventory };
  }
  return merged;
}
