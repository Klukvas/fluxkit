/*
 * The inventory rules live in `@fluxkit/core` (ADR 0049: a feature package checks its own tables with them); re-exported
 * here under the name this folder has always used.
 */
export { checkPersonalDataInventory as checkInventory } from "@fluxkit/core";
