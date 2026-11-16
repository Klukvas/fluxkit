import { Global, Module, type DynamicModule } from "@nestjs/common";
import { RedisClient } from "../common/redis/redis-client.js";
import { CLOCK, type Clock } from "../auth/clock.js";
import {
  WINDOW_STORE,
  MemoryWindowStore,
  RedisWindowStore,
  rateLimitPrefix,
} from "./window-store.js";

import { RateLimitGuard } from "./rate-limit.guard.js";
import {
  createStrictRedisClient,
  RedisStrictWindows,
  STRICT_WINDOWS,
  UnavailableStrictWindows,
} from "./strict-windows.js";
import { RATE_LIMIT_OVERRIDES, RateLimiter, type RateLimitOverrides } from "./rate-limiter.js";

export interface RateLimitStoreConfig {
  store: "memory" | "redis";
  /** Tests only: isolate counters without changing the shared database. */
  prefix?: string;
  redisUrl?: string | undefined;
  databaseUrl: string;
  secret?: string | undefined;
}

/** Global so that any store controller can use `@RateLimit` without importing this module. Needs `CLOCK` (AuthModule). */
@Global()
@Module({})
export class RateLimitModule {
  static register(
    overrides: RateLimitOverrides = {},
    config?: RateLimitStoreConfig,
  ): DynamicModule {
    if (config?.store === "redis" && (!config.redisUrl || !config.secret)) {
      throw new Error("Redis rate limits require REDIS_URL and ORDER_TOKEN_SECRET");
    }
    return {
      module: RateLimitModule,
      providers: [
        ...(config?.store === "redis"
          ? [{ provide: RedisClient, useFactory: () => new RedisClient(config.redisUrl ?? "") }]
          : []),
        {
          provide: WINDOW_STORE,
          inject: config?.store === "redis" ? [CLOCK, RedisClient] : [CLOCK],
          useFactory: (clock: Clock, redis?: RedisClient) => {
            const memory = new MemoryWindowStore(clock);
            return redis === undefined || config === undefined
              ? memory
              : new RedisWindowStore(
                  redis.client,
                  config.prefix ?? rateLimitPrefix(config.databaseUrl),
                  config.secret ?? "",
                  memory,
                );
          },
        },
        {
          // Strict limits need Redis whatever RATE_LIMIT_STORE says; without REDIS_URL the sensitive actions answer 503.
          provide: STRICT_WINDOWS,
          useFactory: () =>
            config?.redisUrl && config.secret
              ? new RedisStrictWindows(
                  createStrictRedisClient(config.redisUrl),
                  config.prefix ?? rateLimitPrefix(config.databaseUrl),
                  config.secret,
                )
              : new UnavailableStrictWindows(),
        },
        { provide: RATE_LIMIT_OVERRIDES, useValue: overrides },
        RateLimiter,
        RateLimitGuard,
      ],
      exports: [RateLimiter, RateLimitGuard, WINDOW_STORE, STRICT_WINDOWS],
    };
  }
}
