import { describe, expect, it } from "vitest";
import { AUTH_EMAIL_DEADLINE_MINUTES, EMAIL_DEADLINE_HOURS } from "./limits.js";
import type { EmailProviderFailureReason } from "./provider-port.js";
import {
  EMAIL_QUOTA_RESET_UTC,
  EMAIL_RETRY_DELAYS_MINUTES,
  EMAIL_RETRY_MAX_DELAY_MINUTES,
  emailDeadlineAt,
  isPastEmailDeadline,
  nextEmailAttempt,
  type EmailAttemptInput,
} from "./retry.js";

const MINUTE = 60_000;
const at = (iso: string) => new Date(iso);
const plus = (date: Date, ms: number) => new Date(date.getTime() + ms);

const NOW = at("2026-10-26T10:00:00.000Z");
const FAR = at("2026-10-27T10:00:00.000Z");

function attempt(
  reason: EmailProviderFailureReason,
  extra: Partial<Omit<EmailAttemptInput, "failure">> & {
    retryAfterSeconds?: number;
    quotaPeriod?: "daily" | "monthly";
  } = {},
) {
  const { retryAfterSeconds, quotaPeriod, ...rest } = extra;
  return nextEmailAttempt({
    attempts: 1,
    now: NOW,
    deadlineAt: FAR,
    ...rest,
    failure: {
      reason,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      ...(quotaPeriod === undefined ? {} : { quotaPeriod }),
    },
  });
}

describe("retry schedule constants (ADR 0031 decision 7)", () => {
  it("is 1, 2, 5, 10, 20, 40 minutes, then hourly; the quota resets at 00:05 UTC", () => {
    expect([...EMAIL_RETRY_DELAYS_MINUTES]).toEqual([1, 2, 5, 10, 20, 40]);
    expect(EMAIL_RETRY_MAX_DELAY_MINUTES).toBe(60);
    expect(EMAIL_QUOTA_RESET_UTC).toEqual({ hour: 0, minute: 5 });
    expect(Object.isFrozen(EMAIL_RETRY_DELAYS_MINUTES)).toBe(true);
  });
});

