import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConcurrencyLimiter, LimiterRejection } from "./concurrency-limiter.js";

/** A task the test finishes by hand: no timing decides the order. */
function gate<T = string>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Lets every queued microtask run (promise hand-offs between the limiter and the tasks). */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("ConcurrencyLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs at most maxInFlight tasks at once and starts the waiting ones in FIFO order", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 2, maxQueue: 10 });
    const gates = Array.from({ length: 6 }, () => gate());
    const started: number[] = [];
    let running = 0;
    let peak = 0;
    const runs = gates.map((entry, index) =>
      limiter.run(10_000, async () => {
        started.push(index);
        running += 1;
        peak = Math.max(peak, running);
        try {
          return await entry.promise;
        } finally {
          running -= 1;
        }
      }),
    );
    await settle();
    expect(started).toEqual([0, 1]);
    expect(limiter.inFlight).toBe(2);
    expect(limiter.waiting).toBe(4);

    // Finishing out of order still starts the oldest waiter first.
    gates[1]?.resolve("b");
    await settle();
    expect(started).toEqual([0, 1, 2]);
    gates[0]?.resolve("a");
    await settle();
    expect(started).toEqual([0, 1, 2, 3]);
    gates[3]?.resolve("d");
    gates[2]?.resolve("c");
    await settle();
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    gates[4]?.resolve("e");
    gates[5]?.resolve("f");
    expect(await Promise.all(runs)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(peak).toBe(2);
    expect(limiter.inFlight).toBe(0);
    expect(limiter.waiting).toBe(0);
  });

  it("frees the slot when a task throws, times out or is aborted, and passes the error on", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 1, maxQueue: 10 });
    const failure = new Error("boom");
    const abort = new DOMException("aborted", "AbortError");
    const timeout = new DOMException("timed out", "TimeoutError");
    for (const error of [failure, abort, timeout]) {
      const outcome = await rejectionOf(limiter.run(1_000, () => Promise.reject(error)));
      expect(outcome).toBe(error);
      expect(limiter.inFlight).toBe(0);
    }
    // A task that throws synchronously frees its slot too.
    const sync = await rejectionOf(
      limiter.run(1_000, () => {
        throw failure;
      }),
    );
    expect(sync).toBe(failure);
    expect(limiter.inFlight).toBe(0);
    expect(await limiter.run(1_000, () => Promise.resolve("next"))).toBe("next");
  });

  it("hands a freed slot to the next waiter even when the holder failed", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 1, maxQueue: 10 });
    const first = gate();
    const failing = limiter.run(1_000, () => first.promise);
    const second = limiter.run(1_000, () => Promise.resolve("second"));
    await settle();
    expect(limiter.waiting).toBe(1);
    first.reject(new Error("engine down"));
    await expect(failing).rejects.toThrow("engine down");
    expect(await second).toBe("second");
    expect(limiter.inFlight).toBe(0);
  });

  it("refuses at once with queue_full when the queue is full, without waiting or running the task", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 1, maxQueue: 2 });
    const holder = gate();
    const running = limiter.run(10_000, () => holder.promise);
    const queued = [
      limiter.run(10_000, () => Promise.resolve("q1")),
      limiter.run(10_000, () => Promise.resolve("q2")),
    ];
    const task = vi.fn(() => Promise.resolve("never"));
    const refused = await rejectionOf(limiter.run(10_000, task));
    expect(refused).toBeInstanceOf(LimiterRejection);
    expect((refused as LimiterRejection).reason).toBe("queue_full");
    expect(task).not.toHaveBeenCalled();
    expect(limiter.waiting).toBe(2);
    holder.resolve("h");
    expect(await running).toBe("h");
    expect(await Promise.all(queued)).toEqual(["q1", "q2"]);
  });

  it("with maxQueue 0 refuses whenever every slot is taken", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 1, maxQueue: 0 });
    const holder = gate();
    const running = limiter.run(10_000, () => holder.promise);
    const refused = await rejectionOf(limiter.acquire(10_000));
    expect((refused as LimiterRejection).reason).toBe("queue_full");
    holder.resolve("h");
    await running;
  });

  it("gives up a wait after maxWaitMs with wait_exceeded, leaves the queue and leaks no slot", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 1, maxQueue: 10 });
    const holder = gate();
    const running = limiter.run(10_000, () => holder.promise);
    const task = vi.fn(() => Promise.resolve("late"));
    const waiting = rejectionOf(limiter.run(500, task));
    const patient = limiter.run(10_000, () => Promise.resolve("patient"));
    await settle();
    expect(limiter.waiting).toBe(2);

    await vi.advanceTimersByTimeAsync(499);
    expect(limiter.waiting).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await waiting;
    expect(outcome).toBeInstanceOf(LimiterRejection);
    expect((outcome as LimiterRejection).reason).toBe("wait_exceeded");
    expect(task).not.toHaveBeenCalled();
    expect(limiter.waiting).toBe(1);

    // The slot goes to the next live waiter, not to the one that gave up.
    holder.resolve("h");
    await running;
    expect(await patient).toBe("patient");
    expect(limiter.inFlight).toBe(0);
    expect(limiter.waiting).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refuses at once a call that may not wait (maxWaitMs 0) when no slot is free, but runs it when one is", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 1, maxQueue: 10 });
    expect(await limiter.run(0, () => Promise.resolve("free"))).toBe("free");
    const holder = gate();
    const running = limiter.run(10_000, () => holder.promise);
    const refused = await rejectionOf(limiter.acquire(0));
    expect((refused as LimiterRejection).reason).toBe("wait_exceeded");
    expect(limiter.waiting).toBe(0);
    holder.resolve("h");
    await running;
  });

  it("clears the wait timer of a waiter that got a slot (no timer left behind)", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 1, maxQueue: 10 });
    const holder = gate();
    const running = limiter.run(10_000, () => holder.promise);
    const waiting = limiter.run(10_000, () => Promise.resolve("got it"));
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    holder.resolve("h");
    await running;
    expect(await waiting).toBe("got it");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("frees a slot only once, however often its release is called", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 2, maxQueue: 10 });
    const release = await limiter.acquire(1_000);
    const other = await limiter.acquire(1_000);
    expect(limiter.inFlight).toBe(2);
    release();
    release();
    expect(limiter.inFlight).toBe(1);
    const third = await limiter.acquire(1_000);
    expect(limiter.inFlight).toBe(2);
    other();
    third();
    expect(limiter.inFlight).toBe(0);
  });

  it("never exceeds maxInFlight under a burst of mixed outcomes and ends with no slot taken", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 3, maxQueue: 100 });
    const gates = Array.from({ length: 40 }, () => gate<number>());
    const runningNow = new Set<number>();
    let peak = 0;
    const runs = gates.map((entry, index) =>
      limiter
        .run(10_000, async () => {
          runningNow.add(index);
          peak = Math.max(peak, runningNow.size);
          try {
            return await entry.promise;
          } finally {
            runningNow.delete(index);
          }
        })
        .catch((error: unknown) => (error instanceof Error ? error.message : "?")),
    );
    await settle();
    // Finish the running tasks in a fixed scrambled order: every third one fails.
    let step = 0;
    while (runningNow.size > 0) {
      expect(runningNow.size).toBeLessThanOrEqual(3);
      expect(limiter.inFlight).toBe(runningNow.size);
      const ids = [...runningNow];
      const id = ids[step % ids.length] ?? -1;
      step += 1;
      if (id % 3 === 0) {
        gates[id]?.reject(new Error("fail"));
      } else {
        gates[id]?.resolve(id);
      }
      await settle();
    }
    const results = await Promise.all(runs);
    expect(results.filter((value) => value === "fail")).toHaveLength(14);
    expect(results.filter((value) => typeof value === "number")).toHaveLength(26);
    expect(peak).toBe(3);
    expect(limiter.inFlight).toBe(0);
    expect(limiter.waiting).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("close() refuses every waiter with closed and every later call, and keeps running tasks", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 1, maxQueue: 10 });
    const holder = gate();
    const running = limiter.run(10_000, () => holder.promise);
    const waiting = rejectionOf(limiter.acquire(10_000));
    await settle();
    limiter.close();
    expect(((await waiting) as LimiterRejection).reason).toBe("closed");
    expect(((await rejectionOf(limiter.acquire(10_000))) as LimiterRejection).reason).toBe(
      "closed",
    );
    expect(vi.getTimerCount()).toBe(0);
    holder.resolve("h");
    expect(await running).toBe("h");
    expect(limiter.inFlight).toBe(0);
  });

  it("refuses options it cannot honour", () => {
    expect(() => new ConcurrencyLimiter({ maxInFlight: 0, maxQueue: 1 })).toThrow(RangeError);
    expect(() => new ConcurrencyLimiter({ maxInFlight: 1.5, maxQueue: 1 })).toThrow(RangeError);
    expect(() => new ConcurrencyLimiter({ maxInFlight: 1, maxQueue: -1 })).toThrow(RangeError);
  });
});

