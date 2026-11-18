import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the no-network guard is active in every spec file", () => {
  it("has replaced globalThis.fetch before this file ran", () => {
    expect(Reflect.get(globalThis.fetch, Symbol.for("fluxkit.no-network-guard"))).toBe(true);
  });

  it("is named in the package vitest setup files", () => {
    const config = readFileSync(new URL("../vitest.config.ts", import.meta.url), "utf8");
    expect(config).toMatch(/setupFiles:\s*\[\s*"src\/test-support\/no-network\.ts"\s*\]/);
  });
});
