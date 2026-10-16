import { describe, expect, it } from "vitest";
import { FakeClock } from "../test/fake-clock.js";
import { LOGIN_THROTTLE_DEFAULTS, LoginThrottle, throttleKeyOf } from "./login-throttle.js";

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

describe("throttleKeyOf (IPv6 is keyed by its /64 prefix)", () => {
  it("leaves IPv4 addresses unchanged", () => {
    expect(throttleKeyOf("10.0.0.1")).toBe("10.0.0.1");
    expect(throttleKeyOf("203.0.113.250")).toBe("203.0.113.250");
  });

  it("maps every address of one /64 to the same key, in any notation", () => {
    const key = throttleKeyOf("2001:db8:1:2::1");
    expect(key).not.toBe("2001:db8:1:2::1");
    for (const same of [
      "2001:db8:1:2:ffff:ffff:ffff:ffff",
      "2001:0db8:0001:0002:0000:0000:0000:0001",
      "2001:DB8:1:2::abcd",
      "2001:Db8:0001:2:1:2:3:4",
      "2001:db8:1:2::",
    ]) {
      expect(throttleKeyOf(same), same).toBe(key);
    }
  });

  it("separates different /64 prefixes", () => {
    const key = throttleKeyOf("2001:db8:1:2::1");
    for (const other of [
      "2001:db8:1:3::1",
      "2001:db8:2:2::1",
      "2001:db9:1:2::1",
      "3001:db8:1:2::1",
    ]) {
      expect(throttleKeyOf(other), other).not.toBe(key);
    }
  });

  it("handles compressed prefixes and the unspecified and loopback addresses", () => {
    expect(throttleKeyOf("::1")).toBe(throttleKeyOf("0:0:0:0:0:0:0:2"));
    expect(throttleKeyOf("::")).toBe(throttleKeyOf("::5"));
    expect(throttleKeyOf("2001:db8::1")).toBe(throttleKeyOf("2001:db8:0:0:9::1"));
    expect(throttleKeyOf("2001:db8::1")).not.toBe(throttleKeyOf("2001:db8:0:1::1"));
  });

  it("ignores a zone id", () => {
    expect(throttleKeyOf("fe80::1%eth0")).toBe(throttleKeyOf("fe80::2"));
    expect(throttleKeyOf("fe80::1%12")).toBe(throttleKeyOf("FE80::ffff"));
  });

  it("treats an IPv4-mapped IPv6 address as the IPv4 address", () => {
    expect(throttleKeyOf("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(throttleKeyOf("::FFFF:203.0.113.7")).toBe("203.0.113.7");
    expect(throttleKeyOf("0:0:0:0:0:ffff:cb00:7107")).toBe("203.0.113.7");
    expect(throttleKeyOf("::ffff:cb00:7107")).toBe("203.0.113.7");
  });

  it("does not treat other embedded-IPv4 forms as mapped", () => {
    expect(throttleKeyOf("64:ff9b::203.0.113.7")).toBe(throttleKeyOf("64:ff9b::1"));
    expect(throttleKeyOf("::203.0.113.7")).not.toBe("203.0.113.7");
  });

  it.each(["", "unknown", "not-an-ip", "1.2.3", "2001:db8::1::2", "[2001:db8::1]", "12345::1"])(
    "falls back to the raw string for invalid input %j",
    (input) => {
      expect(throttleKeyOf(input)).toBe(input);
    },
  );
});

describe("LoginThrottle with IPv6 clients", () => {
  it("shares one window between addresses of one /64 and keeps another /64 separate", () => {
    const throttle = new LoginThrottle(new FakeClock(START));
    for (let attempt = 0; attempt < 20; attempt += 1) {
      throttle.attempt(`2001:db8:1:2:${attempt.toString(16)}::${attempt + 1}`);
    }
    expect(throttle.attempt("2001:db8:1:2:dead:beef:0:1").allowed).toBe(false);
    expect(throttle.attempt("2001:0DB8:0001:0002::7").allowed).toBe(false);
    expect(throttle.attempt("2001:db8:1:3::1")).toEqual({ allowed: true });
    expect(throttle.size).toBe(2);
  });

  it("counts an invalid address under its raw string, so it is still limited", () => {
    const throttle = new LoginThrottle(new FakeClock(START));
    for (let attempt = 0; attempt < 20; attempt += 1) throttle.attempt("garbage");
    expect(throttle.attempt("garbage").allowed).toBe(false);
    expect(throttle.attempt("other-garbage")).toEqual({ allowed: true });
  });

  it("limits a mapped IPv4 address together with the plain IPv4 address", () => {
    const throttle = new LoginThrottle(new FakeClock(START));
    for (let attempt = 0; attempt < 20; attempt += 1) throttle.attempt("::ffff:10.9.9.9");
    expect(throttle.attempt("10.9.9.9").allowed).toBe(false);
  });
});
