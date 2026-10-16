import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/**
 * The journal is append-only (ADR 0011 and 0012). The database trigger rejects an UPDATE or DELETE sent by a client;
 * this spec makes sure no code even tries: no query-builder update/delete on `stockMovement` and no raw statement on
 * `stock_movement` other than reads and inserts. The only delete that reaches the table is the cascade from a deleted
 * variant, which is the database's own business.
 */
describe("stock_movement journal in the application code", () => {
  const production = sourceFiles(SRC).filter(
    (path) => !path.endsWith(".spec.ts") && !relative(SRC, path).startsWith("test/"),
  );

  it("scans the application sources", () => {
    expect(production.length).toBeGreaterThan(50);
    expect(production.some((path) => path.endsWith("inventory.repository.ts"))).toBe(true);
  });

  it("never updates or deletes a stock_movement row", () => {
    const forbidden = [
      /\.\s*update\(\s*stockMovement\b/,
      /\.\s*delete\(\s*stockMovement\b/,
      /\bupdate\s+"?stock_movement"?/i,
      /\bdelete\s+from\s+"?stock_movement"?/i,
      /\btruncate\b[^;]*"?stock_movement"?/i,
    ];
    const offenders = production.flatMap((path) => {
      const text = readFileSync(path, "utf8");
      return forbidden.filter((pattern) => pattern.test(text)).map(() => relative(SRC, path));
    });
    expect(offenders).toEqual([]);
  });

  it("writes the journal in exactly one place, the repository", () => {
    const writers = production.filter((path) =>
      /\.\s*insert\(\s*stockMovement\b/.test(readFileSync(path, "utf8")),
    );
    expect(writers.map((path) => relative(SRC, path))).toEqual([
      "inventory/inventory.repository.ts",
    ]);
  });
});
