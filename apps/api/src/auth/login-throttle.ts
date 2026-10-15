import type { Clock } from "./clock.js";

export const LOGIN_THROTTLE_DEFAULTS = Object.freeze({
  /** Login attempts (successful or not) one client may make per window. */
  maxAttempts: 20,
  windowMinutes: 10,
  /** Upper bound of tracked clients, so memory cannot grow with the number of distinct addresses. */
  maxClients: 10_000,
});

export interface LoginThrottleOptions {
  maxAttempts?: number;
  windowMinutes?: number;
  maxClients?: number;
}

export type ThrottleDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

interface Window {
  startedAtMs: number;
  attempts: number;
}

function requirePositiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be an integer of at least 1`);
  }
  return value;
}

/**
 * Per client address limit on login attempts: a fixed window kept IN MEMORY (ADR 0009, plan "Login throttling").
 *
 * Limits of this design, on purpose:
 * - Single process only. Each API instance counts alone and a restart forgets everything, so N instances allow N
 *   times the limit. The per-account lockout (database columns) is the limit that spans instances; a shared IP limit
 *   needs Redis and is a follow-up of the plan.
 * - Behind a reverse proxy `request.ip` is the proxy's address unless Express `trust proxy` is configured, in which
 *   case all clients share one window. Deployment is not built yet; configure the proxy setting with it.
 * - The map holds at most `maxClients` entries. Expired windows are dropped first; when the map is still full the
 *   OLDEST window is evicted. An attacker with millions of addresses can therefore make the limit forget some
 *   clients, but can never make memory grow.
 *
 * The map is in insertion order and a window is re-inserted when it restarts, so the oldest windows come first.
 */
export class LoginThrottle {
  private readonly windows = new Map<string, Window>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly maxClients: number;
  private lastSweepMs: number;

  constructor(
    private readonly clock: Clock,
    options: LoginThrottleOptions = {},
  ) {
    this.maxAttempts = requirePositiveInteger(
      "maxAttempts",
      options.maxAttempts ?? LOGIN_THROTTLE_DEFAULTS.maxAttempts,
    );
    this.windowMs =
      requirePositiveInteger(
        "windowMinutes",
        options.windowMinutes ?? LOGIN_THROTTLE_DEFAULTS.windowMinutes,
      ) * 60_000;
    this.maxClients = requirePositiveInteger(
      "maxClients",
      options.maxClients ?? LOGIN_THROTTLE_DEFAULTS.maxClients,
    );
    this.lastSweepMs = this.clock.now().getTime();
  }

  /** Number of tracked clients (for tests and diagnostics). */
  get size(): number {
    return this.windows.size;
  }

  /** Counts one attempt of `clientId`. Attempts beyond the limit are refused and do not extend the window. */
  attempt(clientId: string): ThrottleDecision {
    const nowMs = this.clock.now().getTime();
    if (nowMs - this.lastSweepMs >= this.windowMs) {
      this.dropExpired(nowMs);
    }
    const current = this.windows.get(clientId);
    if (current !== undefined && nowMs - current.startedAtMs < this.windowMs) {
      if (current.attempts >= this.maxAttempts) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((current.startedAtMs + this.windowMs - nowMs) / 1000),
          ),
        };
      }
      current.attempts += 1;
      return { allowed: true };
    }
    // New client, or its window ended: start a fresh one at the end of the insertion order.
    this.windows.delete(clientId);
    if (this.windows.size >= this.maxClients) {
      this.dropExpired(nowMs);
    }
    while (this.windows.size >= this.maxClients) {
      const oldest = this.windows.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.windows.delete(oldest.value);
    }
    this.windows.set(clientId, { startedAtMs: nowMs, attempts: 1 });
    return { allowed: true };
  }

  private dropExpired(nowMs: number): void {
    for (const [clientId, window] of this.windows) {
      if (nowMs - window.startedAtMs < this.windowMs) {
        // Insertion order is start order, so everything after this one is still open.
        break;
      }
      this.windows.delete(clientId);
    }
    this.lastSweepMs = nowMs;
  }
}
