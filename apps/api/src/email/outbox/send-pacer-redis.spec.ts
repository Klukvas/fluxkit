import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemClock } from "../../auth/clock.js";
import { requireEnv } from "../../test/env.js";
import { MemoryWindowStore, RedisWindowStore } from "../../rate-limit/window-store.js";
import { SendPacer } from "./send-pacer.js";

const prefix = `pacer_${randomUUID()}`;
const key = `fluxkit:${prefix}:email-pacer`;
const clients = [new Redis(requireEnv("REDIS_URL")), new Redis(requireEnv("REDIS_URL"))];
const stores = clients.map(
  (client) =>
    new RedisWindowStore(client, prefix, "test-secret", new MemoryWindowStore(new SystemClock())),
);

beforeAll(async () => {
  await Promise.all(clients.map((client) => client.ping()));
});
beforeEach(async () => {
  await clients[0]?.del(key);
});
afterAll(async () => {
  const client = clients[0];
  if (client !== undefined) {
    const keys = await client.keys(`fluxkit:${prefix}:*`);
    if (keys.length > 0) await client.del(...keys);
  }
  await Promise.all(clients.map((client) => client.quit()));
});

describe("SendPacer with real Redis", () => {
  it("hands out shared, spaced slots in each process's call order using Redis TIME", async () => {
    const reservations = stores.map((store) => vi.spyOn(store, "reserveEmailSlot"));
    const sleeps: number[][] = [[], []];
    const clocks = [0, 0];
    const pacers = stores.map(
      (store, index) =>
        new SendPacer(
          8,
          () => clocks[index] ?? 0,
          (ms) => {
            sleeps[index]?.push(ms);
            clocks[index] = (clocks[index] ?? 0) + ms;
            return Promise.resolve();
          },
          store,
        ),
    );
    await Promise.all(Array.from({ length: 40 }, (_, index) => pacers[index % 2]?.acquire()));
    const slotsByProcess = await Promise.all(
      reservations.map(async (spy) => {
        const slots = await Promise.all(spy.mock.results.map((result) => result.value));
        expect(slots).toHaveLength(20);
        return slots.map((slot) => {
          if (slot === null) throw new Error("Unexpected fallback");
          expect(slot.waitMs).toBeGreaterThanOrEqual(0);
          return slot.slotAt;
        });
      }),
    );
    for (const slots of slotsByProcess) {
      expect(slots).toEqual([...slots].sort((a, b) => a - b));
    }
    const slots = slotsByProcess.flat().sort((a, b) => a - b);
    for (let index = 1; index < slots.length; index += 1) {
      expect((slots[index] ?? 0) - (slots[index - 1] ?? 0)).toBeGreaterThanOrEqual(125);
    }
    expect(sleeps.flat().length).toBeGreaterThan(0);
    expect(pacers.map((pacer) => pacer.waiting())).toEqual([0, 0]);
    const client = clients[0];
    if (client === undefined) throw new Error("Missing Redis client");
    expect(await client.keys(`fluxkit:${prefix}:*`)).toEqual([key]);
    expect(await client.get(key)).toMatch(/^\d+$/);
    // The expiry must retain the entire backlog, not reset to one interval.
    expect(await client.pttl(key)).toBeGreaterThan(4000);
    reservations.forEach((spy) => spy.mockRestore());
  });

  it("counts pending reservations and sleeping calls, and clears waiting after a sleep failure", async () => {
    await stores[0]?.reserveEmailSlot(125);
    let release: () => void = () => undefined;
    const sleeping = new Promise<void>((resolve) => {
      release = resolve;
    });
    let now = 0;
    const sleep = vi.fn(async (ms: number) => {
      await sleeping;
      now += ms;
    });
    const pacer = new SendPacer(8, () => now, sleep, stores[0]);
    const pending = pacer.acquire();
    expect(pacer.waiting()).toBe(1);
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(1));
    expect(pacer.waiting()).toBe(1);
    release();
    await pending;
    expect(pacer.waiting()).toBe(0);
    const failed = new SendPacer(
      8,
      undefined,
      () => Promise.reject(new Error("sleep_failed")),
      stores[0],
    );
    await expect(failed.acquire()).rejects.toThrow("sleep_failed");
    expect(failed.waiting()).toBe(0);
  });

  it("falls back per process, shares the once-a-minute error log with windows, and recovers", async () => {
    const client = new Redis(requireEnv("REDIS_URL"), { enableOfflineQueue: false });
    client.on("error", () => undefined);
    const logger = { error: vi.fn() };
    const store = new RedisWindowStore(
      client,
      prefix,
      "test-secret",
      new MemoryWindowStore(new SystemClock()),
      logger,
    );
    let now = 0;
    const sleeps: number[] = [];
    const pacer = new SendPacer(
      8,
      () => now,
      (ms) => {
        sleeps.push(ms);
        now += ms;
        return Promise.resolve();
      },
      store,
    );
    const time = vi.spyOn(Date, "now").mockReturnValue(100_000);
    try {
      await new Promise<void>((resolve) => client.once("ready", resolve));
      const ended = new Promise<void>((resolve) => client.once("end", resolve));
      client.disconnect();
      await ended;
      await Promise.all([pacer.acquire(), pacer.acquire(), pacer.acquire()]);
      expect(sleeps).toEqual([125, 125]);
      expect(store.status).toBe("degraded");
      // A window failure uses the same reporting mechanism, not a second log budget.
      await store.hit("checkout", "test", { maxAttempts: 1, windowMinutes: 1 });
      expect(logger.error).toHaveBeenCalledExactlyOnceWith("rate_limit_store_unavailable");
      time.mockReturnValue(159_999);
      await pacer.acquire();
      expect(logger.error).toHaveBeenCalledTimes(1);
      time.mockReturnValue(160_000);
      await pacer.acquire();
      expect(logger.error).toHaveBeenCalledTimes(2);
      const otherSleeps: number[] = [];
      const other = new SendPacer(
        8,
        () => now,
        (ms) => {
          otherSleeps.push(ms);
          return Promise.resolve();
        },
        store,
      );
      await other.acquire();
      expect(otherSleeps).toEqual([]);
      await client.connect();
      await pacer.acquire();
      expect(store.status).toBe("redis");
    } finally {
      time.mockRestore();
      client.disconnect();
    }
  });

  it("refuses a large Redis backlog without sleeping or overflowing Node timers", async () => {
    const client = clients[0];
    const store = stores[0];
    if (client === undefined || store === undefined) throw new Error("Missing Redis store");
    const [seconds, micros] = await client.time();
    const now = Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
    await client.set(key, now + 2_147_483_647 + 60_000, "PX", 2_147_483_647 + 61_000);
    const before = await client.get(key);
    const sleep = vi.fn(async () => undefined);
    const pacer = new SendPacer(8, undefined, sleep, store);
    expect(await pacer.acquire(110_000)).toBe(false);
    expect(sleep).not.toHaveBeenCalled();
    expect(await client.get(key)).toBe(before);
  });

  it("reserves an immediate slot even with a fractional positive wait budget", async () => {
    const client = clients[0];
    const store = stores[0];
    if (client === undefined || store === undefined) throw new Error("Missing Redis store");
    const slot = await store.reserveEmailSlot(131, 0.5);
    expect(slot?.waitMs).toBe(0);
    expect(await client.get(key)).toBe(String((slot?.slotAt ?? NaN) + 131));
  });

  it("uses per-process pacing when Redis is unreachable", async () => {
    const client = new Redis("redis://127.0.0.1:1", {
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    client.on("error", () => undefined);
    const logger = { error: vi.fn() };
    const store = new RedisWindowStore(
      client,
      prefix,
      "test-secret",
      new MemoryWindowStore(new SystemClock()),
      logger,
    );
    let now = 0;
    const sleeps: number[] = [];
    const pacer = new SendPacer(
      8,
      () => now,
      (ms) => {
        sleeps.push(ms);
        now += ms;
        return Promise.resolve();
      },
      store,
    );
    try {
      await Promise.all([pacer.acquire(), pacer.acquire(), pacer.acquire()]);
      expect(sleeps).toEqual([125, 125]);
      expect(logger.error).toHaveBeenCalledExactlyOnceWith("rate_limit_store_unavailable");
      expect(store.status).toBe("degraded");
    } finally {
      client.disconnect();
    }
  });
});
