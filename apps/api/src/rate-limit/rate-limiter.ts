import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "../auth/clock.js";
import { IpWindowLimiter, type ThrottleDecision, type WindowLimit } from "./ip-window-limiter.js";

/**
 * The named per-address limits of the store (ADR 0016, plan "Config" and "Security"). The numbers are internal
 * defaults, not a public contract. `login` and `registration` are for the customer routes of step 3b; the admin login
 * keeps its own `LoginThrottle` window.
 */
export const RATE_LIMITS = Object.freeze({
  login: { maxAttempts: 20, windowMinutes: 10 },
  registration: { maxAttempts: 10, windowMinutes: 60 },
  checkout: { maxAttempts: 10, windowMinutes: 10 },
  orderLookup: { maxAttempts: 20, windowMinutes: 10 },
  guestCancel: { maxAttempts: 20, windowMinutes: 10 },
  cartWrite: { maxAttempts: 120, windowMinutes: 1 },
} satisfies Record<string, WindowLimit>);

export type RateLimitName = keyof typeof RATE_LIMITS;

export const RATE_LIMIT_NAMES = Object.freeze(Object.keys(RATE_LIMITS) as RateLimitName[]);

export type RateLimitOverrides = Partial<Record<RateLimitName, WindowLimit>>;

/** Metadata key set by `@RateLimit` and read by `RateLimitGuard`. */
export const RATE_LIMIT_KEY = "fluxkit:rate-limit";

export const RATE_LIMIT_OVERRIDES = Symbol("RATE_LIMIT_OVERRIDES");

/**
 * Several named in-memory windows, one `IpWindowLimiter` per name, so exhausting one limit (checkout) never affects
 * another (login) for the same address. Single process only (see `IpWindowLimiter`).
 */
@Injectable()
export class RateLimiter {
  private readonly limiters = new Map<RateLimitName, IpWindowLimiter>();

  constructor(
    @Inject(CLOCK) clock: Clock,
    @Inject(RATE_LIMIT_OVERRIDES) overrides: RateLimitOverrides = {},
  ) {
    for (const name of RATE_LIMIT_NAMES) {
      this.limiters.set(name, new IpWindowLimiter(clock, overrides[name] ?? RATE_LIMITS[name]));
    }
  }

  /** Counts one attempt of the client at `address` against the named limit. */
  attempt(name: RateLimitName, address: string): ThrottleDecision {
    const limiter = this.limiters.get(name);
    if (limiter === undefined) {
      throw new Error(`Unknown rate limit "${String(name)}"`);
    }
    return limiter.attempt(address);
  }
}
