import { describe, expect, it } from "vitest";
import { emailProviderFailure } from "./provider-port.js";
import { emailRetryDeadline, nextEmailAttempt } from "./retry.js";

const start = new Date("2030-01-01T10:00:00Z");
const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
const capabilities = { idempotencyKeys: true, maxRecipients: 1, idempotencyWindowSeconds: 1800 };
const base = { attempts: 1, now: start, deadlineAt: at(720), capabilities };

describe("sticky ambiguity retry policy", () => {
  it("only consumes the window after possible acceptance, including a late first send", () => {
    expect(
      nextEmailAttempt({
        ...base,
        now: at(60),
        failure: emailProviderFailure("unavailable"),
        pinnedAt: at(60),
      }),
    ).toEqual({ status: "pending", nextAttemptAt: at(61) });
    expect(
      nextEmailAttempt({ ...base, now: at(60), failure: emailProviderFailure("misconfigured") }),
    ).toEqual({ status: "pending", nextAttemptAt: at(120) });
  });
  it("uses the original pin across restarts and refuses a retry exactly at the margin", () => {
    expect(emailRetryDeadline(at(720), start, capabilities)).toEqual(at(25));
    expect(
      nextEmailAttempt({
        ...base,
        now: at(24),
        pinnedAt: start,
        failure: emailProviderFailure("unavailable"),
      }),
    ).toEqual({ status: "unknown", cause: "idempotency_window_expired" });
    expect(emailRetryDeadline(at(10), start, capabilities)).toEqual(at(10));
  });
  it("never replays an ambiguous send without deduplication protection", () => {
    expect(
      nextEmailAttempt({
        ...base,
        pinnedAt: start,
        capabilities: { idempotencyKeys: false, maxRecipients: 1 },
        failure: emailProviderFailure("unavailable"),
      }),
    ).toEqual({ status: "unknown", cause: "idempotency_unprotected" });
  });
  it("preserves an explicit idempotency conflict even without verified protection", () => {
    for (const pinnedAt of [null, start]) {
      expect(
        nextEmailAttempt({
          ...base,
          pinnedAt,
          capabilities: { idempotencyKeys: false, maxRecipients: 1 },
          failure: emailProviderFailure("idempotency_conflict"),
        }),
      ).toEqual({ status: "unknown", cause: "idempotency_conflict" });
    }
  });
  it("later rejection and deadline cannot disprove earlier acceptance", () => {
    expect(
      nextEmailAttempt({ ...base, pinnedAt: start, failure: emailProviderFailure("rejected") }),
    ).toEqual({ status: "unknown", cause: "rejected" });
    expect(
      nextEmailAttempt({
        ...base,
        pinnedAt: start,
        deadlineAt: at(1),
        failure: emailProviderFailure("quota_exceeded"),
      }),
    ).toEqual({ status: "unknown", cause: "deadline_passed" });
  });
  it("preserves the legacy Resend schedule when the window is absent", () => {
    expect(
      nextEmailAttempt({
        ...base,
        attempts: 7,
        pinnedAt: start,
        capabilities: { idempotencyKeys: true, maxRecipients: 1 },
        failure: emailProviderFailure("unavailable"),
      }),
    ).toEqual({ status: "pending", nextAttemptAt: at(60) });
  });
});
