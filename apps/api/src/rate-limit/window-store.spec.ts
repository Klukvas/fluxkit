import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SystemClock } from "../auth/clock.js";
import { requireEnv } from "../test/env.js";
import { RateLimiter } from "./rate-limiter.js";
import { MemoryWindowStore, RedisWindowStore, rateLimitPrefix } from "./window-store.js";

const prefix = `limits_${randomUUID()}`;
const secret = "test-rate-limit-secret-0123456789abcdef";
const limit = { maxAttempts: 2, windowMinutes: 1 };
const clock = new SystemClock();
const clients = [new Redis(requireEnv("REDIS_URL")), new Redis(requireEnv("REDIS_URL"))];
const stores = clients.map(
  (client) => new RedisWindowStore(client, prefix, secret, new MemoryWindowStore(clock)),
);
const first = new RateLimiter(clock, { checkout: limit }, stores[0]);
const second = new RateLimiter(clock, { checkout: limit }, stores[1]);

beforeAll(async () => {
  await Promise.all(clients.map((client) => client.ping()));
});
afterAll(async () => {
  for (const client of clients) {
    let cursor = "0";
    do {
      const page = await client.scan(cursor, "MATCH", `fluxkit:${prefix}:rl:*`, "COUNT", 100);
      cursor = page[0];
      if (page[1].length > 0) await client.del(...page[1]);
    } while (cursor !== "0");
    await client.quit();
  }
});

describe("shared fixed windows (real Redis)", () => {
  it("shares one count between clients and returns the remaining TTL", async () => {
    expect(await first.attempt("checkout", "203.0.113.7")).toEqual({ allowed: true });
    expect(await second.attempt("checkout", "203.0.113.7")).toEqual({ allowed: true });
    expect(await first.attempt("checkout", "203.0.113.7")).toMatchObject({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });
  it("groups IPv6 /64 across clients", async () => {
    await first.attempt("checkout", "2001:db8:1:2::1");
    await second.attempt("checkout", "2001:DB8:1:2::2");
    expect((await first.attempt("checkout", "2001:db8:1:2:ffff::3")).allowed).toBe(false);
    expect((await second.attempt("checkout", "2001:db8:1:3::1")).allowed).toBe(true);
  });
  it.each(["passwordResetEmail", "verificationResend", "dataExport", "accountDelete"] as const)(
    "shares %s per account and keeps other accounts separate",
    async (name) => {
      const key =
        name === "passwordResetEmail"
          ? "email:shopper@example.test"
          : "customer:private-customer-id";
      const maximum = name === "verificationResend" ? 3 : 5;
      for (let attempt = 0; attempt < maximum; attempt += 1) {
        expect((await (attempt % 2 === 0 ? first : second).attempt(name, key)).allowed).toBe(true);
      }
      expect((await second.attempt(name, key)).allowed).toBe(false);
      expect((await first.attempt(name, `${key}-other`)).allowed).toBe(true);
    },
  );
  it("expires a short window without extending it on rejection", async () => {
    const store = stores[0];
    if (store === undefined) throw new Error("Missing test store");
    const short = { maxAttempts: 1, windowMinutes: 1 / 60 };
    expect((await store.hit("short", "expiry", short)).allowed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(await store.hit("short", "expiry", short)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect((await store.hit("short", "expiry", short)).allowed).toBe(true);
  });
  it("stores only HMAC keys and numeric counts with bounded TTL", async () => {
    const client = clients[0];
    if (client === undefined) throw new Error("Missing test client");
    let cursor = "0";
    let count = 0;
    do {
      const page = await client.scan(cursor, "MATCH", `fluxkit:${prefix}:rl:*`, "COUNT", 100);
      cursor = page[0];
      for (const key of page[1]) {
        count += 1;
        expect(key).toMatch(/:rl:[a-zA-Z]+:[a-f0-9]{64}$/);
        expect(key).not.toMatch(/203\.0|2001:|shopper|example|private-customer-id/);
        expect(await client.get(key)).toMatch(/^\d+$/);
        expect(await client.pttl(key)).toBeGreaterThan(0);
      }
    } while (cursor !== "0");
    expect(count).toBeGreaterThan(0);
  });
  it("falls back per process on a closed port, logs at most once per minute", async () => {
    const offline = new Redis("redis://127.0.0.1:1", {
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    offline.on("error", () => undefined);
    const logger = { error: vi.fn() };
    const fallback = new RedisWindowStore(
      offline,
      prefix,
      secret,
      new MemoryWindowStore(clock),
      logger,
    );
    const time = vi.spyOn(Date, "now").mockReturnValue(100_000);
    try {
      expect((await fallback.hit("offline", "private", limit)).allowed).toBe(true);
      expect((await fallback.hit("offline", "private", limit)).allowed).toBe(true);
      expect((await fallback.hit("offline", "private", limit)).allowed).toBe(false);
      expect(fallback.status).toBe("degraded");
      expect(logger.error).toHaveBeenCalledExactlyOnceWith("rate_limit_store_unavailable");
      time.mockReturnValue(159_999);
      await fallback.hit("offline", "private", limit);
      expect(logger.error).toHaveBeenCalledTimes(1);
      time.mockReturnValue(160_000);
      await fallback.hit("offline", "private", limit);
      expect(logger.error).toHaveBeenCalledTimes(2);
      const otherProcess = new RedisWindowStore(
        offline,
        prefix,
        secret,
        new MemoryWindowStore(clock),
        { error: vi.fn() },
      );
      expect((await otherProcess.hit("offline", "private", limit)).allowed).toBe(true);
    } finally {
      time.mockRestore();
      offline.disconnect();
    }
  });
});

it("uses one atomic count even with concurrent requests from separate clients", async () => {
  const decisions = await Promise.all(
    Array.from({ length: 30 }, (_, attempt) =>
      (attempt % 2 === 0 ? first : second).attempt("checkout", "203.0.113.99"),
    ),
  );
  expect(decisions.filter((decision) => decision.allowed)).toHaveLength(2);
});

it("restores shared storage after a runtime connection loss", async () => {
  const client = new Redis(requireEnv("REDIS_URL"), { enableOfflineQueue: false });
  const store = new RedisWindowStore(client, prefix, secret, new MemoryWindowStore(clock), {
    error: vi.fn(),
  });
  try {
    await new Promise<void>((resolve) => client.once("ready", resolve));
    expect((await store.hit("recovery", "subject", limit)).allowed).toBe(true);
    const ended = new Promise<void>((resolve) => client.once("end", resolve));
    client.disconnect();
    await ended;
    expect((await store.hit("recovery", "subject", limit)).allowed).toBe(true);
    expect(store.status).toBe("degraded");
    await client.connect();
    expect((await store.hit("recovery", "subject", limit)).allowed).toBe(true);
    expect(store.status).toBe("redis");
    expect((await store.hit("recovery", "subject", limit)).allowed).toBe(false);
  } finally {
    client.disconnect();
  }
});

it("derives the namespace only from the database name", () => {
  expect(rateLimitPrefix("postgres://user:password@127.0.0.1:5432/shop_test?sslmode=disable")).toBe(
    "shop_test",
  );
  expect(rateLimitPrefix("postgres://other:credentials@elsewhere/shop_test")).toBe("shop_test");
  expect(rateLimitPrefix("postgres://user@localhost/shop%3Aone")).toBe("shop%3Aone");
  expect(() => rateLimitPrefix("postgres://localhost/")).toThrow(/database name/);
});
