import { describe, expect, it } from "vitest";
import { SendPacer } from "./send-pacer.js";

/** A pacer on a fake clock whose sleep advances the clock. */
function fakePacer(perSecond: number) {
  let now = 1_000;
  const sleeps: number[] = [];
  const pacer = new SendPacer(
    perSecond,
    () => now,
    (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  );
  return {
    pacer,
    sleeps,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("SendPacer", () => {
  it("lets the first call go at once and spaces the next ones 1000 / perSecond ms apart", async () => {
    const { pacer, sleeps } = fakePacer(8);
    await Promise.all([pacer.acquire(), pacer.acquire(), pacer.acquire(), pacer.acquire()]);
    expect(sleeps).toEqual([125, 250, 375]);
  });

  it("does not wait when the calls are already slower than the rate", async () => {
    const { pacer, sleeps, advance } = fakePacer(8);
    await pacer.acquire();
    advance(200);
    await pacer.acquire();
    advance(125);
    await pacer.acquire();
    expect(sleeps).toEqual([]);
  });

  it("counts the calls that wait for their slot", async () => {
    let release: () => void = () => undefined;
    const pacer = new SendPacer(
      1,
      () => 0,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await pacer.acquire();
    const waiting = pacer.acquire();
    expect(pacer.waiting()).toBe(1);
    release();
    await waiting;
    expect(pacer.waiting()).toBe(0);
  });

  it("refuses a rate that is not positive", () => {
    expect(() => new SendPacer(0)).toThrow(RangeError);
    expect(() => new SendPacer(Number.NaN)).toThrow(RangeError);
  });
});
