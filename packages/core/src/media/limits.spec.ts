import { describe, expect, it } from "vitest";
import { checkDimensions, MEDIA_LIMITS } from "./limits.js";

const limits = { maxPixels: 50_000_000, maxSide: 12_000 };

describe("MEDIA_LIMITS (ADR 0028 decision 3)", () => {
  it("holds the documented numbers", () => {
    expect(MEDIA_LIMITS.maxBytes).toEqual({
      default: 10 * 1024 * 1024,
      min: 1024,
      max: 50 * 1024 * 1024,
    });
    expect(MEDIA_LIMITS.maxPixels).toEqual({ default: 50_000_000, min: 1, max: 100_000_000 });
    expect(MEDIA_LIMITS.maxSide).toBe(12_000);
    expect(MEDIA_LIMITS.outputMaxSide).toBe(4_096);
  });

  it("is deeply frozen", () => {
    expect(Object.isFrozen(MEDIA_LIMITS)).toBe(true);
    expect(Object.isFrozen(MEDIA_LIMITS.maxBytes)).toBe(true);
    expect(Object.isFrozen(MEDIA_LIMITS.maxPixels)).toBe(true);
  });

  it("keeps each default inside its own bounds", () => {
    for (const entry of [MEDIA_LIMITS.maxBytes, MEDIA_LIMITS.maxPixels]) {
      expect(entry.default).toBeGreaterThanOrEqual(entry.min);
      expect(entry.default).toBeLessThanOrEqual(entry.max);
    }
  });
});

describe("checkDimensions", () => {
  it("accepts ordinary sizes", () => {
    expect(checkDimensions(1, 1, limits)).toEqual({ ok: true });
    expect(checkDimensions(4000, 3000, limits)).toEqual({ ok: true });
  });

  it("accepts exactly the pixel limit and refuses one pixel more", () => {
    expect(checkDimensions(10_000, 5_000, limits)).toEqual({ ok: true });
    expect(checkDimensions(5_000, 10_000, limits)).toEqual({ ok: true });
    expect(checkDimensions(50_000_001, 1, { maxPixels: 50_000_000, maxSide: 100_000_000 })).toEqual(
      {
        ok: false,
        reason: "too_many_pixels",
      },
    );
    // 7071 x 7071 = 49 999 041, 7072 x 7071 = 50 006 112
    expect(checkDimensions(7071, 7071, limits)).toEqual({ ok: true });
    expect(checkDimensions(7072, 7071, limits)).toEqual({ ok: false, reason: "too_many_pixels" });
    // the same size against a limit one pixel lower
    expect(checkDimensions(5_000, 10_000, { maxPixels: 49_999_999, maxSide: 12_000 })).toEqual({
      ok: false,
      reason: "too_many_pixels",
    });
    expect(checkDimensions(5_000, 10_000, { maxPixels: 50_000_000, maxSide: 12_000 })).toEqual({
      ok: true,
    });
  });

  it("accepts a side of exactly 12 000 and refuses 12 001", () => {
    expect(checkDimensions(12_000, 1, limits)).toEqual({ ok: true });
    expect(checkDimensions(1, 12_000, limits)).toEqual({ ok: true });
    expect(checkDimensions(12_001, 1, limits)).toEqual({
      ok: false,
      reason: "dimensions_too_large",
    });
    expect(checkDimensions(1, 12_001, limits)).toEqual({
      ok: false,
      reason: "dimensions_too_large",
    });
  });

  it("names the side limit before the pixel limit when both are exceeded", () => {
    expect(checkDimensions(100_000, 100_000, limits)).toEqual({
      ok: false,
      reason: "dimensions_too_large",
    });
    expect(checkDimensions(65_000, 65_000, limits)).toEqual({
      ok: false,
      reason: "dimensions_too_large",
    });
  });

  it("uses the limits it is given", () => {
    expect(checkDimensions(100, 100, { maxPixels: 9_999, maxSide: 12_000 })).toEqual({
      ok: false,
      reason: "too_many_pixels",
    });
    expect(checkDimensions(100, 100, { maxPixels: 10_000, maxSide: 99 })).toEqual({
      ok: false,
      reason: "dimensions_too_large",
    });
  });

  it.each([
    ["zero width", 0, 10],
    ["zero height", 10, 0],
    ["both zero", 0, 0],
    ["negative width", -1, 10],
    ["negative height", 10, -5],
    ["NaN width", Number.NaN, 10],
    ["NaN height", 10, Number.NaN],
    ["Infinity width", Number.POSITIVE_INFINITY, 10],
    ["negative Infinity height", 10, Number.NEGATIVE_INFINITY],
    ["fractional width", 10.5, 10],
    ["fractional height", 10, 0.5],
    ["negative zero", -0, 10],
    ["beyond the safe integers", Number.MAX_SAFE_INTEGER + 2, 10],
  ])("refuses %s as a corrupt header", (_name, width, height) => {
    expect(checkDimensions(width, height, limits)).toEqual({ ok: false, reason: "corrupt_image" });
  });

  it("refuses values that are not numbers", () => {
    expect(checkDimensions("10" as unknown as number, 10, limits)).toEqual({
      ok: false,
      reason: "corrupt_image",
    });
    expect(checkDimensions(10, null as unknown as number, limits)).toEqual({
      ok: false,
      reason: "corrupt_image",
    });
  });

  it("does not overflow: the product of two huge sides is never computed in floating point", () => {
    const huge = { maxPixels: 100_000_000, maxSide: Number.MAX_SAFE_INTEGER };
    expect(checkDimensions(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, huge)).toEqual({
      ok: false,
      reason: "too_many_pixels",
    });
    expect(checkDimensions(Number.MAX_SAFE_INTEGER, 1, huge)).toEqual({
      ok: false,
      reason: "too_many_pixels",
    });
    // 94 906 267 squared passes 2^53, where a floating-point product starts to round
    expect(checkDimensions(94_906_267, 94_906_267, huge)).toEqual({
      ok: false,
      reason: "too_many_pixels",
    });
    expect(checkDimensions(100_000_000, 1, huge)).toEqual({ ok: true });
    expect(checkDimensions(100_000_001, 1, huge)).toEqual({ ok: false, reason: "too_many_pixels" });
  });

  it("agrees with BigInt arithmetic on seeded random sizes around the limit", () => {
    let state = 12345;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    for (let round = 0; round < 20_000; round += 1) {
      const width = (next() % 20_000) + 1;
      const height = (next() % 20_000) + 1;
      const result = checkDimensions(width, height, limits);
      const tooWide = width > 12_000 || height > 12_000;
      const tooMany = BigInt(width) * BigInt(height) > 50_000_000n;
      if (tooWide) {
        expect(result).toEqual({ ok: false, reason: "dimensions_too_large" });
      } else if (tooMany) {
        expect(result).toEqual({ ok: false, reason: "too_many_pixels" });
      } else {
        expect(result).toEqual({ ok: true });
      }
    }
  });
});
