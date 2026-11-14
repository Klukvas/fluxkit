import { MAX_FEATURE_NAME_LENGTH } from "@fluxkit/config";
import { describe, expect, it } from "vitest";
import { aheadOfJournal, featureMigrationsTable, pendingEntries } from "./migration-journal.js";

describe("migration journal helpers (ADR 0049)", () => {
  it("names a feature's migrations table, a dash written as an underscore", () => {
    expect(featureMigrationsTable("notebook")).toBe("__drizzle_migrations_feature_notebook");
    expect(featureMigrationsTable("gift-cards")).toBe("__drizzle_migrations_feature_gift_cards");
  });

  it("fits the longest allowed name into Postgres's 63-byte identifiers and refuses a longer one", () => {
    const longest = "a".repeat(MAX_FEATURE_NAME_LENGTH);
    expect(Buffer.byteLength(featureMigrationsTable(longest))).toBeLessThanOrEqual(63);
    expect(() => featureMigrationsTable("a".repeat(35))).toThrow(/cannot name a migrations table/);
    expect(() => featureMigrationsTable('x"; drop')).toThrow(/cannot name a migrations table/);
  });

  it("treats entries newer than the newest recorded one as pending, and a newer record as ahead", () => {
    const journal = [
      { tag: "0000_a", when: 10 },
      { tag: "0001_b", when: 20 },
    ];
    expect(pendingEntries(journal, [])).toEqual(journal);
    expect(pendingEntries(journal, [10])).toEqual([{ tag: "0001_b", when: 20 }]);
    expect(aheadOfJournal(journal, [10, 20])).toBeUndefined();
    expect(aheadOfJournal(journal, [10, 30])).toBe(30);
    expect(aheadOfJournal([], [5])).toBe(5);
  });
});
