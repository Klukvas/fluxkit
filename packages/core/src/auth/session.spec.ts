import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import { SESSION_DEFAULTS, evaluateSession, sessionExpiry, shouldTouchSession } from "./session.js";

const createdAt = new Date("2026-10-16T00:00:00.000Z");
const config = { idleMinutes: 60, maxHours: 24 };
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("SESSION_DEFAULTS", () => {
  it("is 720 idle minutes and 168 hours", () => {
    expect(SESSION_DEFAULTS).toEqual({ idleMinutes: 720, maxHours: 168 });
  });
});

describe("evaluateSession", () => {
  it("is valid inside both limits", () => {
    const lastSeenAt = at(createdAt, 10 * MIN);
    expect(evaluateSession({ createdAt, lastSeenAt }, at(createdAt, 30 * MIN), config)).toEqual({
      valid: true,
    });
  });

  it("idle timeout: one millisecond before the limit is valid, exactly at the limit is expired", () => {
    const lastSeenAt = at(createdAt, 2 * HOUR);
    const session = { createdAt, lastSeenAt };
    expect(evaluateSession(session, at(lastSeenAt, HOUR - 1), config)).toEqual({ valid: true });
    expect(evaluateSession(session, at(lastSeenAt, HOUR), config)).toEqual({
      valid: false,
      reason: "idle_timeout",
    });
    expect(evaluateSession(session, at(lastSeenAt, HOUR + 1), config)).toEqual({
      valid: false,
      reason: "idle_timeout",
    });
  });

  it("max lifetime: exactly at the limit is expired even if the session is active", () => {
    const lastSeenAt = at(createdAt, 24 * HOUR - 1);
    const session = { createdAt, lastSeenAt };
    expect(evaluateSession(session, at(createdAt, 24 * HOUR - 1), config)).toEqual({ valid: true });
    expect(evaluateSession(session, at(createdAt, 24 * HOUR), config)).toEqual({
      valid: false,
      reason: "max_lifetime",
    });
  });

  it("reports max_lifetime when both limits are exceeded", () => {
    expect(
      evaluateSession({ createdAt, lastSeenAt: createdAt }, at(createdAt, 48 * HOUR), config),
    ).toEqual({
      valid: false,
      reason: "max_lifetime",
    });
  });

  it("honours a stored expiresAt as the absolute limit (boundary included)", () => {
    const expiresAt = at(createdAt, 5 * MIN);
    const session = { createdAt, lastSeenAt: createdAt, expiresAt };
    expect(evaluateSession(session, at(createdAt, 5 * MIN - 1), config)).toEqual({ valid: true });
    expect(evaluateSession(session, expiresAt, config)).toEqual({
      valid: false,
      reason: "max_lifetime",
    });
  });

  it("uses the earlier of expiresAt and createdAt + maxHours", () => {
    const expiresAt = at(createdAt, 100 * HOUR);
    const session = { createdAt, lastSeenAt: at(createdAt, 24 * HOUR - 1), expiresAt };
    expect(evaluateSession(session, at(createdAt, 24 * HOUR), config)).toEqual({
      valid: false,
      reason: "max_lifetime",
    });
  });

  it("treats invalid dates as invalid_session", () => {
    const bad = new Date("nope");
    const now = at(createdAt, MIN);
    const invalid = { valid: false, reason: "invalid_session" };
    expect(evaluateSession({ createdAt: bad, lastSeenAt: createdAt }, now, config)).toEqual(
      invalid,
    );
    expect(evaluateSession({ createdAt, lastSeenAt: bad }, now, config)).toEqual(invalid);
    expect(
      evaluateSession({ createdAt, lastSeenAt: createdAt, expiresAt: bad }, now, config),
    ).toEqual(invalid);
    expect(evaluateSession({ createdAt, lastSeenAt: createdAt }, bad, config)).toEqual(invalid);
    expect(
      evaluateSession(
        { createdAt: "2026-10-16" as unknown as Date, lastSeenAt: createdAt },
        now,
        config,
      ),
    ).toEqual(invalid);
  });

  it("treats lastSeenAt before createdAt as invalid_session", () => {
    expect(
      evaluateSession({ createdAt, lastSeenAt: at(createdAt, -1) }, at(createdAt, MIN), config),
    ).toEqual({
      valid: false,
      reason: "invalid_session",
    });
  });

  it("treats a lastSeenAt or createdAt far in the future as invalid_session, tolerating small clock skew", () => {
    const now = at(createdAt, HOUR);
    expect(evaluateSession({ createdAt, lastSeenAt: at(now, 4 * MIN) }, now, config)).toEqual({
      valid: true,
    });
    expect(evaluateSession({ createdAt, lastSeenAt: at(now, 6 * MIN) }, now, config)).toEqual({
      valid: false,
      reason: "invalid_session",
    });
    expect(
      evaluateSession({ createdAt: at(now, HOUR), lastSeenAt: at(now, HOUR) }, now, config),
    ).toEqual({
      valid: false,
      reason: "invalid_session",
    });
  });

  it("rejects a nonsensical config", () => {
    const session = { createdAt, lastSeenAt: createdAt };
    expect(() => evaluateSession(session, createdAt, { idleMinutes: 0, maxHours: 24 })).toThrow(
      RangeError,
    );
    expect(() => evaluateSession(session, createdAt, { idleMinutes: 60, maxHours: -1 })).toThrow(
      RangeError,
    );
    expect(() =>
      evaluateSession(session, createdAt, { idleMinutes: Number.NaN, maxHours: 24 }),
    ).toThrow(RangeError);
  });

  it("does not mutate frozen inputs and gives equal results on two calls", () => {
    const session = deepFreeze({ createdAt: new Date(createdAt), lastSeenAt: new Date(createdAt) });
    const now = deepFreeze(at(createdAt, 2 * HOUR));
    const frozenConfig = deepFreeze({ ...config });
    expect(evaluateSession(session, now, frozenConfig)).toEqual(
      evaluateSession(session, now, frozenConfig),
    );
  });
});

