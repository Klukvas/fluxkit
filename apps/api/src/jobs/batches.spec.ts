import { describe, expect, it } from "vitest";
import { assertBatchLimits, drainInBatches } from "./batches.js";

describe("drainInBatches", () => {
  /** A table with `rows` rows that a step deletes `batchSize` at a time. */
  function table(rows: number) {
    const state = { rows, calls: 0, sizes: [] as number[] };
    const step = async (batchSize: number): Promise<number> => {
      state.calls += 1;
      state.sizes.push(batchSize);
      const deleted = Math.min(batchSize, state.rows);
      state.rows -= deleted;
      return deleted;
    };
    return { state, step };
  }

  it("stops at the first short batch", async () => {
    const { state, step } = table(5);
    expect(await drainInBatches(step, { batchSize: 2, maxBatches: 10 })).toEqual({
      total: 5,
      truncated: false,
    });
    expect(state.calls).toBe(3);
    expect(state.sizes).toEqual([2, 2, 2]);
  });

  it("needs one empty batch to know an exact multiple is done", async () => {
    const { state, step } = table(4);
    expect(await drainInBatches(step, { batchSize: 2, maxBatches: 10 })).toEqual({
      total: 4,
      truncated: false,
    });
    expect(state.calls).toBe(3);
  });

  it("does nothing on an empty table with one statement", async () => {
    const { state, step } = table(0);
    expect(await drainInBatches(step, { batchSize: 2, maxBatches: 10 })).toEqual({
      total: 0,
      truncated: false,
    });
    expect(state.calls).toBe(1);
  });

  it("stops at maxBatches and reports a truncation, never spinning", async () => {
    const { state, step } = table(1_000);
    expect(await drainInBatches(step, { batchSize: 2, maxBatches: 3 })).toEqual({
      total: 6,
      truncated: true,
    });
    expect(state.calls).toBe(3);
  });

  it("ends even when a broken step always reports a full batch", async () => {
    let calls = 0;
    const result = await drainInBatches(
      async (batchSize) => {
        calls += 1;
        return batchSize;
      },
      { batchSize: 5, maxBatches: 4 },
    );
    expect(result).toEqual({ total: 20, truncated: true });
    expect(calls).toBe(4);
  });

  it("refuses nonsensical limits", () => {
    expect(() => assertBatchLimits({ batchSize: 0, maxBatches: 1 })).toThrow(RangeError);
    expect(() => assertBatchLimits({ batchSize: 10_001, maxBatches: 1 })).toThrow(RangeError);
    expect(() => assertBatchLimits({ batchSize: 1.5, maxBatches: 1 })).toThrow(RangeError);
    expect(() => assertBatchLimits({ batchSize: 1, maxBatches: 0 })).toThrow(RangeError);
    expect(() => assertBatchLimits({ batchSize: 10_000, maxBatches: 1 })).not.toThrow();
  });
});
