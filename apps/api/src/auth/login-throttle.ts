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

/**
 * Per client address limit on ADMIN login attempts (ADR 0009, plan "Login throttling"): the generic in-memory window
 * (`IpWindowLimiter`, which documents its limits: single process, IPv6 by /64, `trust proxy`) with the admin
 * limit. Customer login uses the named `login` limit of `RateLimiter`, a separate window.
 */
export class LoginThrottle extends IpWindowLimiter {
  constructor(clock: Clock, options: LoginThrottleOptions = {}) {
    super(clock, {
      maxAttempts: options.maxAttempts ?? LOGIN_THROTTLE_DEFAULTS.maxAttempts,
      windowMinutes: options.windowMinutes ?? LOGIN_THROTTLE_DEFAULTS.windowMinutes,
      maxClients: options.maxClients ?? LOGIN_THROTTLE_DEFAULTS.maxClients,
    });
  }
}
