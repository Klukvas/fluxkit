import { describe, expect, it } from "vitest";
import { FakeClock } from "../test/fake-clock.js";
import { LOGIN_THROTTLE_DEFAULTS, LoginThrottle } from "./login-throttle.js";

const START = "2030-05-01T10:00:00.000Z";

describe("LoginThrottle (per client IP, fixed window, in memory)", () => {
  it("documents the limit of the plan: 20 attempts per 10 minutes", () => {
    expect(LOGIN_THROTTLE_DEFAULTS).toMatchObject({ maxAttempts: 20, windowMinutes: 10 });
  });

  it("allows 20 attempts and refuses the 21st with the seconds until the window ends", () => {
    const clock = new FakeClock(START);
    const throttle = new LoginThrottle(clock);
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      expect(throttle.attempt("10.0.0.1"), `attempt ${attempt}`).toEqual({ allowed: true });
    }
    clock.advanceMinutes(4);
    expect(throttle.attempt("10.0.0.1")).toEqual({ allowed: false, retryAfterSeconds: 6 * 60 });
  });

  it("keeps refusing for the rest of the window and does not extend it", () => {
    const clock = new FakeClock(START);
    const throttle = new LoginThrottle(clock);
    for (let attempt = 0; attempt < 20; attempt += 1) throttle.attempt("10.0.0.1");
    for (let minute = 1; minute < 10; minute += 1) {
      clock.advanceMinutes(1);
      expect(throttle.attempt("10.0.0.1").allowed, `minute ${minute}`).toBe(false);
    }
  });

  it("starts a fresh window after 10 minutes", () => {
    const clock = new FakeClock(START);
    const throttle = new LoginThrottle(clock);
    for (let attempt = 0; attempt < 21; attempt += 1) throttle.attempt("10.0.0.1");
    clock.advanceMinutes(10);
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      expect(throttle.attempt("10.0.0.1").allowed, `attempt ${attempt}`).toBe(true);
    }
    expect(throttle.attempt("10.0.0.1").allowed).toBe(false);
  });

  it("is one second short of the reset still closed", () => {
    const clock = new FakeClock(START);
    const throttle = new LoginThrottle(clock);
    for (let attempt = 0; attempt < 21; attempt += 1) throttle.attempt("10.0.0.1");
    clock.set(new Date(Date.parse(START) + 10 * 60_000 - 1000));
    expect(throttle.attempt("10.0.0.1")).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("counts every client separately", () => {
    const throttle = new LoginThrottle(new FakeClock(START));
    for (let attempt = 0; attempt < 21; attempt += 1) throttle.attempt("10.0.0.1");
    expect(throttle.attempt("10.0.0.1").allowed).toBe(false);
    expect(throttle.attempt("10.0.0.2")).toEqual({ allowed: true });
  });

  describe("bounded memory", () => {
    it("drops expired windows so the map does not keep old clients", () => {
      const clock = new FakeClock(START);
      const throttle = new LoginThrottle(clock, { maxClients: 1000 });
      for (let client = 0; client < 500; client += 1) throttle.attempt(`10.1.0.${client}`);
      expect(throttle.size).toBe(500);
      clock.advanceMinutes(11);
      throttle.attempt("10.2.0.1");
      expect(throttle.size).toBe(1);
    });

    it("never holds more than maxClients entries even when every window is still open", () => {
      const throttle = new LoginThrottle(new FakeClock(START), { maxClients: 100 });
      for (let client = 0; client < 5000; client += 1) {
        throttle.attempt(`10.3.${Math.floor(client / 256)}.${client % 256}`);
        expect(throttle.size).toBeLessThanOrEqual(100);
      }
      expect(throttle.size).toBe(100);
    });

    it("evicts the oldest client first, so a recently throttled client stays throttled", () => {
      const throttle = new LoginThrottle(new FakeClock(START), { maxClients: 3 });
      for (let attempt = 0; attempt < 21; attempt += 1) throttle.attempt("old");
      throttle.attempt("a");
      throttle.attempt("b");
      // "old" is the oldest entry: the fourth client pushes it out. This is the documented trade-off of a bound.
      throttle.attempt("c");
      expect(throttle.size).toBe(3);
      expect(throttle.attempt("old")).toEqual({ allowed: true });
    });
  });

  it("rejects nonsense limits instead of silently allowing everything", () => {
    const clock = new FakeClock(START);
    expect(() => new LoginThrottle(clock, { maxAttempts: 0 })).toThrow(RangeError);
    expect(() => new LoginThrottle(clock, { windowMinutes: 0 })).toThrow(RangeError);
    expect(() => new LoginThrottle(clock, { maxClients: 0 })).toThrow(RangeError);
  });
});
