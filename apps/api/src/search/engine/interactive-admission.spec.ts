import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConcurrencyLimiter } from "./concurrency-limiter.js";
import { SearchEngine, SearchEngineError, type InteractiveAdmission } from "./index.js";

/**
 * How an admission's calls use the interactive lane over time (ADR 0043, ADR 0044), with fake timers and tasks that only
 * wait: no engine is asked (an admission's `call` runs the task it is given), so the timing is exact. The transport
 * itself is covered by `search-engine-transport.spec.ts`.
 */

const N = 8;
const DEADLINE_MS = 2_000;

let engine: SearchEngine;

beforeEach(() => {
  vi.useFakeTimers();
  engine = new SearchEngine({
    // Never contacted: the tasks below do not send anything.
    url: "http://127.0.0.1:9",
    apiKey: "admission-spec-key-0123456789",
    requestTimeoutMs: DEADLINE_MS,
    interactive: { maxConcurrency: N, maxQueue: 512, maxQueueWaitMs: 1_000 },
  });
});

afterEach(() => {
  engine.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PassOutcome {
  readonly code: string;
  /** Most calls of the pass running at once. */
  readonly widest: number;
  readonly startedAt: number;
  readonly endedAt: number;
}

/**
 * One search pass of `calls` calls of `callMs` each, all asked for at once (as the store's `Promise.all`). Like the
 * transport, a call is cut at the pass's deadline (`engine_timeout`).
 */
async function pass(calls: number, callMs: number): Promise<PassOutcome> {
  const startedAt = Date.now();
  let running = 0;
  let widest = 0;
  const work = (admission: InteractiveAdmission): Promise<unknown> =>
    Promise.all(
      Array.from({ length: calls }, () =>
        admission.call("search", async (deadline) => {
          running += 1;
          widest = Math.max(widest, running);
          try {
            const left = deadline - Date.now();
            await wait(Math.min(callMs, left));
            if (left < callMs) {
              throw new SearchEngineError("engine_timeout", { operation: "search" });
            }
          } finally {
            running -= 1;
          }
        }),
      ),
    );
  try {
    await engine.withAdmission(calls, { timeoutMs: DEADLINE_MS }, work);
    return { code: "ok", widest, startedAt, endedAt: Date.now() };
  } catch (error) {
    if (error instanceof SearchEngineError) {
      return { code: error.code, widest, startedAt, endedAt: Date.now() };
    }
    throw error;
  }
}

/** Shoppers browsing: one-call passes of `callMs`, each renewed `thinkMs` after the last ended, until `stop()`. */
function browsing(
  shoppers: number,
  callMs: number,
  thinkMs: number,
): { stop: () => Promise<void> } {
  let stopped = false;
  const loops = Array.from({ length: shoppers }, async () => {
    while (!stopped) {
      await pass(1, callMs);
      if (thinkMs > 0) {
        await wait(thinkMs);
      }
    }
  });
  return {
    stop: async () => {
      stopped = true;
      await vi.advanceTimersByTimeAsync(callMs + thinkMs + 10);
      await Promise.all(loops);
    },
  };
}

/** Facet-heavy multi-word searches arriving `everyMs` apart, then waited for. */
async function heavyPasses(
  count: number,
  calls: number,
  callMs: number,
  everyMs: number,
): Promise<PassOutcome[]> {
  const passes: Promise<PassOutcome>[] = [];
  for (let index = 0; index < count; index += 1) {
    passes.push(pass(calls, callMs));
    await vi.advanceTimersByTimeAsync(everyMs);
  }
  await vi.advanceTimersByTimeAsync(DEADLINE_MS + 1_000);
  return Promise.all(passes);
}

describe("InteractiveAdmission: a granted pass grows on spare slots (ADR 0044)", () => {
  it("moderate load: heavy passes granted one slot grow while the queue is empty and fit their deadline instead of timing out", async () => {
    let peak = 0;
    const sample = setInterval(() => {
      peak = Math.max(peak, engine.interactiveLane().inFlight);
    }, 5);
    // Four shoppers browsing (100 ms per page) and ten searches of 10 calls of 200 ms, 400 ms apart: on one slot such a
    // pass needs 2 000 ms of calls, so it reaches its 2 s deadline (ADR 0043 alone: engine_timeout).
    const shoppers = browsing(4, 100, 0);
    await vi.advanceTimersByTimeAsync(10);
    const outcomes = await heavyPasses(10, 10, 200, 400);
    await shoppers.stop();
    clearInterval(sample);
    expect(outcomes.map((outcome) => outcome.code)).toEqual(Array.from({ length: 10 }, () => "ok"));
    for (const outcome of outcomes) {
      expect(outcome.widest).toBeGreaterThan(1);
    }
    expect(peak).toBeLessThanOrEqual(N);
    expect(engine.interactiveLane().inFlightHighWater).toBeLessThanOrEqual(N);
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 0, queued: 0 });
  });

  it("the review's probe (sustained saturation: a one-call pass always waits): FIFO wins, a heavy pass does not grow (the limit of ADR 0044)", async () => {
    // Eight shoppers renewing 100 ms pages at once keep the queue non-empty while any heavy pass holds a slot, so every
    // freed slot belongs to a waiter and no spare exists.
    const shoppers = browsing(N, 100, 0);
    await vi.advanceTimersByTimeAsync(10);
    const outcomes = await heavyPasses(20, 5, 250, 200);
    await shoppers.stop();
    for (const outcome of outcomes) {
      expect(outcome.widest).toBe(1);
    }
    expect(engine.interactiveLane().inFlightHighWater).toBeLessThanOrEqual(N);
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 0, queued: 0 });
  });

  it("idle slots (review scenario 2): a pass granted one slot grows onto the slots freed while nobody waits", async () => {
    // Seven one-call passes with 10 ms left take seven of the eight slots.
    const short = Array.from({ length: 7 }, () => pass(1, 10));
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.interactiveLane().inFlight).toBe(7);
    const heavy = pass(10, 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.interactiveLane().inFlight).toBe(8);
    await vi.advanceTimersByTimeAsync(10);
    await Promise.all(short);
    // The seven freed slots went to the waiting calls of the pass: eight calls at once (its weight, capped at N).
    expect(engine.interactiveLane().inFlight).toBe(8);
    const outcome = await (async () => {
      await vi.advanceTimersByTimeAsync(400);
      return heavy;
    })();
    expect(outcome.code).toBe("ok");
    expect(outcome.widest).toBe(8);
    // 10 calls: the first round of one call + seven grown, then the rest; far below 10 x 100 ms in series.
    expect(outcome.endedAt - outcome.startedAt).toBeLessThanOrEqual(210);
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 0, queued: 0, admitted: 8 });
  });

  it("never takes a slot a queued pass is waiting for (strict FIFO), and gives a spare back as soon as no call of the pass waits", async () => {
    const holders = Array.from({ length: 7 }, () => pass(1, 100));
    await vi.advanceTimersByTimeAsync(0);
    // A pass of three calls is granted the last slot and runs its calls in series on it so far.
    const heavy = pass(3, 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.interactiveLane().inFlight).toBe(8);
    // A one-call pass queues behind.
    const queued = pass(1, 500);
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.interactiveLane().queued).toBe(1);
    // At 100 ms the seven holders end: the queued pass gets the first freed slot (it waited), the heavy pass may take
    // spares from the rest only once nobody waits: two (its two waiting calls), not more.
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all(holders);
    expect(engine.interactiveLane().queued).toBe(0);
    // queued pass (1) + heavy pass: its own slot (now on its 2nd call) + one spare for its 3rd call.
    expect(engine.interactiveLane().inFlight).toBe(3);
    await vi.advanceTimersByTimeAsync(100);
    const outcome = await heavy;
    expect(outcome.code).toBe("ok");
    expect(outcome.endedAt - outcome.startedAt).toBe(200);
    // Only the queued pass holds a slot now.
    expect(engine.interactiveLane().inFlight).toBe(1);
    await vi.advanceTimersByTimeAsync(400);
    expect((await queued).code).toBe("ok");
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 0, queued: 0 });
  });

  it("a pass whose calls wait and a pass queued behind it: the queued pass is served first, the spare comes after", async () => {
    // All eight slots: seven one-call holders and a 2-call pass on one slot.
    const holders = Array.from({ length: 7 }, (_, index) => pass(1, 100 + index * 100));
    await vi.advanceTimersByTimeAsync(0);
    const heavy = pass(2, 1_000);
    const order: string[] = [];
    let heavyOutcome: PassOutcome | undefined;
    void heavy.then((outcome) => {
      heavyOutcome = outcome;
      order.push("heavy");
    });
    await vi.advanceTimersByTimeAsync(0);
    const queued = pass(1, 50).then((outcome) => {
      order.push("queued");
      return outcome;
    });
    await vi.advanceTimersByTimeAsync(0);
    // 100 ms: one holder ends; the slot goes to the queued pass, not to the heavy pass's waiting call.
    await vi.advanceTimersByTimeAsync(100);
    expect(engine.interactiveLane().queued).toBe(0);
    await vi.advanceTimersByTimeAsync(50);
    expect((await queued).code).toBe("ok");
    expect(order).toEqual(["queued"]);
    // 150 ms: the queued pass ended with nobody waiting: its slot is offered to the heavy pass, whose second call starts
    // then and ends at 1 150 ms, so the pass ends there instead of at 2 000 ms (two calls in series).
    await vi.advanceTimersByTimeAsync(1_000);
    expect(heavyOutcome?.code).toBe("ok");
    expect(order).toEqual(["queued", "heavy"]);
    const outcome = await heavy;
    expect(outcome.endedAt - outcome.startedAt).toBe(1_150);
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all(holders);
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 0, queued: 0 });
  });

  it("releases every slot, spares included, exactly once after an abort or a failure mid-series, and stops growing after it", async () => {
    const holders = Array.from({ length: 7 }, () => pass(1, 50));
    await vi.advanceTimersByTimeAsync(0);
    const controller = new AbortController();
    let started = 0;
    const aborted = engine
      .withAdmission(8, { timeoutMs: DEADLINE_MS, signal: controller.signal }, (admission) =>
        Promise.all(
          Array.from({ length: 8 }, () =>
            admission.call("search", async (_deadline, signal) => {
              started += 1;
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, 1_000);
                signal.addEventListener("abort", () => {
                  clearTimeout(timer);
                  reject(new SearchEngineError("engine_aborted", { operation: "search" }));
                });
              });
            }),
          ),
        ),
      )
      .then(
        () => "ok",
        (error: unknown) => (error instanceof SearchEngineError ? error.code : "other"),
      );
    await vi.advanceTimersByTimeAsync(50);
    await Promise.all(holders);
    // Grown onto the seven freed slots.
    expect(started).toBe(8);
    expect(engine.interactiveLane().inFlight).toBe(8);
    controller.abort();
    expect(await aborted).toBe("engine_aborted");
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 0, queued: 0 });
    // The whole lane is free again (no slot released twice: a full pass takes exactly N).
    const after = pass(8, 10);
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.interactiveLane().inFlight).toBe(8);
    await vi.advanceTimersByTimeAsync(10);
    expect((await after).widest).toBe(8);
    expect(engine.interactiveLane().inFlight).toBe(0);
  });

  it("a call issued later, while its pass's slot is busy and a lane slot is spare, starts at once on the spare", async () => {
    // Seven holders: the pass is granted the last slot of eight.
    const holders = Array.from({ length: 7 }, () => pass(1, 50));
    await vi.advanceTimersByTimeAsync(0);
    const started: number[] = [];
    const t0 = Date.now();
    const outcome = engine.withAdmission(8, { timeoutMs: DEADLINE_MS }, async (admission) => {
      const run = (): Promise<void> =>
        admission.call("search", async () => {
          started.push(Date.now() - t0);
          await wait(200);
        });
      const first = run();
      // The holders end at 50 ms with no call of this pass waiting: the freed slots stay spare in the lane.
      await wait(100);
      return Promise.all([first, run()]);
    });
    await vi.advanceTimersByTimeAsync(150);
    // Asserted before waiting for the pass: without growth the second call starts only at 200 ms.
    expect(started).toEqual([0, 100]);
    await vi.advanceTimersByTimeAsync(400);
    await outcome;
    await Promise.all(holders);
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 0, queued: 0 });
  });

  it("a failure mid-series: the spare slots stay held until the sibling calls running on them settled", async () => {
    const holders = Array.from({ length: 7 }, () => pass(1, 10));
    await vi.advanceTimersByTimeAsync(0);
    let running = 0;
    const failed = engine
      .withAdmission(8, { timeoutMs: DEADLINE_MS }, (admission) =>
        Promise.all(
          Array.from({ length: 8 }, (_, index) =>
            admission.call("search", async () => {
              running += 1;
              try {
                // The engine answers the siblings 100 ms after the failure, whatever the abort.
                await wait(index === 0 ? 50 : 150);
                if (index === 0) {
                  throw new SearchEngineError("engine_rejected", { operation: "search" });
                }
              } finally {
                running -= 1;
              }
            }),
          ),
        ),
      )
      .then(
        () => "ok",
        (error: unknown) => (error instanceof SearchEngineError ? error.code : "other"),
      );
    await vi.advanceTimersByTimeAsync(10);
    await Promise.all(holders);
    expect(running).toBe(8);
    await vi.advanceTimersByTimeAsync(40);
    // 50 ms: the first call failed; its slot is given back (no call runs on it), the seven siblings still run on the
    // grant and six spares, so a one-call pass gets that one slot and the next one waits.
    const next = pass(1, 200);
    const later = pass(1, 10);
    await vi.advanceTimersByTimeAsync(5);
    expect(running).toBe(7);
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 8, queued: 1 });
    await vi.advanceTimersByTimeAsync(100);
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 8, queued: 1 });
    // 160 ms: the siblings settled; their slots are given back and the waiting pass gets one.
    await vi.advanceTimersByTimeAsync(10);
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 2, queued: 0 });
    expect(await failed).toBe("engine_rejected");
    expect(running).toBe(0);
    await vi.advanceTimersByTimeAsync(10);
    expect((await later).code).toBe("ok");
    await vi.advanceTimersByTimeAsync(100);
    expect((await next).code).toBe("ok");
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 0, queued: 0 });
  });

  it("watches the lane for spares only while it holds fewer slots than it asked for, and stops when the pass settles", async () => {
    const original = ConcurrencyLimiter.prototype.watchSpare;
    let watched = 0;
    let stopped = 0;
    vi.spyOn(ConcurrencyLimiter.prototype, "watchSpare").mockImplementation(function (
      this: ConcurrencyLimiter,
      listener: () => void,
    ) {
      watched += 1;
      const stop = original.call(this, listener);
      return () => {
        stopped += 1;
        stop();
      };
    });
    // Granted all it asked for: nothing to watch.
    expect(
      (
        await (async () => {
          const whole = pass(3, 20);
          await vi.advanceTimersByTimeAsync(20);
          return whole;
        })()
      ).code,
    ).toBe("ok");
    expect(watched).toBe(0);
    const holders = Array.from({ length: 7 }, () => pass(1, 10));
    await vi.advanceTimersByTimeAsync(0);
    const heavy = pass(3, 20);
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all(holders);
    expect((await heavy).code).toBe("ok");
    expect(watched).toBe(1);
    expect(stopped).toBe(1);
  });

  it("a pass with more calls than N gives a spare back to a pass that queues behind it after one call, instead of running its backlog on it (review F1 of PR 208)", async () => {
    engine.close();
    engine = new SearchEngine({
      url: "http://127.0.0.1:9",
      apiKey: "admission-spec-key-0123456789",
      requestTimeoutMs: DEADLINE_MS,
      interactive: { maxConcurrency: 2, maxQueue: 512, maxQueueWaitMs: 1_000 },
    });
    const holder = pass(1, 10);
    await vi.advanceTimersByTimeAsync(0);
    // Ten calls of 250 ms on N = 2: admitted on one slot, grown onto the second when the holder ends at 10 ms.
    const heavy = pass(10, 250);
    await vi.advanceTimersByTimeAsync(11);
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 2, queued: 0 });
    // A catalog page arrives and queues.
    let page: PassOutcome | undefined;
    void pass(1, 50).then((outcome) => {
      page = outcome;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.interactiveLane().queued).toBe(1);
    // At 250 ms the pass's first call ends: the spare goes to the page, not to the pass's third call.
    await vi.advanceTimersByTimeAsync(300);
    expect(page?.code).toBe("ok");
    expect((page?.endedAt ?? 0) - (page?.startedAt ?? 0)).toBeLessThanOrEqual(300);
    await vi.advanceTimersByTimeAsync(DEADLINE_MS);
    const outcome = await heavy;
    expect(outcome.code).toBe("ok");
    expect(outcome.widest).toBe(2);
    await holder;
    expect(engine.interactiveLane()).toMatchObject({
      inFlight: 0,
      queued: 0,
      refused: { queueFull: 0, waitExceeded: 0 },
    });
  });

  it("slots freed together go round the growing passes one at a time (review F5 of PR 208)", async () => {
    engine.close();
    engine = new SearchEngine({
      url: "http://127.0.0.1:9",
      apiKey: "admission-spec-key-0123456789",
      requestTimeoutMs: DEADLINE_MS,
      interactive: { maxConcurrency: 4, maxQueue: 512, maxQueueWaitMs: 1_000 },
    });
    // A two-call pass holds two slots, a one-call pass a third; a three-call pass gets the fourth, another queues and
    // gets the one-call pass's slot at 30 ms: each three-call pass runs on one slot with two calls waiting.
    const holder = pass(2, 100);
    await vi.advanceTimersByTimeAsync(0);
    const short = pass(1, 30);
    await vi.advanceTimersByTimeAsync(0);
    const first = pass(3, 500);
    await vi.advanceTimersByTimeAsync(0);
    const second = pass(3, 500);
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 4, queued: 3 });
    await vi.advanceTimersByTimeAsync(30);
    await short;
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 4, queued: 0 });
    // At 100 ms the holder gives back both slots at once while nobody queues: one to each growing pass.
    await vi.advanceTimersByTimeAsync(70);
    await holder;
    await vi.advanceTimersByTimeAsync(DEADLINE_MS);
    const [a, b] = await Promise.all([first, second]);
    expect([a.code, b.code]).toEqual(["ok", "ok"]);
    expect([a.widest, b.widest]).toEqual([2, 2]);
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 0, queued: 0 });
  });
});
