import { describe, expect, it } from "vitest";
import {
  BASIS_POINTS_PER_UNIT,
  MAX_AMOUNT,
  MAX_PERCENTAGE_BASIS_POINTS,
  MAX_QUANTITY,
} from "./limits.js";

describe("pricing limits", () => {
  it("fixes the documented values", () => {
    expect(MAX_AMOUNT).toBe(1_000_000_000_000);
    expect(MAX_QUANTITY).toBe(1_000_000);
    expect(BASIS_POINTS_PER_UNIT).toBe(10_000);
    expect(MAX_PERCENTAGE_BASIS_POINTS).toBe(1_000_000);
  });

  it("keeps every amount an exact JavaScript number and a Postgres bigint", () => {
    expect(MAX_AMOUNT).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(MAX_AMOUNT).toBeLessThan(2 ** 63);
    // 100x is the largest percentage.
    expect(MAX_PERCENTAGE_BASIS_POINTS).toBe(100 * BASIS_POINTS_PER_UNIT);
  });
});
