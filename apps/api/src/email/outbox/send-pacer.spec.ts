import { describe, expect, it } from "vitest";
import type { WindowStore } from "../../rate-limit/window-store.js";
import { SendPacer } from "./send-pacer.js";

function harness(shared = false) {
  let now = 0;
  let nextShared = 0;
  let replyDelay = 0;
  let timerDelay = 0;
  let steadyReplyDelay = 0;
  let fallback = false;
  const slots: number[] = [];
  const store: WindowStore = {
    status: "redis",
    hit: async () => ({ allowed: true }),
    reserveEmailSlot: async (interval) => {
      if (fallback) return null;
      const slotAt = Math.max(now, nextShared);
      const waitMs = slotAt - now;
      nextShared = slotAt + interval;
      slots.push(slotAt);
      now += replyDelay + steadyReplyDelay;
      replyDelay = 0;
      return { waitMs, slotAt };
    },
  };
  const pacer = () =>
    new SendPacer(
      8,
      () => now,
      async (ms) => {
        now += ms + timerDelay;
        timerDelay = 0;
      },
      shared ? store : undefined,
    );
  return {
    pacer,
    slots,
    now: () => now,
    delayReply: (ms: number) => {
      replyDelay = ms;
    },
    steadyReply: (ms: number) => {
      steadyReplyDelay = ms;
    },
    delayTimer: (ms: number) => {
      timerDelay = ms;
    },
    fallback: (value: boolean) => {
      fallback = value;
    },
  };
}