describe("nextEmailAttempt", () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 5],
    [4, 10],
    [5, 20],
    [6, 40],
    [7, 60],
    [8, 60],
    [1_000_000, 60],
  ])("after attempt %i of an unavailable send waits %i minutes", (attempts, minutes) => {
    expect(attempt("unavailable", { attempts })).toEqual({
      status: "pending",
      nextAttemptAt: plus(NOW, minutes * MINUTE),
    });
  });

  it("schedules not_sent like unavailable (always safe to retry)", () => {
    expect(attempt("not_sent", { attempts: 3 })).toEqual({
      status: "pending",
      nextAttemptAt: plus(NOW, 5 * MINUTE),
    });
  });

  it("honours a retry-after longer than the schedule, never a shorter one, for unavailable", () => {
    expect(attempt("unavailable", { retryAfterSeconds: 300 })).toEqual({
      status: "pending",
      nextAttemptAt: plus(NOW, 5 * MINUTE),
    });
    expect(attempt("unavailable", { attempts: 6, retryAfterSeconds: 30 })).toEqual({
      status: "pending",
      nextAttemptAt: plus(NOW, 40 * MINUTE),
    });
  });

  it("waits exactly the retry-after when rate limited, at least one second", () => {
    expect(attempt("rate_limited", { attempts: 6, retryAfterSeconds: 2 })).toEqual({
      status: "pending",
      nextAttemptAt: plus(NOW, 2_000),
    });
    expect(attempt("rate_limited", { retryAfterSeconds: 0 })).toEqual({
      status: "pending",
      nextAttemptAt: plus(NOW, 1_000),
    });
    // Without a retry-after: the schedule.
    expect(attempt("rate_limited", { attempts: 2 })).toEqual({
      status: "pending",
      nextAttemptAt: plus(NOW, 2 * MINUTE),
    });
  });

  it("retries a misconfigured provider hourly (the operator fixes the key or the domain)", () => {
    expect(attempt("misconfigured", { attempts: 1 })).toEqual({
      status: "pending",
      nextAttemptAt: plus(NOW, 60 * MINUTE),
    });
    expect(attempt("misconfigured", { retryAfterSeconds: 7_200 })).toEqual({
      status: "pending",
      nextAttemptAt: plus(NOW, 120 * MINUTE),
    });
  });

  it("fails a rejected mail at once and never retries it", () => {
    expect(attempt("rejected")).toEqual({ status: "failed", cause: "rejected" });
    expect(attempt("rejected", { retryAfterSeconds: 1 })).toEqual({
      status: "failed",
      cause: "rejected",
    });
  });

  it("marks an idempotency conflict unknown (a mail may have gone out; the admin decides)", () => {
    expect(attempt("idempotency_conflict")).toEqual({
      status: "unknown",
      cause: "idempotency_conflict",
    });
  });

  describe("daily quota: next 00:05 UTC, strictly after now", () => {
    it.each([
      ["2026-10-26T00:00:00.000Z", "2026-10-26T00:05:00.000Z"],
      ["2026-10-26T00:04:59.999Z", "2026-10-26T00:05:00.000Z"],
      ["2026-10-26T00:05:00.000Z", "2026-10-27T00:05:00.000Z"],
      ["2026-10-26T00:05:00.001Z", "2026-10-27T00:05:00.000Z"],
      ["2026-10-26T23:59:59.999Z", "2026-10-27T00:05:00.000Z"],
      // Month, year and leap-day ends.
      ["2026-10-31T23:00:00.000Z", "2026-11-01T00:05:00.000Z"],
      ["2026-12-31T12:00:00.000Z", "2027-01-01T00:05:00.000Z"],
      ["2028-02-28T12:00:00.000Z", "2028-02-29T00:05:00.000Z"],
      // Kyiv leaves summer time at 2026-10-25T01:00Z and the US at 2026-11-01T06:00Z: UTC math is not affected.
      ["2026-10-25T00:30:00.000Z", "2026-10-26T00:05:00.000Z"],
      ["2026-03-29T00:30:00.000Z", "2026-03-30T00:05:00.000Z"],
      ["2026-11-01T05:59:00.000Z", "2026-11-02T00:05:00.000Z"],
    ])("at %s retries at %s", (now, expected) => {
      expect(
        nextEmailAttempt({
          attempts: 1,
          now: at(now),
          deadlineAt: plus(at(now), 48 * 60 * MINUTE),
          failure: { reason: "quota_exceeded", quotaPeriod: "daily" },
        }),
      ).toEqual({ status: "pending", nextAttemptAt: at(expected) });
    });

    it("waits for a later retry-after if the service sends one", () => {
      expect(
        nextEmailAttempt({
          attempts: 1,
          now: at("2026-10-26T23:59:00.000Z"),
          deadlineAt: FAR,
          failure: { reason: "quota_exceeded", quotaPeriod: "daily", retryAfterSeconds: 3_600 },
        }),
      ).toEqual({ status: "pending", nextAttemptAt: at("2026-10-27T00:59:00.000Z") });
    });

    it("fails the mail when the quota resets only after its deadline", () => {
      expect(
        nextEmailAttempt({
          attempts: 1,
          now: at("2026-10-26T10:00:00.000Z"),
          deadlineAt: at("2026-10-26T22:00:00.000Z"),
          failure: { reason: "quota_exceeded", quotaPeriod: "daily" },
        }),
      ).toEqual({ status: "failed", cause: "deadline_passed" });
    });
  });

  it("retries a monthly quota, or a quota the service did not name, hourly until the deadline", () => {
    for (const quotaPeriod of ["monthly", undefined] as const) {
      expect(attempt("quota_exceeded", quotaPeriod ? { quotaPeriod } : {})).toEqual({
        status: "pending",
        nextAttemptAt: plus(NOW, 60 * MINUTE),
      });
    }
  });

  describe("deadline cut", () => {
    it("keeps a retry that falls 1 ms before the deadline", () => {
      expect(attempt("unavailable", { deadlineAt: plus(NOW, MINUTE + 1) })).toEqual({
        status: "pending",
        nextAttemptAt: plus(NOW, MINUTE),
      });
    });

    it("fails a retry that falls exactly on the deadline or after it", () => {
      expect(attempt("unavailable", { deadlineAt: plus(NOW, MINUTE) })).toEqual({
        status: "failed",
        cause: "deadline_passed",
      });
      expect(attempt("rate_limited", { retryAfterSeconds: 86_400 })).toEqual({
        status: "failed",
        cause: "deadline_passed",
      });
      expect(attempt("misconfigured", { deadlineAt: plus(NOW, 30 * MINUTE) })).toEqual({
        status: "failed",
        cause: "deadline_passed",
      });
    });

    it("fails when the deadline has already passed", () => {
      expect(attempt("not_sent", { deadlineAt: NOW })).toEqual({
        status: "failed",
        cause: "deadline_passed",
      });
      expect(attempt("unavailable", { deadlineAt: plus(NOW, -1) })).toEqual({
        status: "failed",
        cause: "deadline_passed",
      });
    });
  });

  it("never schedules into the past or now, whatever the input", () => {
    for (const reason of [
      "unavailable",
      "rate_limited",
      "misconfigured",
      "quota_exceeded",
      "not_sent",
    ] as const) {
      for (const attempts of [1, 2, 7, 50]) {
        const decision = attempt(reason, { attempts, retryAfterSeconds: 0 });
        expect(decision.status, reason).toBe("pending");
        if (decision.status === "pending") {
          expect(decision.nextAttemptAt.getTime()).toBeGreaterThan(NOW.getTime());
        }
      }
    }
  });

  it("does not mutate the input dates", () => {
    const now = at("2026-10-26T10:00:00.000Z");
    const deadline = at("2026-10-26T22:00:00.000Z");
    nextEmailAttempt({
      attempts: 2,
      now,
      deadlineAt: deadline,
      failure: { reason: "unavailable" },
    });
    expect(now.toISOString()).toBe("2026-10-26T10:00:00.000Z");
    expect(deadline.toISOString()).toBe("2026-10-26T22:00:00.000Z");
  });

  it("throws for input that can only be a bug", () => {
    const base = {
      attempts: 1,
      now: NOW,
      deadlineAt: FAR,
      failure: { reason: "unavailable" as const },
    };
    for (const attempts of [0, -1, 1.5, Number.NaN]) {
      expect(() => nextEmailAttempt({ ...base, attempts }), String(attempts)).toThrow(RangeError);
    }
    expect(() => nextEmailAttempt({ ...base, now: new Date(Number.NaN) })).toThrow(RangeError);
    expect(() => nextEmailAttempt({ ...base, deadlineAt: new Date("x") })).toThrow(RangeError);
    expect(() =>
      nextEmailAttempt({ ...base, failure: { reason: "gone" as EmailProviderFailureReason } }),
    ).toThrow(RangeError);
    expect(() =>
      nextEmailAttempt({ ...base, failure: { reason: "unavailable", retryAfterSeconds: -1 } }),
    ).toThrow(RangeError);
    expect(() =>
      nextEmailAttempt({ ...base, failure: { reason: "unavailable", retryAfterSeconds: 1.5 } }),
    ).toThrow(RangeError);
  });
});

