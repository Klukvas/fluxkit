import { describe, expect, it } from "vitest";
import { retryLostRaces, type ProposalLog } from "./retry.js";

const RACE = new Error("lost race");
const EXHAUSTED = new Error("exhausted");

function options(maxAttempts = 8) {
  return {
    maxAttempts,
    isLostRace: (error: unknown) => error === RACE,
    exhausted: () => EXHAUSTED,
  };
}

describe("retryLostRaces", () => {
  it("returns the result of the first attempt that works", async () => {
    let attempts = 0;
    const result = await retryLostRaces(options(), (log: ProposalLog) => {
      attempts += 1;
      log.record(`candidate-${attempts}`);
      return attempts < 3 ? Promise.reject(RACE) : Promise.resolve("done");
    });
    expect(result).toBe("done");
    expect(attempts).toBe(3);
  });

  it("rethrows an error that is not a lost race at once", async () => {
    let attempts = 0;
    const failure = new Error("boom");
    await expect(
      retryLostRaces(options(), () => {
        attempts += 1;
        return Promise.reject(failure);
      }),
    ).rejects.toBe(failure);
    expect(attempts).toBe(1);
  });

  it("stops when a round proposes the same candidates as the round before", async () => {
    let attempts = 0;
    await expect(
      retryLostRaces(options(), (log: ProposalLog) => {
        attempts += 1;
        log.record("same-slug", "SAME-SKU");
        return Promise.reject(RACE);
      }),
    ).rejects.toBe(EXHAUSTED);
    expect(attempts).toBe(2);
  });

  it("keeps retrying while every round proposes something new, up to the bound", async () => {
    let attempts = 0;
    await expect(
      retryLostRaces(options(4), (log: ProposalLog) => {
        attempts += 1;
        log.record(`candidate-${attempts}`);
        return Promise.reject(RACE);
      }),
    ).rejects.toBe(EXHAUSTED);
    expect(attempts).toBe(4);
  });

  it("does not treat two rounds without any recorded candidate as a repeat", async () => {
    let attempts = 0;
    await expect(
      retryLostRaces(options(3), () => {
        attempts += 1;
        return Promise.reject(RACE);
      }),
    ).rejects.toBe(EXHAUSTED);
    expect(attempts).toBe(3);
  });
});
