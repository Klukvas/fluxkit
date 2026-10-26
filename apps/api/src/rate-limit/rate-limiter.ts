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
  // ADR 0028: image uploads, per signed-in admin user (admins in one office share an address).
  mediaUpload: { maxAttempts: 60, windowMinutes: 10 },
  // ADR 0029 decision 13: the provider connection check calls a carrier under the shop's key; per signed-in admin user.
  shippingCheck: { maxAttempts: 30, windowMinutes: 10 },
  // ADR 0029 decision 5 (numbers fixed in plan step 6): the store options read the cart and may ask a carrier for an
  // estimate; the lookups proxy anonymous requests to a carrier under the shop's key (a picker types, debounced 300 ms).
  shippingOptions: { maxAttempts: 30, windowMinutes: 1 },
  shippingLookup: { maxAttempts: 60, windowMinutes: 1 },
  // ADR 0031 decision 16: the reset request per address and, counted by the service, per requested email (a mail bomb
  // against one inbox from many addresses); the token confirmations (reset and verify share one window); a new
  // verification mail per signed-in customer. The per-email database count of reset tokens spans instances.
  passwordReset: { maxAttempts: 5, windowMinutes: 15 },
  passwordResetEmail: { maxAttempts: 5, windowMinutes: 15 },
  passwordResetConfirm: { maxAttempts: 10, windowMinutes: 10 },
  verificationResend: { maxAttempts: 3, windowMinutes: 60 },
} satisfies Record<string, WindowLimit>);

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Who a limit counts: the client address (`request.ip`), the signed-in admin user of an `/admin` route, or a key the
 * service chooses (`account`: a requested email, a customer id), counted by the service itself with
 * `RateLimiter.attempt` because the guard cannot know the key before the body is read.
 */
export type RateLimitSubject = "clientAddress" | "adminUser" | "account";

/**
 * The subject of each named limit. It belongs to the limit, not to the route, so a route cannot count an upload by address
 * by mistake. `adminUser` needs a route behind `AdminGuard` (the guard sets the principal before route guards run).
 */
export const RATE_LIMIT_SUBJECTS: Readonly<Record<RateLimitName, RateLimitSubject>> = Object.freeze(
  {
    login: "clientAddress",
    registration: "clientAddress",
    checkout: "clientAddress",
    orderLookup: "clientAddress",
    guestCancel: "clientAddress",
    cartWrite: "clientAddress",
    mediaUpload: "adminUser",
    shippingCheck: "adminUser",
    shippingOptions: "clientAddress",
    shippingLookup: "clientAddress",
    passwordReset: "clientAddress",
    passwordResetEmail: "account",
    passwordResetConfirm: "clientAddress",
    verificationResend: "account",
  },
);

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

  /**
   * Counts one attempt of a client against the named limit. `client` is an address, or `admin-user:<id>` for a limit whose
   * subject is the admin user (text that is not an IP address is counted as is).
   */
  attempt(name: RateLimitName, client: string): ThrottleDecision {
    const limiter = this.limiters.get(name);
    if (limiter === undefined) {
      throw new Error(`Unknown rate limit "${String(name)}"`);
    }
    return limiter.attempt(client);
  }
}
