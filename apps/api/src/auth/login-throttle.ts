import { MemoryWindowStore, type WindowStore } from "../rate-limit/window-store.js";
import type { WindowLimit } from "../rate-limit/ip-window-limiter.js";
import {
  DEFAULT_MAX_CLIENTS,
  IpWindowLimiter,
  throttleKeyOf,
  type ThrottleDecision,
} from "../rate-limit/ip-window-limiter.js";
import type { Clock } from "./clock.js";

export { throttleKeyOf, type ThrottleDecision };

export const LOGIN_THROTTLE_DEFAULTS = Object.freeze({
  /** Login attempts (successful or not) one client may make per window. */
  maxAttempts: 20,
  windowMinutes: 10,
  /** Upper bound of tracked clients, so memory cannot grow with the number of distinct addresses. */
  maxClients: DEFAULT_MAX_CLIENTS,
});

export interface LoginThrottleOptions {
  maxAttempts?: number;
  windowMinutes?: number;
  maxClients?: number;
}

/** Admin login has its own named window; customer login uses `login` in RateLimiter. */
export class LoginThrottle {
  private readonly store: WindowStore;
  private readonly limit: WindowLimit;
  constructor(clock: Clock, options: LoginThrottleOptions = {}, store?: WindowStore) {
    this.limit = {
      maxAttempts: options.maxAttempts ?? LOGIN_THROTTLE_DEFAULTS.maxAttempts,
      windowMinutes: options.windowMinutes ?? LOGIN_THROTTLE_DEFAULTS.windowMinutes,
      maxClients: options.maxClients ?? LOGIN_THROTTLE_DEFAULTS.maxClients,
    };
    new IpWindowLimiter(clock, this.limit);
    this.store = store ?? new MemoryWindowStore(clock);
  }

  get size(): number {
    return this.store instanceof MemoryWindowStore ? this.store.size("adminLogin") : 0;
  }

  async attempt(client: string): Promise<ThrottleDecision> {
    return this.store.hit("adminLogin", client, this.limit);
  }
}
