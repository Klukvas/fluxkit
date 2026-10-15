import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import {
  LOCKOUT_DEFAULTS,
  isLocked,
  registerFailedLogin,
  registerSuccessfulLogin,
} from "./lockout.js";

const now = new Date("2026-10-16T10:00:00.000Z");
const minutes = (value: number) => new Date(now.getTime() + value * 60_000);
const fresh = { failedLoginCount: 0, lockedUntil: null };

describe("LOCKOUT_DEFAULTS", () => {
  it("is 5 failures and 15 minutes", () => {
    expect(LOCKOUT_DEFAULTS).toEqual({ maxFailedAttempts: 5, lockMinutes: 15 });
  });
});

describe("isLocked", () => {
  it("is false without a lock", () => {
    expect(isLocked({ lockedUntil: null }, now)).toBe(false);
  });

  it("is true strictly before lockedUntil and false at and after it", () => {
    expect(isLocked({ lockedUntil: new Date(now.getTime() + 1) }, now)).toBe(true);
    expect(isLocked({ lockedUntil: new Date(now.getTime()) }, now)).toBe(false);
    expect(isLocked({ lockedUntil: new Date(now.getTime() - 1) }, now)).toBe(false);
  });

  it("treats an invalid date as locked (fail closed)", () => {
    expect(isLocked({ lockedUntil: new Date("nope") }, now)).toBe(true);
  });
});

describe("registerFailedLogin", () => {
  it("counts failures 1 to 4 without locking", () => {
    let state: { failedLoginCount: number; lockedUntil: Date | null } = { ...fresh };
    for (let expected = 1; expected <= 4; expected += 1) {
      state = registerFailedLogin(state, now);
      expect(state).toEqual({ failedLoginCount: expected, lockedUntil: null });
    }
  });

  it("locks on the 5th failure for 15 minutes and keeps the count", () => {
    const result = registerFailedLogin({ failedLoginCount: 4, lockedUntil: null }, now);
    expect(result).toEqual({ failedLoginCount: 5, lockedUntil: minutes(15) });
  });

  it("does not extend or change an active lock", () => {
    const state = { failedLoginCount: 5, lockedUntil: minutes(3) };
    expect(registerFailedLogin(state, now)).toEqual({
      failedLoginCount: 5,
      lockedUntil: minutes(3),
    });
  });

  it("starts a fresh count at 1 when the lock has expired, also exactly at the boundary", () => {
    expect(registerFailedLogin({ failedLoginCount: 5, lockedUntil: minutes(-1) }, now)).toEqual({
      failedLoginCount: 1,
      lockedUntil: null,
    });
    expect(registerFailedLogin({ failedLoginCount: 5, lockedUntil: minutes(0) }, now)).toEqual({
      failedLoginCount: 1,
      lockedUntil: null,
    });
  });

  it("honours a custom config", () => {
    const config = { maxFailedAttempts: 2, lockMinutes: 1 };
    const first = registerFailedLogin(fresh, now, config);
    expect(first).toEqual({ failedLoginCount: 1, lockedUntil: null });
    expect(registerFailedLogin(first, now, config)).toEqual({
      failedLoginCount: 2,
      lockedUntil: minutes(1),
    });
  });

  it("rejects a nonsensical config instead of silently never locking", () => {
    expect(() =>
      registerFailedLogin(fresh, now, { maxFailedAttempts: 0, lockMinutes: 15 }),
    ).toThrow(RangeError);
    expect(() => registerFailedLogin(fresh, now, { maxFailedAttempts: 5, lockMinutes: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      registerFailedLogin(fresh, now, { maxFailedAttempts: Number.NaN, lockMinutes: 15 }),
    ).toThrow(RangeError);
  });

  it("does not mutate frozen inputs and is deterministic", () => {
    const state = deepFreeze({ failedLoginCount: 4, lockedUntil: null as Date | null });
    const frozenNow = deepFreeze(new Date(now.getTime()));
    const a = registerFailedLogin(state, frozenNow);
    const b = registerFailedLogin(state, frozenNow);
    expect(a).toEqual(b);
    expect(a).not.toBe(state);
    expect(a.lockedUntil).not.toBe(frozenNow);
    expect(frozenNow.getTime()).toBe(now.getTime());
  });

  it("returns a copy of the lock date, not the input instance", () => {
    const lockedUntil = minutes(3);
    const result = registerFailedLogin({ failedLoginCount: 5, lockedUntil }, now);
    expect(result.lockedUntil).toEqual(lockedUntil);
    expect(result.lockedUntil).not.toBe(lockedUntil);
  });
});

describe("registerSuccessfulLogin", () => {
  it("resets the counter and the lock", () => {
    expect(registerSuccessfulLogin()).toEqual({ failedLoginCount: 0, lockedUntil: null });
  });
});
