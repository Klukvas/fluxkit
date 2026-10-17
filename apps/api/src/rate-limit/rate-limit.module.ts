import { Global, Module, type DynamicModule } from "@nestjs/common";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { RATE_LIMIT_OVERRIDES, RateLimiter, type RateLimitOverrides } from "./rate-limiter.js";

/** Global so that any store controller can use `@RateLimit` without importing this module. Needs `CLOCK` (AuthModule). */
@Global()
@Module({})
export class RateLimitModule {
  static register(overrides: RateLimitOverrides = {}): DynamicModule {
    return {
      module: RateLimitModule,
      providers: [
        { provide: RATE_LIMIT_OVERRIDES, useValue: overrides },
        RateLimiter,
        RateLimitGuard,
      ],
      exports: [RateLimiter, RateLimitGuard],
    };
  }
}
