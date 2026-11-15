import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { Logger } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RedisClient } from "../common/redis/redis-client.js";
import { startApp, type RunningApp } from "../test/app.js";
import { requireEnv } from "../test/env.js";
import { http } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import { RateLimiter } from "./rate-limiter.js";

const prefix = `login_${randomUUID()}`;
const redisUrl = requireEnv("REDIS_URL");
const apps: RunningApp[] = [];

beforeAll(async () => {
  await ensureMigrated();
  // Start sequentially: both apps use the same database and Redis, with separate connections.
  for (let index = 0; index < 2; index += 1) {
    apps.push(
      await startApp({
        adminAuthenticator: "production-default",
        trustProxy: 1,
        rateLimitStore: "redis",
        redisUrl,
        rateLimitKeyPrefix: prefix,
      }),
    );
  }
});
afterAll(async () => {
  await Promise.all(apps.map((running) => running.app.close()));
  const cleanup = new Redis(redisUrl);
  try {
    let cursor = "0";
    do {
      const page = await cleanup.scan(cursor, "MATCH", `fluxkit:${prefix}:rl:*`, "COUNT", 100);
      cursor = page[0];
      if (page[1].length > 0) await cleanup.del(...page[1]);
    } while (cursor !== "0");
  } finally {
    await cleanup.quit();
  }
});

function appAt(index: number): RunningApp {
  const running = apps[index];
  if (running === undefined) throw new Error("Test app missing");
  return running;
}

describe("login across two Nest apps", () => {
  it.each(["/admin/auth/login", "/store/account/login"])(
    "shares the address window of %s and refuses on either app",
    async (path) => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const response = await http(appAt(attempt % 2).baseUrl, "POST", path, {
          body: { email: "nobody@example.test", password: "correct horse battery staple" },
          headers: { "x-forwarded-for": "203.0.113.44" },
        });
        expect(response.status, `attempt ${attempt + 1}`).toBe(401);
      }
      for (const running of apps) {
        const response = await http(running.baseUrl, "POST", path, {
          body: { email: "nobody@example.test", password: "correct horse battery staple" },
          headers: { "x-forwarded-for": "203.0.113.44" },
        });
        expect(response.status).toBe(429);
        expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(590);
      }
    },
  );

  it("reports redis, then degraded readiness and still limits locally on runtime loss", async () => {
    const running = appAt(0);
    expect((await http(running.baseUrl, "GET", "/health")).body).toEqual({
      status: "ok",
      rateLimitStore: "redis",
    });
    running.app.get(RedisClient).client.disconnect();
    const logger = vi.spyOn(Logger.prototype, "error");
    try {
      const limiter = running.app.get(RateLimiter);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        expect((await limiter.attempt("checkout", "203.0.113.55")).allowed).toBe(true);
      }
      expect((await limiter.attempt("checkout", "203.0.113.55")).allowed).toBe(false);
      expect(logger).toHaveBeenCalledExactlyOnceWith("rate_limit_store_unavailable");
      expect((await http(running.baseUrl, "GET", "/health")).body).toEqual({
        status: "ok",
        rateLimitStore: "degraded",
      });
      // The other process has its own fallback and continues using Redis.
      expect(
        (await appAt(1).app.get(RateLimiter).attempt("checkout", "203.0.113.55")).allowed,
      ).toBe(true);
    } finally {
      logger.mockRestore();
    }
  });
});

it("fails loudly at boot if Redis is unreachable and closes its client", async () => {
  const redis = new RedisClient("redis://127.0.0.1:1");
  await expect(redis.onModuleInit()).rejects.toThrow("rate_limit_redis_boot_unavailable");
  expect(redis.client.status).not.toBe("ready");
  redis.onApplicationShutdown();
});
