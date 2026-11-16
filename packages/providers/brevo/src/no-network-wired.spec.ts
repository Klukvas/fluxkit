import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * The no-network guard must be wired for EVERY spec file (vitest `setupFiles`), not only for the guard's own spec, which
 * imports the module and so installs it itself. This file deliberately does not import the guard: it only sees it when the
 * setup file ran (review finding 5, mutation M1).
 */
describe("the no-network guard is active in every spec file", () => {
  it("has replaced globalThis.fetch before this file ran", () => {
    expect(Reflect.get(globalThis.fetch, Symbol.for("fluxkit.no-network-guard"))).toBe(true);
  });

  it("is named in the package's vitest setup files", () => {
    const config = readFileSync(new URL("../vitest.config.ts", import.meta.url), "utf8");
    expect(config).toMatch(/setupFiles:\s*\[\s*"src\/test-support\/no-network\.ts"\s*\]/);
  });
});