describe("shouldTouchSession", () => {
  const lastSeenAt = new Date("2026-10-16T10:00:00.000Z");

  it("is false under 60 seconds and true from 60 seconds", () => {
    expect(shouldTouchSession(lastSeenAt, at(lastSeenAt, 59_999))).toBe(false);
    expect(shouldTouchSession(lastSeenAt, at(lastSeenAt, 60_000))).toBe(true);
    expect(shouldTouchSession(lastSeenAt, at(lastSeenAt, 3 * HOUR))).toBe(true);
  });

  it("is false when the clock went backwards", () => {
    expect(shouldTouchSession(lastSeenAt, at(lastSeenAt, -HOUR))).toBe(false);
  });

  it("is true for an invalid lastSeenAt so the bad value is overwritten", () => {
    expect(shouldTouchSession(new Date("nope"), lastSeenAt)).toBe(true);
  });
});

describe("sessionExpiry", () => {
  it("is createdAt plus maxHours as a new Date", () => {
    const result = sessionExpiry(createdAt, { maxHours: 168 });
    expect(result).toEqual(new Date("2026-10-23T00:00:00.000Z"));
    expect(result).not.toBe(createdAt);
  });

  it("does not mutate a frozen input", () => {
    const frozen = deepFreeze(new Date(createdAt));
    expect(sessionExpiry(frozen, { maxHours: 1 })).toEqual(at(createdAt, HOUR));
  });

  it("rejects a nonsensical config and an invalid date", () => {
    expect(() => sessionExpiry(createdAt, { maxHours: 0 })).toThrow(RangeError);
    expect(() => sessionExpiry(new Date("nope"), { maxHours: 1 })).toThrow(RangeError);
  });
});
