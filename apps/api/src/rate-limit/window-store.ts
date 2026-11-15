import { createHmac, hkdfSync } from "node:crypto";
import { Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import type { Clock } from "../auth/clock.js";
import {
  IpWindowLimiter,
  throttleKeyOf,
  type ThrottleDecision,
  type WindowLimit,
} from "./ip-window-limiter.js";

export const WINDOW_STORE = Symbol("WINDOW_STORE");
export type WindowStoreStatus = "memory" | "redis" | "degraded";
export interface WindowStore {
  readonly status: WindowStoreStatus;
  hit(name: string, key: string, limit: WindowLimit): Promise<ThrottleDecision>;
}

/** Retains the original fixed windows, /64 normalization, and oldest-client eviction. */
export class MemoryWindowStore implements WindowStore {
  readonly status = "memory";
  private readonly windows = new Map<string, IpWindowLimiter>();
  constructor(private readonly clock: Clock) {}

  async hit(name: string, key: string, limit: WindowLimit): Promise<ThrottleDecision> {
    let window = this.windows.get(name);
    if (window === undefined) {
      window = new IpWindowLimiter(this.clock, limit);
      this.windows.set(name, window);
    }
    return window.attempt(key);
  }

  size(name: string): number {
    return this.windows.get(name)?.size ?? 0;
  }
}

// A single round trip: Redis owns the time, including TTL and the boundary between windows.
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1], 'NX') end
return {count, redis.call('PTTL', KEYS[1])}
`;

export class RedisWindowStore implements WindowStore {
  private readonly hmacKey: Buffer;
  private degraded = false;
  private lastErrorMs = -Infinity;

  constructor(
    private readonly client: Redis,
    private readonly prefix: string,
    secret: string,
    private readonly fallback: MemoryWindowStore,
    private readonly logger: Pick<Logger, "error"> = new Logger(RedisWindowStore.name),
  ) {
    this.hmacKey = Buffer.from(hkdfSync("sha256", secret, "", "rate-limit", 32));
  }

  get status(): WindowStoreStatus {
    return this.degraded || this.client.status !== "ready" ? "degraded" : "redis";
  }

  async hit(name: string, key: string, limit: WindowLimit): Promise<ThrottleDecision> {
    const digest = createHmac("sha256", this.hmacKey).update(throttleKeyOf(key)).digest("hex");
    try {
      const result: unknown = await this.client.eval(
        HIT_SCRIPT,
        1,
        `fluxkit:${this.prefix}:rl:${name}:${digest}`,
        limit.windowMinutes * 60_000,
      );
      if (
        !Array.isArray(result) ||
        result.length !== 2 ||
        typeof result[0] !== "number" ||
        typeof result[1] !== "number" ||
        result[1] < 0
      ) {
        throw new Error("rate_limit_store_invalid_answer");
      }
      this.degraded = false;
      return result[0] <= limit.maxAttempts
        ? { allowed: true }
        : { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(result[1] / 1000)) };
    } catch {
      this.degraded = true;
      const now = Date.now();
      if (now - this.lastErrorMs >= 60_000) {
        this.lastErrorMs = now;
        this.logger.error("rate_limit_store_unavailable");
      }
      return this.fallback.hit(name, key, limit);
    }
  }
}

/** Encode the database name as one namespace segment, with no URL credentials. */
export function rateLimitPrefix(databaseUrl: string): string {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (name.length === 0) throw new Error("Rate limit Redis requires a database name");
  return encodeURIComponent(name);
}
