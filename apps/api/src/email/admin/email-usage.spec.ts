import { describe, expect, it } from "vitest";
import {
  emailUsagePeriods,
  emailUsageWarning,
  providerUsage,
  safeEmailUsageCount,
} from "./email-usage.js";

describe("email usage UTC periods and advisory comparisons", () => {
  it.each([
    [
      "2028-02-29T23:59:59.999Z",
      "2028-02-29T00:00:00.000Z",
      "2028-03-01T00:00:00.000Z",
      "2028-02-01T00:00:00.000Z",
      "2028-03-01T00:00:00.000Z",
    ],
    [
      "2026-12-31T23:59:59.999Z",
      "2026-12-31T00:00:00.000Z",
      "2027-01-01T00:00:00.000Z",
      "2026-12-01T00:00:00.000Z",
      "2027-01-01T00:00:00.000Z",
    ],
    [
      "2027-01-01T00:00:00.000Z",
      "2027-01-01T00:00:00.000Z",
      "2027-01-02T00:00:00.000Z",
      "2027-01-01T00:00:00.000Z",
      "2027-02-01T00:00:00.000Z",
    ],
    [
      "2026-03-29T01:30:00.000Z",
      "2026-03-29T00:00:00.000Z",
      "2026-03-30T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
      "2026-04-01T00:00:00.000Z",
    ],
  ])(
    "uses UTC boundaries at %s, independent of the host time zone",
    (instant, dayStart, dayEnd, monthStart, monthEnd) => {
      const previous = process.env.TZ;
      try {
        for (const zone of ["Pacific/Honolulu", "Europe/Kyiv", "Asia/Tokyo"]) {
          process.env.TZ = zone;
          const periods = emailUsagePeriods(new Date(instant));
          expect(
            [
              periods.daily.start,
              periods.daily.end,
              periods.monthly.start,
              periods.monthly.end,
            ].map((value) => value.toISOString()),
          ).toEqual([dayStart, dayEnd, monthStart, monthEnd]);
        }
      } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
      }
    },
  );

  it.each([
    [79, "none"],
    [80, "near_limit"],
    [99, "near_limit"],
    [100, "limit_reached"],
    [150, "limit_reached"],
  ] as const)("compares %i against 100", (count, expected) => {
    expect(emailUsageWarning(count, 100)).toBe(expected);
    expect(emailUsageWarning(count, null)).toBe("none");
  });

  it("preserves all-account lower-bound scope, defaults and unknown account-change metadata", () => {
    const asOf = new Date("2026-11-16T12:00:00.000Z");
    const resend = providerUsage("resend", asOf, { daily: 120, monthly: 4000 });
    expect(resend).toMatchObject({
      lowerBound: true,
      lowerBoundScope: "provider_all_accounts",
      countScope: "provider_all_accounts",
      credentialChangedAt: null,
      credentialHistory: "unknown",
      warningBasis: "all_accounts_vs_configured_limit",
      timeZone: "UTC",
      daily: { accepted: 120, limit: 100, warning: "limit_reached" },
      monthly: { limit: 3000 },
      providerResetAt: "2026-11-17T00:00:00.000Z",
    });
    expect(providerUsage("brevo", asOf, { daily: 0, monthly: 0 })).toMatchObject({
      daily: { limit: 300 },
      monthly: { limit: null },
      providerResetAt: null,
    });
    expect(providerUsage("fake", asOf, { daily: 0, monthly: 0 })).toMatchObject({
      daily: { limit: null },
      monthly: { limit: null },
    });
    expect(
      providerUsage(
        "resend",
        asOf,
        { daily: 120, monthly: 4000 },
        { resend: { daily: null, monthly: 5000 } },
      ),
    ).toMatchObject({
      daily: { accepted: 120, limit: null, limitSource: "env", warning: "none" },
      monthly: { limit: 5000, limitSource: "env", warning: "near_limit" },
    });
  });

  it("never rounds a count or echoes invalid count input", () => {
    expect(safeEmailUsageCount("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
    for (const invalid of ["9007199254740992", "-1", "0.1", "secret-string"]) {
      expect(() => safeEmailUsageCount(invalid)).toThrow(/^email_usage_count_(invalid|unsafe)$/);
    }
  });
});