/** Weighted admissions (one per search pass, ADR 0042), abort signals and the counters of the admin status. */
describe("ConcurrencyLimiter: weights, abort signals and counters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("grants a weight only when that many slots are free, and releases them all at once", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 3, maxQueue: 10 });
    const one = await limiter.acquire(10_000, { weight: 1 });
    const granted: string[] = [];
    const three = limiter.acquire(10_000, { weight: 3 }).then((release) => {
      granted.push("three");
      return release;
    });
    await settle();
    expect(granted).toEqual([]);
    expect(limiter.inFlight).toBe(1);
    expect(limiter.waiting).toBe(3);
    one();
    const releaseThree = await three;
    expect(granted).toEqual(["three"]);
    expect(limiter.inFlight).toBe(3);
    expect(limiter.waiting).toBe(0);
    releaseThree();
    releaseThree();
    expect(limiter.inFlight).toBe(0);
  });

  it("keeps FIFO across weights: a small caller never overtakes a larger one that waits", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 2, maxQueue: 10 });
    const first = await limiter.acquire(10_000, { weight: 1 });
    const order: string[] = [];
    const large = limiter.acquire(10_000, { weight: 2 }).then((release) => {
      order.push("large");
      return release;
    });
    const small = limiter.acquire(10_000, { weight: 1 }).then((release) => {
      order.push("small");
      return release;
    });
    await settle();
    // One slot is free, but the large caller came first: the small one waits behind it.
    expect(order).toEqual([]);
    first();
    const releaseLarge = await large;
    await settle();
    expect(order).toEqual(["large"]);
    releaseLarge();
    (await small)();
    expect(order).toEqual(["large", "small"]);
    expect(limiter.inFlight).toBe(0);
  });

  it("counts the queue in slots: a weight that does not fit in the room left is refused with queue_full", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 2, maxQueue: 3 });
    const holder = await limiter.acquire(10_000, { weight: 2 });
    const waiting = limiter.acquire(10_000, { weight: 2 });
    await settle();
    expect(limiter.waiting).toBe(2);
    const refused = await rejectionOf(limiter.acquire(10_000, { weight: 2 }));
    expect((refused as LimiterRejection).reason).toBe("queue_full");
    const fits = limiter.acquire(10_000, { weight: 1 });
    await settle();
    expect(limiter.waiting).toBe(3);
    holder();
    (await waiting)();
    (await fits)();
    expect(limiter.inFlight).toBe(0);
  });

  it("refuses a weight above maxInFlight or below 1", () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 2, maxQueue: 10 });
    expect(() => limiter.acquire(10_000, { weight: 3 })).toThrow(RangeError);
    expect(() => limiter.acquire(10_000, { weight: 0 })).toThrow(RangeError);
    expect(() => limiter.acquire(10_000, { weight: 1.5 })).toThrow(RangeError);
  });

  it("an abort signal removes a waiter at once, frees its room and lets the callers behind it in", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 2, maxQueue: 4 });
    const holder = await limiter.acquire(10_000, { weight: 1 });
    const controller = new AbortController();
    const large = rejectionOf(limiter.acquire(10_000, { weight: 2, signal: controller.signal }));
    const order: string[] = [];
    const small = limiter.acquire(10_000, { weight: 1 }).then((release) => {
      order.push("small");
      return release;
    });
    await settle();
    expect(limiter.waiting).toBe(3);
    controller.abort();
    expect(((await large) as LimiterRejection).reason).toBe("aborted");
    // The aborted head no longer blocks: the free slot goes to the small caller behind it.
    const releaseSmall = await small;
    expect(order).toEqual(["small"]);
    expect(limiter.waiting).toBe(0);
    expect(limiter.inFlight).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
    releaseSmall();
    holder();
    expect(limiter.inFlight).toBe(0);
  });

  it("refuses an already aborted signal at once with aborted, without taking a slot", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 1, maxQueue: 1 });
    const controller = new AbortController();
    controller.abort();
    const refused = await rejectionOf(limiter.acquire(10_000, { signal: controller.signal }));
    expect((refused as LimiterRejection).reason).toBe("aborted");
    expect(limiter.inFlight).toBe(0);
  });

  it("an abort after the grant changes nothing: the holder keeps its slots until it releases them", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 1, maxQueue: 1 });
    const controller = new AbortController();
    const release = await limiter.acquire(10_000, { signal: controller.signal });
    controller.abort();
    expect(limiter.inFlight).toBe(1);
    release();
    expect(limiter.inFlight).toBe(0);
  });

  it("a head that gives up waiting lets the smaller callers behind it in", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 2, maxQueue: 10 });
    const holder = await limiter.acquire(10_000, { weight: 1 });
    const large = rejectionOf(limiter.acquire(100, { weight: 2 }));
    const small = limiter.acquire(10_000, { weight: 1 });
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    expect(((await large) as LimiterRejection).reason).toBe("wait_exceeded");
    const releaseSmall = await small;
    expect(limiter.inFlight).toBe(2);
    releaseSmall();
    holder();
  });

  it("counts grants, refusals by reason and abandoned waiters, and keeps the high-water marks", async () => {
    const limiter = new ConcurrencyLimiter({ maxInFlight: 2, maxQueue: 2 });
    expect(limiter.counters()).toEqual({
      granted: 0,
      refusedQueueFull: 0,
      refusedWaitExceeded: 0,
      abandoned: 0,
      inFlightHighWater: 0,
      waitingHighWater: 0,
    });
    const holder = await limiter.acquire(10_000, { weight: 2 });
    const timedOut = rejectionOf(limiter.acquire(50, { weight: 1 }));
    const controller = new AbortController();
    const abandoned = rejectionOf(limiter.acquire(10_000, { signal: controller.signal }));
    await settle();
    expect(((await rejectionOf(limiter.acquire(10_000))) as LimiterRejection).reason).toBe(
      "queue_full",
    );
    expect(((await rejectionOf(limiter.acquire(0))) as LimiterRejection).reason).toBe("queue_full");
    controller.abort();
    await abandoned;
    expect(((await rejectionOf(limiter.acquire(0))) as LimiterRejection).reason).toBe(
      "wait_exceeded",
    );
    await vi.advanceTimersByTimeAsync(50);
    await timedOut;
    holder();
    (await limiter.acquire(10_000))();
    expect(limiter.counters()).toEqual({
      granted: 2,
      refusedQueueFull: 2,
      refusedWaitExceeded: 2,
      abandoned: 1,
      inFlightHighWater: 2,
      waitingHighWater: 2,
    });
    // A refusal by close() is a shutdown, not a refusal of load.
    limiter.close();
    await rejectionOf(limiter.acquire(10_000));
    expect(limiter.counters().refusedQueueFull).toBe(2);
  });
});
