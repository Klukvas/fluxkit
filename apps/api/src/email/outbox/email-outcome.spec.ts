import { describe, expect, it } from "vitest";
import { emailProviderFailure, EMAIL_CODE_PATTERN } from "@fluxkit/core";
import { decideEmailClaim, decideEmailRecord, failureCode } from "./email-outcome.js";

const MINUTE = 60_000;
const NOW = new Date("2030-01-01T12:00:00.000Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);
const DEADLINE = later(12 * 60);

describe("decideEmailClaim (what a claim does with a due row)", () => {
  it("claims a pending row before its deadline", () => {
    expect(decideEmailClaim({ status: "pending", deadlineAt: DEADLINE, now: NOW })).toEqual({
      to: "sending",
    });
  });

  it("re-claims a sending row whose lease expired (the explicit sending -> sending transition)", () => {
    expect(decideEmailClaim({ status: "sending", deadlineAt: DEADLINE, now: NOW })).toEqual({
      to: "sending",
    });
  });

  it("fails a pending row at or past its deadline instead of sending it", () => {
    for (const deadlineAt of [NOW, later(-1)]) {
      expect(decideEmailClaim({ status: "pending", deadlineAt, now: NOW })).toEqual({
        to: "failed",
        lastErrorCode: "deadline_passed",
      });
    }
  });

  it("marks an expired lease past its deadline unknown: the crashed attempt may have reached the provider", () => {
    expect(decideEmailClaim({ status: "sending", deadlineAt: NOW, now: NOW })).toEqual({
      to: "unknown",
      lastErrorCode: "deadline_passed",
    });
  });

  it("claims a row one millisecond before its deadline", () => {
    expect(
      decideEmailClaim({ status: "pending", deadlineAt: new Date(NOW.getTime() + 1), now: NOW }),
    ).toEqual({ to: "sending" });
  });

  it("refuses to claim a final row (a bug in the caller's query)", () => {
    for (const status of ["sent", "failed", "unknown", "cancelled"] as const) {
      expect(() => decideEmailClaim({ status, deadlineAt: DEADLINE, now: NOW })).toThrow(
        RangeError,
      );
    }
  });
});

describe("decideEmailRecord (what the record step writes after an attempt)", () => {
  const base = { attempts: 1, deadlineAt: DEADLINE, now: NOW };

  it("records a sent mail with its provider id and time", () => {
    expect(
      decideEmailRecord({ ...base, outcome: { kind: "sent", providerMessageId: "re_123" } }),
    ).toEqual({ status: "sent", providerMessageId: "re_123", sentAt: NOW, lastErrorCode: null });
  });

  it("schedules a retryable failure by the core schedule (1, 2, 5 minutes ...)", () => {
    for (const [attempts, minutes] of [
      [1, 1],
      [2, 2],
      [3, 5],
      [6, 40],
      [7, 60],
    ] as const) {
      expect(
        decideEmailRecord({
          ...base,
          attempts,
          outcome: { kind: "provider_failed", failure: emailProviderFailure("unavailable") },
        }),
      ).toEqual({ status: "pending", nextAttemptAt: later(minutes), lastErrorCode: "unavailable" });
    }
  });

  it("honours retry-after for rate_limited exactly", () => {
    expect(
      decideEmailRecord({
        ...base,
        attempts: 5,
        outcome: {
          kind: "provider_failed",
          failure: emailProviderFailure("rate_limited", {
            providerCodes: ["rate_limit_exceeded"],
            retryAfterSeconds: 30,
          }),
        },
      }),
    ).toEqual({
      status: "pending",
      nextAttemptAt: new Date(NOW.getTime() + 30_000),
      lastErrorCode: "rate_limited:rate_limit_exceeded",
    });
  });

  it("waits for the next 00:05 UTC after a daily quota, hourly after a monthly one", () => {
    const daily = decideEmailRecord({
      ...base,
      deadlineAt: later(24 * 60),
      outcome: {
        kind: "provider_failed",
        failure: emailProviderFailure("quota_exceeded", { quotaPeriod: "daily" }),
      },
    });
    expect(daily).toEqual({
      status: "pending",
      nextAttemptAt: new Date("2030-01-02T00:05:00.000Z"),
      lastErrorCode: "quota_exceeded",
    });
    const monthly = decideEmailRecord({
      ...base,
      outcome: {
        kind: "provider_failed",
        failure: emailProviderFailure("quota_exceeded", { quotaPeriod: "monthly" }),
      },
    });
    expect(monthly).toEqual({
      status: "pending",
      nextAttemptAt: later(60),
      lastErrorCode: "quota_exceeded",
    });
  });

  it("fails a daily quota whose reset is past the deadline (deadline cut)", () => {
    expect(
      decideEmailRecord({
        ...base,
        outcome: {
          kind: "provider_failed",
          failure: emailProviderFailure("quota_exceeded", { quotaPeriod: "daily" }),
        },
      }),
    ).toEqual({ status: "failed", lastErrorCode: "deadline_passed" });
  });

  it("fails a retry that would land at or after the deadline", () => {
    expect(
      decideEmailRecord({
        ...base,
        deadlineAt: later(1),
        outcome: { kind: "provider_failed", failure: emailProviderFailure("unavailable") },
      }),
    ).toEqual({ status: "failed", lastErrorCode: "deadline_passed" });
  });

  it("fails a rejected mail at once with its code", () => {
    expect(
      decideEmailRecord({
        ...base,
        outcome: {
          kind: "provider_failed",
          failure: emailProviderFailure("rejected", { providerCodes: ["validation_error"] }),
        },
      }),
    ).toEqual({ status: "failed", lastErrorCode: "rejected:validation_error" });
  });

  it("makes an idempotency conflict unknown and never schedules it again", () => {
    expect(
      decideEmailRecord({
        ...base,
        outcome: {
          kind: "provider_failed",
          failure: emailProviderFailure("idempotency_conflict", {
            providerCodes: ["invalid_idempotent_request"],
          }),
        },
      }),
    ).toEqual({
      status: "unknown",
      lastErrorCode: "idempotency_conflict:invalid_idempotent_request",
    });
  });

  it("fails a mail that could not be rendered with the render code, without a retry", () => {
    for (const code of [
      "template_unavailable",
      "variables_invalid",
      "render_failed",
      "message_invalid",
    ] as const) {
      expect(decideEmailRecord({ ...base, outcome: { kind: "not_renderable", code } })).toEqual({
        status: "failed",
        lastErrorCode: code,
      });
    }
  });

  it("schedules a misconfigured provider hourly", () => {
    expect(
      decideEmailRecord({
        ...base,
        outcome: {
          kind: "provider_failed",
          failure: emailProviderFailure("misconfigured", { providerCodes: ["restricted_api_key"] }),
        },
      }),
    ).toEqual({
      status: "pending",
      nextAttemptAt: later(60),
      lastErrorCode: "misconfigured:restricted_api_key",
    });
  });
});

describe("failureCode (last_error_code of a provider failure)", () => {
  it("is the reason, with the first provider code when it fits the code pattern", () => {
    expect(failureCode(emailProviderFailure("unavailable"))).toBe("unavailable");
    expect(failureCode(emailProviderFailure("rejected", { providerCodes: ["a", "b"] }))).toBe(
      "rejected:a",
    );
    const long = "x".repeat(64);
    const code = failureCode(emailProviderFailure("rejected", { providerCodes: [long] }));
    expect(code).toBe("rejected");
    expect(EMAIL_CODE_PATTERN.test(code)).toBe(true);
  });
});
