import { describe, expect, it } from "vitest";
import { none } from "./builders.js";
import { mergeFeatureInventories } from "./feature-inventories.js";
import { coreInventory } from "./index.js";

const notes = { fixture_note: none("FIXTURE", "id", "title") };

describe("mergeFeatureInventories (ADR 0033 feature rule, ADR 0049 E3)", () => {
  it("adds an enabled feature's tables to the core inventory, leaving core unchanged", () => {
    const merged = mergeFeatureInventories(coreInventory, [
      { name: "notebook", personalDataInventory: notes, migrationsFolder: "/x/drizzle" },
    ]);
    expect(merged["fixture_note"]).toEqual(notes.fixture_note);
    expect(merged["customer"]).toBe(coreInventory["customer"]);
    expect(coreInventory["fixture_note"]).toBeUndefined();
  });

  it("returns core as is without features, or with a feature that has neither tables nor inventory", () => {
    expect(mergeFeatureInventories(coreInventory, [])).toBe(coreInventory);
    expect(mergeFeatureInventories(coreInventory, [{ name: "sample" }])).toBe(coreInventory);
  });

  it("refuses a feature that ships migrations but exports no inventory", () => {
    expect(() =>
      mergeFeatureInventories(coreInventory, [{ name: "notebook", migrationsFolder: "/x" }]),
    ).toThrow(/Feature "notebook" ships migrations but exports no personalDataInventory/);
  });

  it("refuses an export that is not an inventory, naming the feature and the place", () => {
    expect(() =>
      mergeFeatureInventories(coreInventory, [
        { name: "bad", personalDataInventory: { t: { c: { class: "secret", ref: "R" } } } },
      ]),
    ).toThrow(/Feature "bad": personalDataInventory is not an inventory: t\.c\.class/);
    expect(() =>
      mergeFeatureInventories(coreInventory, [{ name: "bad", personalDataInventory: [] }]),
    ).toThrow(/Feature "bad"/);
  });

  it("applies the entry rules of the core inventory", () => {
    expect(() =>
      mergeFeatureInventories(coreInventory, [
        { name: "leaky", personalDataInventory: { post: none("X", "author_email") } },
      ]),
    ).toThrow(/post\.author_email: a column named like personal data cannot be class none/);
  });

  it("refuses a table that core or another enabled feature already classifies", () => {
    expect(() =>
      mergeFeatureInventories(coreInventory, [
        { name: "thief", personalDataInventory: { customer: none("X", "id") } },
      ]),
    ).toThrow(/customer: already classified by core or a feature/);
    expect(() =>
      mergeFeatureInventories(coreInventory, [
        { name: "one", personalDataInventory: notes },
        { name: "two", personalDataInventory: notes },
      ]),
    ).toThrow(/Feature "two".*fixture_note: already classified/);
  });
});
