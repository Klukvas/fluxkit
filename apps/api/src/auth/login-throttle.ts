import { isIPv6 } from "node:net";
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

/** Parses a valid IPv6 text (zone id and embedded IPv4 tail allowed) into its eight 16-bit groups. */
function ipv6Groups(address: string): number[] | undefined {
  if (!isIPv6(address)) {
    return undefined;
  }
  let text = (address.split("%")[0] ?? "").toLowerCase();
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.split(".").map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", rest, extra] = text.split("::");
  if (extra !== undefined) {
    return undefined;
  }
  const headGroups = head === "" ? [] : head.split(":");
  const restGroups = rest === undefined || rest === "" ? [] : rest.split(":");
  const missing = rest === undefined ? 0 : 8 - headGroups.length - restGroups.length;
  const groups = [...headGroups, ...Array<string>(Math.max(0, missing)).fill("0"), ...restGroups];
  return groups.length === 8 ? groups.map((group) => Number.parseInt(group, 16)) : undefined;
}

/**
 * The key a client address is counted under. IPv4 is used as is. IPv6 is keyed by its /64 prefix, because one
 * subscriber normally owns a whole /64 (2^64 addresses) and could otherwise rotate addresses to dodge the limit;
 * the key is canonical (case, compression, zone id). An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) is the IPv4
 * address. Text that is not an IP address is returned unchanged, so it is still counted (and limited).
 */
export function throttleKeyOf(address: string): string {
  const groups = ipv6Groups(address);
  if (groups === undefined) {
    return address;
  }
  const isMappedIpv4 = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (isMappedIpv4) {
    const [high = 0, low = 0] = groups.slice(6);
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

/**
 * Per client address limit on login attempts: a fixed window kept IN MEMORY (ADR 0009, plan "Login throttling").
 *
 * Limits of this design, on purpose:
 * - IPv6 clients are counted per /64 prefix, so one subscriber cannot multiply the limit by rotating addresses; the
 *   price is that everybody behind one /64 shares a window.
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

  /** Counts one attempt of the client at `address` (IPv6 by /64, see `throttleKeyOf`). Attempts beyond the limit are refused and do not extend the window. */
  attempt(address: string): ThrottleDecision {
    const clientId = throttleKeyOf(address);
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
