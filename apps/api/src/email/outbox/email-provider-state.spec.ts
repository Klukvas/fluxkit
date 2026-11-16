import { describe, expect, it } from "vitest";
import { emailProviderFailure } from "@fluxkit/core";
import { emailProviderCooldownAt } from "./email-provider-state.js";

describe("provider-specific cooldown policy", () => {
  it.each([
    ["2030-12-31T23:59:00Z", "2031-01-01T00:05:00Z"],
    ["2030-02-28T00:04:59Z", "2030-02-28T00:05:00Z"],
    ["2032-02-29T00:05:00Z", "2032-03-01T00:05:00Z"],
  ])("uses the next strict Resend daily 00:05 UTC after %s", (now, expected) => {
    expect(
      emailProviderCooldownAt(
        "resend",
        emailProviderFailure("quota_exceeded", { quotaPeriod: "daily" }),
        1,
        new Date(now as string),
      ),
    ).toEqual(new Date(expected as string));
  });
  it.each(["brevo", "fake_fallback"])("does not infer a daily reset for %s", (code) => {
    const now = new Date("2030-12-31T23:59:00Z");
    expect(
      emailProviderCooldownAt(
        code,
        emailProviderFailure("quota_exceeded", { quotaPeriod: "daily" }),
        1,
        now,
      ),
    ).toEqual(new Date("2031-01-01T00:59:00Z"));
  });
  it.each([7, 31])(
    "retains a validated %s-day server delay independently of a mail deadline",
    (days) => {
      const now = new Date("2030-03-01T10:00:00Z");
      for (const code of ["resend", "brevo"]) {
        for (const reason of ["rate_limited", "quota_exceeded", "misconfigured"] as const) {
          expect(
            emailProviderCooldownAt(
              code,
              emailProviderFailure(reason, {
                retryAfterSeconds: days * 86400,
                ...(reason === "quota_exceeded" ? { quotaPeriod: "daily" as const } : {}),
              }),
              1,
              now,
            ),
          ).toEqual(new Date(now.getTime() + days * 86400000));
        }
      }
    },
  );
  it("uses hourly unknown/monthly quota and configuration probes, and validated rate backoff", () => {
    const now = new Date("2030-03-01T10:00:00Z");
    for (const failure of [
      emailProviderFailure("quota_exceeded"),
      emailProviderFailure("quota_exceeded", { quotaPeriod: "monthly" }),
      emailProviderFailure("misconfigured"),
    ]) {
      expect(emailProviderCooldownAt("resend", failure, 1, now)).toEqual(
        new Date("2030-03-01T11:00:00Z"),
      );
    }
    expect(
      emailProviderCooldownAt(
        "brevo",
        emailProviderFailure("rate_limited", { retryAfterSeconds: 7 }),
        1,
        now,
      ),
    ).toEqual(new Date("2030-03-01T10:00:07Z"));
    expect(emailProviderCooldownAt("brevo", emailProviderFailure("rate_limited"), 3, now)).toEqual(
      new Date("2030-03-01T10:05:00Z"),
    );
  });
});
