import { describe, expect, it } from "vitest";
import { DEFAULT_MEDIA_MAX_BYTES, DEFAULT_MEDIA_MAX_PIXELS, loadEnv } from "@fluxkit/config";
import { MEDIA_LIMITS } from "@fluxkit/core";

/*
 * `@fluxkit/core` and `@fluxkit/config` do not depend on each other, so each states the media byte and pixel limits. This
 * spec lives in the API, which imports both, and fails when they drift apart (ADR 0028 decision 8).
 */
const BASE = { DATABASE_URL: "postgres://parity-spec" };

function accepts(name: "MEDIA_MAX_BYTES" | "MEDIA_MAX_PIXELS", value: number): boolean {
  try {
    loadEnv({ ...BASE, [name]: String(value) });
    return true;
  } catch {
    return false;
  }
}

describe("MEDIA_LIMITS (core) equals the MEDIA_* bounds of loadEnv (config)", () => {
  it("has the same defaults", () => {
    expect(DEFAULT_MEDIA_MAX_BYTES).toBe(MEDIA_LIMITS.maxBytes.default);
    expect(DEFAULT_MEDIA_MAX_PIXELS).toBe(MEDIA_LIMITS.maxPixels.default);
    const env = loadEnv(BASE);
    expect(env.mediaMaxBytes).toBe(MEDIA_LIMITS.maxBytes.default);
    expect(env.mediaMaxPixels).toBe(MEDIA_LIMITS.maxPixels.default);
  });

  it.each([
    ["MEDIA_MAX_BYTES", MEDIA_LIMITS.maxBytes],
    ["MEDIA_MAX_PIXELS", MEDIA_LIMITS.maxPixels],
  ] as const)("%s accepts exactly the core bounds", (name, bounds) => {
    expect(accepts(name, bounds.min)).toBe(true);
    expect(accepts(name, bounds.max)).toBe(true);
    expect(accepts(name, bounds.min - 1)).toBe(false);
    expect(accepts(name, bounds.max + 1)).toBe(false);
  });
});