describe("emailDeadlineAt", () => {
  const created = at("2026-10-26T10:00:00.000Z");

  it("is created_at + 12 hours for every mail without a token", () => {
    expect(EMAIL_DEADLINE_HOURS).toBe(12);
    expect(emailDeadlineAt({ createdAt: created })).toEqual(at("2026-10-26T22:00:00.000Z"));
    expect(emailDeadlineAt({ createdAt: created, authTokenExpiresAt: null })).toEqual(
      at("2026-10-26T22:00:00.000Z"),
    );
  });

  it("is min(token expiry, created_at + 1 hour) for an auth mail (ADR 0031 open question 1)", () => {
    expect(AUTH_EMAIL_DEADLINE_MINUTES).toBe(60);
    // Reset: 60-minute token, both readings agree.
    expect(
      emailDeadlineAt({ createdAt: created, authTokenExpiresAt: plus(created, 60 * MINUTE) }),
    ).toEqual(plus(created, 60 * MINUTE));
    // Verification: 48-hour token, capped at one hour.
    expect(
      emailDeadlineAt({ createdAt: created, authTokenExpiresAt: plus(created, 48 * 60 * MINUTE) }),
    ).toEqual(plus(created, 60 * MINUTE));
    // A token that expires sooner wins.
    expect(
      emailDeadlineAt({ createdAt: created, authTokenExpiresAt: plus(created, 10 * MINUTE) }),
    ).toEqual(plus(created, 10 * MINUTE));
    // An already expired token: the deadline is its expiry (the next claim fails the mail).
    expect(
      emailDeadlineAt({ createdAt: created, authTokenExpiresAt: plus(created, -MINUTE) }),
    ).toEqual(plus(created, -MINUTE));
  });

  it("throws for an invalid date", () => {
    expect(() => emailDeadlineAt({ createdAt: new Date(Number.NaN) })).toThrow(RangeError);
    expect(() =>
      emailDeadlineAt({ createdAt: created, authTokenExpiresAt: new Date(Number.NaN) }),
    ).toThrow(RangeError);
  });
});

describe("isPastEmailDeadline", () => {
  const deadline = at("2026-10-26T22:00:00.000Z");

  it("allows a send strictly before the deadline and never at or after it", () => {
    expect(isPastEmailDeadline(plus(deadline, -1), deadline)).toBe(false);
    expect(isPastEmailDeadline(deadline, deadline)).toBe(true);
    expect(isPastEmailDeadline(plus(deadline, 1), deadline)).toBe(true);
  });

  it("throws for an invalid date", () => {
    expect(() => isPastEmailDeadline(new Date(Number.NaN), deadline)).toThrow(RangeError);
    expect(() => isPastEmailDeadline(deadline, new Date(Number.NaN))).toThrow(RangeError);
  });
});
