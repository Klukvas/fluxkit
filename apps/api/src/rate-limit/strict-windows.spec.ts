import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { requireEnv } from "../test/env.js";
import {
  createStrictRedisClient,
  RedisStrictWindows,
  UnavailableStrictWindows,
  type StrictWindow,
} from "./strict-windows.js";

const prefix = `strict_${randomUUID()}`;
const secret = "test-strict-limit-secret-0123456789abcdef";
const clients = [
  createStrictRedisClient(requireEnv("REDIS_URL")),
  createStrictRedisClient(requireEnv("REDIS_URL")),
];
const [first, second] = clients.map((client) => new RedisStrictWindows(client, prefix, secret)) as [
  RedisStrictWindows,
  RedisStrictWindows,
];

function windows(admin: string, address: string, adminMax = 3, addressMax = 5): StrictWindow[] {
  return [
    { name: "stepUpAdmin", key: admin, limit: { maxAttempts: adminMax, windowMinutes: 15 } },
    { name: "stepUpAddress", key: address, limit: { maxAttempts: addressMax, windowMinutes: 15 } },
  ];
}

afterAll(async () => {
  const cleaner = new Redis(requireEnv("REDIS_URL"));
  let cursor = "0";
  do {
    const page = await cleaner.scan(cursor, "MATCH", `fluxkit:${prefix}:strict:*`, "COUNT", 100);
    cursor = page[0];
    if (page[1].length > 0) await cleaner.del(...page[1]);
  } while (cursor !== "0");
  await cleaner.quit();
  for (const client of clients) client.disconnect();
});

describe("strict composite windows (real Redis)", () => {
  it("connects on first use, allows up to the limit and then denies with the remaining wait", async () => {
    const attempt = () => first.attempt(windows("admin-user:a1", "203.0.113.1"));
    expect(await attempt()).toEqual({ outcome: "allowed" });
    expect(await attempt()).toEqual({ outcome: "allowed" });
    expect(await attempt()).toEqual({ outcome: "allowed" });
    const denied = await attempt();
    expect(denied.outcome).toBe("denied");
    if (denied.outcome === "denied") {
      expect(denied.retryAfterSeconds).toBeGreaterThan(890);
      expect(denied.retryAfterSeconds).toBeLessThanOrEqual(900);
    }
  });

  it("shares the counts between API instances", async () => {
    const attempt = (instance: RedisStrictWindows) =>
      instance.attempt(windows("admin-user:a2", "203.0.113.2"));
    expect((await attempt(first)).outcome).toBe("allowed");
    expect((await attempt(second)).outcome).toBe("allowed");
    expect((await attempt(first)).outcome).toBe("allowed");
    expect((await attempt(second)).outcome).toBe("denied");
  });

  it("denies when any one window is over, and a denied attempt still counts in every window", async () => {
    // Three admins behind one address: the address window (5) fills although no admin window (3) does.
    for (const admin of ["b1", "b1", "b2", "b2", "b3"]) {
      expect((await first.attempt(windows(`admin-user:${admin}`, "203.0.113.3"))).outcome).toBe(
        "allowed",
      );
    }
    expect((await first.attempt(windows("admin-user:b3", "203.0.113.3"))).outcome).toBe("denied");
    // That denied attempt consumed b3's own window too: one earlier success + the denied one + this one = 3 of 3.
    expect((await first.attempt(windows("admin-user:b3", "198.51.100.9"))).outcome).toBe("allowed");
    expect((await first.attempt(windows("admin-user:b3", "198.51.100.10"))).outcome).toBe("denied");
  });

  it("lets exactly the limit through under concurrency from two instances", async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, (_unused, index) =>
        (index % 2 === 0 ? first : second).attempt(
          windows("admin-user:c1", "203.0.113.4", 7, 1000),
        ),
      ),
    );
    expect(results.filter((result) => result.outcome === "allowed")).toHaveLength(7);
    expect(results.filter((result) => result.outcome === "denied")).toHaveLength(33);
  });

  it("concurrent first attempts on a fresh connection are all answered", async () => {
    const client = createStrictRedisClient(requireEnv("REDIS_URL"));
    const fresh = new RedisStrictWindows(client, prefix, secret);
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          fresh.attempt(windows("admin-user:f1", "203.0.113.8", 100, 100)),
        ),
      );
      expect(results.map((result) => result.outcome)).toEqual(Array(8).fill("allowed"));
    } finally {
      client.disconnect();
    }
  });

  it("counts an IPv6 /64 as one address", async () => {
    const attempt = (address: string) =>
      first.attempt(windows(`admin-user:${randomUUID()}`, address, 3, 2));
    expect((await attempt("2001:db8:7:1::1")).outcome).toBe("allowed");
    expect((await attempt("2001:DB8:7:1::2")).outcome).toBe("allowed");
    expect((await attempt("2001:db8:7:1:ffff::3")).outcome).toBe("denied");
  });

  it("stores no admin id or address in a key", async () => {
    await first.attempt(windows("admin-user:visible-id-SENTINEL", "192.0.2.77"));
    const reader = new Redis(requireEnv("REDIS_URL"));
    const [, keys] = await reader.scan("0", "MATCH", `fluxkit:${prefix}:strict:*`, "COUNT", 1000);
    await reader.quit();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.join(" ")).not.toContain("SENTINEL");
    expect(keys.join(" ")).not.toContain("192.0.2.77");
  });

  it("refuses a call without windows or with one window named twice", async () => {
    await expect(first.attempt([])).rejects.toThrow(/at least one window/);
    const [one] = windows("admin-user:d1", "203.0.113.5");
    if (one === undefined) throw new Error("fixture");
    await expect(first.attempt([one, one])).rejects.toThrow(/twice/);
  });
});

describe("strict windows without Redis", () => {
  it("answers unavailable when Redis cannot be reached, never allowed", async () => {
    // Port 1 on loopback: nothing listens there.
    const client = createStrictRedisClient("redis://127.0.0.1:1");
    const unreachable = new RedisStrictWindows(client, prefix, secret);
    try {
      expect(await unreachable.attempt(windows("admin-user:e1", "203.0.113.6"))).toEqual({
        outcome: "unavailable",
      });
      expect(await unreachable.attempt(windows("admin-user:e1", "203.0.113.6"))).toEqual({
        outcome: "unavailable",
      });
    } finally {
      client.disconnect();
    }
  });

  it("answers unavailable when no Redis is configured", async () => {
    expect(await new UnavailableStrictWindows().attempt()).toEqual({ outcome: "unavailable" });
  });
});
