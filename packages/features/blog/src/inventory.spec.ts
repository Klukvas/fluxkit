import { checkPersonalDataInventory } from "@fluxkit/core";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as entry from "./index.js";
import { blogPost } from "./schema.js";

const TABLES = [blogPost];

function schemaTables() {
  return TABLES.map((table) => ({
    name: getTableName(table),
    columns: Object.values(getTableColumns(table)).map((column) => column.name),
  }));
}

/* ADR 0049, E3: every column of the blog's Drizzle tables is classified, and the package entry exports the inventory. */
describe("the blog's personal-data inventory", () => {
  it("classifies every column of every blog table, with no entry left over", () => {
    expect(checkPersonalDataInventory(entry.personalDataInventory, schemaTables())).toEqual([]);
  });

  it("holds no personal data: every column is class none", () => {
    const classes = Object.values(entry.personalDataInventory).flatMap((columns) =>
      Object.values(columns).map((column) => column.class),
    );
    expect(classes.length).toBe(13);
    expect(new Set(classes)).toEqual(new Set(["none"]));
  });

  it("is a real check: a missing column and a stray entry are reported", () => {
    const rest = Object.fromEntries(
      Object.entries(entry.personalDataInventory["blog_post"] ?? {}).filter(
        ([column]) => column !== "cover_alt",
      ),
    );
    expect(checkPersonalDataInventory({ blog_post: rest }, schemaTables())).toEqual([
      "blog_post.cover_alt: column has no inventory entry",
    ]);
    const idEntry = rest["id"];
    if (idEntry === undefined) throw new Error("The inventory has no id entry.");
    const stray = { blog_post: { ...rest, cover_alt: idEntry, author: idEntry } };
    expect(checkPersonalDataInventory(stray, schemaTables())).toEqual([
      "blog_post.author: entry for a column that does not exist",
    ]);
  });

  it("is exported from the package entry next to featureModule", () => {
    expect(entry.featureModule).toBe(entry.BlogFeatureModule);
    expect(Object.keys(entry.personalDataInventory)).toEqual(["blog_post"]);
  });
});
