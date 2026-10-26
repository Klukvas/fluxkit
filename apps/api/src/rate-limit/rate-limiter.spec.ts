import { describe, expect, it } from "vitest";
import { FakeClock } from "../test/fake-clock.js";
import { RATE_LIMITS, RATE_LIMIT_NAMES, RATE_LIMIT_SUBJECTS, RateLimiter } from "./rate-limiter.js";

const START = "2030-05-01T10:00:00.000Z";

describe("RATE_LIMITS (internal defaults of ADR 0016 and the cart plan)", () => {
  it("has exactly the limits of the plan", () => {
    expect(RATE_LIMITS).toEqual({
      login: { maxAttempts: 20, windowMinutes: 10 },
      registration: { maxAttempts: 10, windowMinutes: 60 },
      checkout: { maxAttempts: 10, windowMinutes: 10 },
      orderLookup: { maxAttempts: 20, windowMinutes: 10 },
      guestCancel: { maxAttempts: 20, windowMinutes: 10 },
      cartWrite: { maxAttempts: 120, windowMinutes: 1 },
      mediaUpload: { maxAttempts: 60, windowMinutes: 10 },
      shippingCheck: { maxAttempts: 30, windowMinutes: 10 },
      shippingOptions: { maxAttempts: 30, windowMinutes: 1 },
      shippingLookup: { maxAttempts: 60, windowMinutes: 1 },
      passwordReset: { maxAttempts: 5, windowMinutes: 15 },
      passwordResetEmail: { maxAttempts: 5, windowMinutes: 15 },
      passwordResetConfirm: { maxAttempts: 10, windowMinutes: 10 },
      verificationResend: { maxAttempts: 3, windowMinutes: 60 },
      emailTest: { maxAttempts: 5, windowMinutes: 60 },
    });
    expect([...RATE_LIMIT_NAMES].sort()).toEqual(Object.keys(RATE_LIMITS).sort());
  });

  it("counts every limit per client address, except mediaUpload, shippingCheck and emailTest (per admin user, ADR 0028, ADR 0029, ADR 0031) and the per-email and per-customer limits of ADR 0031 (counted by their service)", () => {
    expect(RATE_LIMIT_SUBJECTS).toEqual({
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
      emailTest: "adminUser",
    });
    expect(Object.isFrozen(RATE_LIMIT_SUBJECTS)).toBe(true);
  });
});

describe("RateLimiter (named limits, per client address)", () => {
  it.each(RATE_LIMIT_NAMES)("%s: allows its maximum and refuses the next attempt", (name) => {
    const limiter = new RateLimiter(new FakeClock(START));
    const { maxAttempts, windowMinutes } = RATE_LIMITS[name];
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      expect(limiter.attempt(name, "10.0.0.1").allowed, `attempt ${attempt}`).toBe(true);
    }
    expect(limiter.attempt(name, "10.0.0.1")).toEqual({
      allowed: false,
      retryAfterSeconds: windowMinutes * 60,
    });
  });

  it("keeps the counts of different names apart for one address", () => {
    const limiter = new RateLimiter(new FakeClock(START));
    for (let attempt = 0; attempt < 10; attempt += 1) limiter.attempt("checkout", "10.0.0.1");
    expect(limiter.attempt("checkout", "10.0.0.1").allowed).toBe(false);
    expect(limiter.attempt("login", "10.0.0.1").allowed).toBe(true);
    expect(limiter.attempt("registration", "10.0.0.1").allowed).toBe(true);
    expect(limiter.attempt("cartWrite", "10.0.0.1").allowed).toBe(true);
  });

  it("keeps the counts of different addresses apart within one name", () => {
    const limiter = new RateLimiter(new FakeClock(START));
    for (let attempt = 0; attempt < 10; attempt += 1) limiter.attempt("checkout", "10.0.0.1");
    expect(limiter.attempt("checkout", "10.0.0.1").allowed).toBe(false);
    expect(limiter.attempt("checkout", "10.0.0.2").allowed).toBe(true);
  });

  it("groups IPv6 addresses of one /64", () => {
    const limiter = new RateLimiter(new FakeClock(START));
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      limiter.attempt("checkout", `2001:db8:5:6::${attempt}`);
    }
    expect(limiter.attempt("checkout", "2001:db8:5:6:aaaa::1").allowed).toBe(false);
    expect(limiter.attempt("checkout", "2001:db8:5:7::1").allowed).toBe(true);
  });

  it("opens a new window when the old one ends", () => {
    const clock = new FakeClock(START);
    const limiter = new RateLimiter(clock);
    for (let attempt = 0; attempt < 121; attempt += 1) limiter.attempt("cartWrite", "10.0.0.1");
    expect(limiter.attempt("cartWrite", "10.0.0.1").allowed).toBe(false);
    clock.advanceMinutes(1);
    expect(limiter.attempt("cartWrite", "10.0.0.1").allowed).toBe(true);
  });

  it("takes overrides for tests and rejects an unknown name loudly", () => {
    const limiter = new RateLimiter(new FakeClock(START), {
      checkout: { maxAttempts: 1, windowMinutes: 1 },
    });
    expect(limiter.attempt("checkout", "10.0.0.1").allowed).toBe(true);
    expect(limiter.attempt("checkout", "10.0.0.1").allowed).toBe(false);
    expect(() => limiter.attempt("nope" as never, "10.0.0.1")).toThrow(/Unknown rate limit/);
  });
});