describe("SendPacer", () => {
  it("spaces concurrent actual starts in memory mode", async () => {
    const h = harness();
    const pacer = h.pacer();
    const times: number[] = [];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        await pacer.start(10_000, () => times.push(h.now()));
      }),
    );
    expect(times).toEqual([0, 125, 250, 375]);
    expect(pacer.waiting()).toBe(0);
  });

  it("never catches up late timers or delayed Redis replies", async () => {
    const h = harness(true);
    const pacer = h.pacer();
    const times: number[] = [];
    await pacer.acquire();
    times.push(h.now());
    h.delayReply(500);
    h.delayTimer(400);
    await pacer.acquire();
    times.push(h.now());
    await pacer.acquire();
    times.push(h.now());
    expect(h.slots.length).toBeGreaterThan(3);
    for (let i = 1; i < times.length; i += 1) {
      expect((times[i] ?? NaN) - (times[i - 1] ?? NaN)).toBeGreaterThanOrEqual(125);
    }
  });

  it("keeps local continuity across shared, fallback and recovery with queued callers", async () => {
    const h = harness(true);
    const pacer = h.pacer();
    const times: number[] = [];
    await Promise.all(
      [false, true, false, true, false].map((fallback) =>
        pacer.start(10_000, () => {
          times.push(h.now());
          h.fallback(fallback);
        }),
      ),
    );
    expect(times).toHaveLength(5);
    for (let i = 1; i < times.length; i += 1) {
      expect((times[i] ?? NaN) - (times[i - 1] ?? NaN)).toBeGreaterThanOrEqual(125);
    }
  });

  it("refuses a slot beyond the maximum wait without sleeping", async () => {
    const h = harness();
    const pacer = h.pacer();
    await pacer.acquire();
    expect(await pacer.acquire(100)).toBe(false);
    expect(h.now()).toBe(0);
  });

  it("preserves shared reservation spacing across two pacers", async () => {
    const h = harness(true);
    const first = h.pacer();
    const second = h.pacer();
    for (let i = 0; i < 8; i += 1) await (i % 2 ? first : second).acquire();
    for (let i = 1; i < h.slots.length; i += 1) {
      expect((h.slots[i] ?? NaN) - (h.slots[i - 1] ?? NaN)).toBeGreaterThanOrEqual(125);
    }
  });

  it("reacquires a shared slot when its timer wakes late", async () => {
    const h = harness(true);
    await h.pacer().acquire();
    h.delayTimer(500);
    const second = h.pacer();
    const start = await second.start(10_000, h.now);
    expect(start).toEqual({ started: true, value: 631 });
    expect(h.slots).toEqual([0, 131, 631]);
    await second.acquire();
    expect(h.now()).toBeGreaterThanOrEqual(756);
  });

  it("does not wait for a provider answer before admitting the next call", async () => {
    const h = harness();
    const pacer = h.pacer();
    let finish: () => void = () => undefined;
    const provider = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = await pacer.start(1_000, () => provider);
    const second = await pacer.start(1_000, h.now);
    expect(second).toEqual({ started: true, value: 125 });
    finish();
    if (!first.started) throw new Error("First send was refused");
    await first.value;
  });

  it("does not delay calls that are already slower than the rate", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const pacer = new SendPacer(
      8,
      () => now,
      async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    );
    await pacer.acquire();
    now = 200;
    await pacer.acquire();
    now = 325;
    await pacer.acquire();
    expect(sleeps).toEqual([]);
  });

  it("sustains at least 90% of the configured rate across two pacers at 1 ms Redis RTT", async () => {
    const h = harness(true);
    h.steadyReply(1);
    const pacers = [h.pacer(), h.pacer()];
    const times: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const pacer = pacers[i % 2];
      if (pacer === undefined) throw new Error("Missing pacer");
      const result = await pacer.start(2_000, () => times.push(h.now()));
      expect(result.started).toBe(true);
    }
    expect(times).toHaveLength(200);
    for (let i = 1; i < times.length; i += 1) {
      expect((times[i] ?? NaN) - (times[i - 1] ?? NaN)).toBeGreaterThanOrEqual(125);
    }
    // Measure completed intervals so the initial send does not inflate sustained throughput.
    const elapsedMs = (times.at(-1) ?? NaN) - (times[0] ?? NaN);
    const sendsPerSecond = ((times.length - 1) * 1_000) / elapsedMs;
    expect(sendsPerSecond).toBeLessThanOrEqual(8);
    // Measured 94.7% at 1 ms RTT: the slot lateness tolerance costs about 5%.
    expect(sendsPerSecond, `200 sends span ${elapsedMs} ms`).toBeGreaterThanOrEqual(8 * 0.9);
  });

  it.each([
    { latency: 6, measuredRate: 7.3 },
    { latency: 20, measuredRate: 6.62 },
    { latency: 50, measuredRate: 5.52 },
  ])(
    "reduces throughput to about $measuredRate/s at $latency ms Redis RTT without exceeding 8/s",
    async ({ latency, measuredRate }) => {
      const h = harness(true);
      h.steadyReply(latency);
      const pacer = h.pacer();
      const times: number[] = [];
      for (let i = 0; i < 200; i += 1) {
        const result = await pacer.start(2_000, () => times.push(h.now()));
        expect(result.started).toBe(true);
      }
      expect(times).toHaveLength(200);
      for (let i = 1; i < times.length; i += 1) {
        expect((times[i] ?? NaN) - (times[i - 1] ?? NaN)).toBeGreaterThanOrEqual(125);
      }
      // Completed intervals exclude initial admission/reacquisition from sustained throughput.
      const elapsedMs = (times.at(-1) ?? NaN) - (times[0] ?? NaN);
      const sendsPerSecond = ((times.length - 1) * 1_000) / elapsedMs;
      expect(sendsPerSecond).toBeLessThanOrEqual(8);
      expect(sendsPerSecond).toBeCloseTo(measuredRate, 2);
    },
  );

  it("expires queued budgets and late reacquisitions without starting", async () => {
    const h = harness(true);
    const pacer = h.pacer();
    const first = pacer.acquire(1_000);
    const queued = pacer.acquire(100);
    expect(await first).toBe(true);
    expect(await queued).toBe(false);
    h.delayTimer(200);
    expect(await pacer.acquire(150)).toBe(false);
    expect(pacer.waiting()).toBe(0);
  });

  it("preserves actual spacing across processes with changing Redis reply latency", async () => {
    const h = harness(true);
    const pacers = [h.pacer(), h.pacer()];
    const times: number[] = [];
    for (const [index, latency] of [20, 0, 50, 6, 0, 20, 6, 0].entries()) {
      h.steadyReply(latency);
      const pacer = pacers[index % 2];
      if (pacer === undefined) throw new Error("Missing pacer");
      expect(await pacer.acquire(2_000)).toBe(true);
      times.push(h.now());
    }
    for (let i = 1; i < times.length; i += 1) {
      expect((times[i] ?? NaN) - (times[i - 1] ?? NaN)).toBeGreaterThanOrEqual(125);
    }
  });

  it("refuses a rate that is not positive", () => {
    expect(() => new SendPacer(0)).toThrow(RangeError);
    expect(() => new SendPacer(Number.NaN)).toThrow(RangeError);
  });
});
