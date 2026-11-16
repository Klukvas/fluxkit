import { createHmac, hkdfSync } from "node:crypto";
import { Logger } from "@nestjs/common";
import { Redis } from "ioredis";
import { summarizeError } from "../common/error-summary.js";
import { throttleKeyOf, type WindowLimit } from "./ip-window-limiter.js";

export const STRICT_WINDOWS = Symbol("STRICT_WINDOWS");

/** One fixed window an attempt is counted in: a name (its own counter space), who is counted and the limit. */
export interface StrictWindow {
  readonly name: string;
  readonly key: string;
  readonly limit: WindowLimit;
}

/**
 * `unavailable` is its own answer: the caller refuses the action (503) and does no password hashing and no network
 * call. It is never turned into `allowed` and never counted in process memory (plan section 8, owner decision 4).
 */
export type StrictDecision =
  | { readonly outcome: "allowed" }
  | { readonly outcome: "denied"; readonly retryAfterSeconds: number }
  | { readonly outcome: "unavailable" };

/**
 * Fail-closed composite limits for the sensitive admin actions (ADR 0058). All windows of one attempt are consumed in a
 * single Redis script, a refused attempt included, so several limits cannot be raced or probed one at a time and every
 * API instance shares the counts. The ordinary `RateLimiter` keeps its own policy.
 */
export interface StrictWindows {
  attempt(windows: readonly StrictWindow[]): Promise<StrictDecision>;
}

// KEYS: one counter per window. ARGV: window lengths in ms, then the limits. Redis owns the time.
const STRICT_SCRIPT = `
local n = #KEYS
local retry = 0
for i = 1, n do
  local count = redis.call('INCR', KEYS[i])
  local ttl = redis.call('PTTL', KEYS[i])
  if ttl < 0 then
    redis.call('PEXPIRE', KEYS[i], ARGV[i])
    ttl = tonumber(ARGV[i])
  end
  if count > tonumber(ARGV[n + i]) and ttl > retry then retry = ttl end
end
return retry
`;

/** No Redis is configured: every strict attempt is `unavailable`. */
export class UnavailableStrictWindows implements StrictWindows {
  async attempt(): Promise<StrictDecision> {
    return { outcome: "unavailable" };
  }
}

export class RedisStrictWindows implements StrictWindows {
  private readonly hmacKey: Buffer;
  private connecting: Promise<void> | undefined;
  private lastReportMs = -Infinity;

  constructor(
    private readonly client: Redis,
    private readonly prefix: string,
    secret: string,
    private readonly logger: Pick<Logger, "error"> = new Logger(RedisStrictWindows.name),
  ) {
    this.hmacKey = Buffer.from(hkdfSync("sha256", secret, "", "strict-rate-limit", 32));
  }

  async attempt(windows: readonly StrictWindow[]): Promise<StrictDecision> {
    if (windows.length === 0) throw new Error("A strict attempt needs at least one window");
    const keys = windows.map((window) => this.keyOf(window));
    if (new Set(keys).size !== keys.length) {
      throw new Error("A strict attempt cannot name one window twice");
    }
    try {
      await this.connected();
      const result: unknown = await this.client.eval(
        STRICT_SCRIPT,
        keys.length,
        ...keys,
        ...windows.map((window) => window.limit.windowMinutes * 60_000),
        ...windows.map((window) => window.limit.maxAttempts),
      );
      if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0) {
        this.report("invalid answer");
        return { outcome: "unavailable" };
      }
      return result === 0
        ? { outcome: "allowed" }
        : { outcome: "denied", retryAfterSeconds: Math.max(1, Math.ceil(result / 1000)) };
    } catch (error) {
      // Transport errors may carry addresses or credentials: only the error class and code are logged.
      this.report(summarizeError(error));
      return { outcome: "unavailable" };
    }
  }

  /**
   * The connection opens with the first sensitive action, so a shop that never uses them needs no Redis at start.
   * Concurrent first attempts share one connect call (a second `connect()` on the same client rejects).
   */
  private async connected(): Promise<void> {
    if (this.client.status === "wait") {
      this.connecting ??= this.client.connect().finally(() => {
        this.connecting = undefined;
      });
    }
    if (this.connecting !== undefined) await this.connecting;
  }

  /** At most one line a minute, so an outage is diagnosable without flooding the log. */
  private report(summary: string): void {
    const now = Date.now();
    if (now - this.lastReportMs < 60_000) return;
    this.lastReportMs = now;
    this.logger.error(`strict_limits_unavailable: ${summary}`);
  }

  /** Nest calls this on shutdown (the instance is a module provider). */
  onApplicationShutdown(): void {
    this.client.disconnect();
  }

  private keyOf(window: StrictWindow): string {
    const digest = createHmac("sha256", this.hmacKey)
      .update(throttleKeyOf(window.key))
      .digest("hex");
    return `fluxkit:${this.prefix}:strict:${window.name}:${digest}`;
  }
}

/** A connection that never queues a command while Redis is away and never blocks the API start. */
export function createStrictRedisClient(url: string): Redis {
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: 3000,
    commandTimeout: 3000,
    maxRetriesPerRequest: 0,
  });
  client.on("error", () => undefined);
  return client;
}
