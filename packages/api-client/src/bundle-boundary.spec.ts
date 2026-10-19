import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The storefront imports `createStoreClient` from the package entry. Admin code must not travel with it: the entry
 * re-exports it, so a bundler drops it only because the package is `sideEffects: false` and no store module imports it.
 * `apps/storefront` first-load sizes were compared before and after (package README); this test keeps both conditions.
 */
const srcDir = new URL("./", import.meta.url);
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { sideEffects?: unknown };

const sources = readdirSync(srcDir).filter(
  (file) => file.endsWith(".ts") && !file.endsWith(".spec.ts"),
);

const importsOf = (file: string): string[] =>
  [...readFileSync(new URL(file, srcDir), "utf8").matchAll(/(?:from|import)\s*"(\.[^"]+)"/g)].map(
    (match) => match[1] ?? "",
  );

describe("the admin client stays out of the store client's import graph", () => {
  it("the package declares sideEffects: false", () => {
    expect(packageJson.sideEffects).toBe(false);
  });

  it("no module outside the admin files, except the entry, imports an admin module", () => {
    const offenders = sources
      .filter((file) => !file.startsWith("admin-") && file !== "index.ts")
      .filter((file) => importsOf(file).some((specifier) => specifier.includes("admin-")));
    expect(offenders).toEqual([]);
  });

  it("the admin modules do not import the store client or the store operation table", () => {
    const offenders = sources
      .filter((file) => file.startsWith("admin-"))
      .filter((file) =>
        importsOf(file).some((specifier) => /\/(client|operations)\.js$/.test(specifier)),
      );
    expect(offenders).toEqual([]);
  });

  it("finds the files it is meant to check", () => {
    expect(sources).toEqual(expect.arrayContaining(["client.ts", "admin-client.ts", "index.ts"]));
  });
});
