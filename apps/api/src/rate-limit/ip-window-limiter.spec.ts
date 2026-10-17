import { describe, expect, it } from "vitest";
import { LOGIN_THROTTLE_DEFAULTS, LoginThrottle } from "../auth/login-throttle.js";
import { FakeClock } from "../test/fake-clock.js";
import { IpWindowLimiter, throttleKeyOf } from "./ip-window-limiter.js";

const START = "2030-05-01T10:00:00.000Z";

describe("IpWindowLimiter (generalized from the admin login throttle)", () => {
  it("applies the limit it was given, not the login one", () => {
    const clock = new FakeClock(START);
    const limiter = new IpWindowLimiter(clock, { maxAttempts: 3, windowMinutes: 2 });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(limiter.attempt("10.0.0.1"), `attempt ${attempt}`).toEqual({ allowed: true });
    }
    clock.advanceMinutes(1);
    expect(limiter.attempt("10.0.0.1")).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it("starts a new window exactly when the window ends and not one millisecond before", () => {
    const clock = new FakeClock(START);
    const limiter = new IpWindowLimiter(clock, { maxAttempts: 1, windowMinutes: 1 });
    limiter.attempt("10.0.0.1");
    clock.set(new Date(Date.parse(START) + 60_000 - 1));
    expect(limiter.attempt("10.0.0.1").allowed).toBe(false);
    clock.set(new Date(Date.parse(START) + 60_000));
    expect(limiter.attempt("10.0.0.1")).toEqual({ allowed: true });
  });

  it("does not extend the window when attempts are refused", () => {
    const clock = new FakeClock(START);
    const limiter = new IpWindowLimiter(clock, { maxAttempts: 2, windowMinutes: 5 });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      limiter.attempt("10.0.0.1");
      clock.advanceMinutes(0.4);
    }
    clock.set(new Date(Date.parse(START) + 5 * 60_000));
    expect(limiter.attempt("10.0.0.1")).toEqual({ allowed: true });
  });

  it("counts every key separately", () => {
    const limiter = new IpWindowLimiter(new FakeClock(START), { maxAttempts: 1, windowMinutes: 1 });
    expect(limiter.attempt("10.0.0.1").allowed).toBe(true);
    expect(limiter.attempt("10.0.0.1").allowed).toBe(false);
    expect(limiter.attempt("10.0.0.2").allowed).toBe(true);
  });

  it("two limiters never share counts, even for the same address", () => {
    const clock = new FakeClock(START);
    const first = new IpWindowLimiter(clock, { maxAttempts: 1, windowMinutes: 1 });
    const second = new IpWindowLimiter(clock, { maxAttempts: 1, windowMinutes: 1 });
    expect(first.attempt("10.0.0.1").allowed).toBe(true);
    expect(first.attempt("10.0.0.1").allowed).toBe(false);
    expect(second.attempt("10.0.0.1").allowed).toBe(true);
  });

  it("keys IPv6 clients by /64: rotating the host part does not escape the limit", () => {
    const limiter = new IpWindowLimiter(new FakeClock(START), { maxAttempts: 3, windowMinutes: 1 });
    for (let host = 1; host <= 3; host += 1) {
      expect(limiter.attempt(`2001:db8:1:2::${host}`).allowed).toBe(true);
    }
    expect(limiter.attempt("2001:db8:1:2:ffff:ffff:ffff:ffff").allowed).toBe(false);
    expect(limiter.attempt("2001:db8:1:3::1").allowed).toBe(true);
    expect(limiter.size).toBe(2);
  });

  it("counts a mapped IPv4 address together with the plain one", () => {
    const limiter = new IpWindowLimiter(new FakeClock(START), { maxAttempts: 1, windowMinutes: 1 });
    limiter.attempt("::ffff:10.9.9.9");
    expect(limiter.attempt("10.9.9.9").allowed).toBe(false);
    expect(throttleKeyOf("::ffff:10.9.9.9")).toBe("10.9.9.9");
  });

  it("bounds its memory with maxClients", () => {
    const limiter = new IpWindowLimiter(new FakeClock(START), {
      maxAttempts: 5,
      windowMinutes: 10,
      maxClients: 50,
    });
    for (let client = 0; client < 1000; client += 1) {
      limiter.attempt(`10.4.${Math.floor(client / 256)}.${client % 256}`);
      expect(limiter.size).toBeLessThanOrEqual(50);
    }
  });

  it("rejects nonsense limits instead of silently allowing everything", () => {
    const clock = new FakeClock(START);
    expect(() => new IpWindowLimiter(clock, { maxAttempts: 0, windowMinutes: 1 })).toThrow(
      RangeError,
    );
    expect(() => new IpWindowLimiter(clock, { maxAttempts: 1, windowMinutes: 0 })).toThrow(
      RangeError,
    );
    expect(() => new IpWindowLimiter(clock, { maxAttempts: 1.5, windowMinutes: 1 })).toThrow(
      RangeError,
    );
    expect(
      () => new IpWindowLimiter(clock, { maxAttempts: 1, windowMinutes: 1, maxClients: 0 }),
    ).toThrow(RangeError);
  });
});

describe("the admin login throttle is the same limiter with the admin limit", () => {
  it("is an IpWindowLimiter with 20 attempts per 10 minutes", () => {
    const clock = new FakeClock(START);
    const throttle = new LoginThrottle(clock);
    expect(throttle).toBeInstanceOf(IpWindowLimiter);
    expect(LOGIN_THROTTLE_DEFAULTS).toEqual({
      maxAttempts: 20,
      windowMinutes: 10,
      maxClients: 10_000,
    });
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      expect(throttle.attempt("10.0.0.1").allowed, `attempt ${attempt}`).toBe(true);
    }
    expect(throttle.attempt("10.0.0.1")).toEqual({ allowed: false, retryAfterSeconds: 600 });
  });
});
