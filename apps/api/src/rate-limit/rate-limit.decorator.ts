import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { RATE_LIMIT_KEY, type RateLimitName } from "./rate-limiter.js";

/**
 * Limits a route per client address with the named limit (`RATE_LIMITS`). Over the limit the answer is
 * `429 too_many_requests` with `Retry-After`. Counted before the handler runs, so refused calls cost nothing.
 */
export const RateLimit = (name: RateLimitName): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(RATE_LIMIT_KEY, name), UseGuards(RateLimitGuard));
