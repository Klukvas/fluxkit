/** UTC reporting periods. These are local history windows, not inferred provider billing periods. */
export function emailUsagePeriods(asOf: Date) {
  const year = asOf.getUTCFullYear();
  const month = asOf.getUTCMonth();
  const day = asOf.getUTCDate();
  return {
    daily: {
      start: new Date(Date.UTC(year, month, day)),
      end: new Date(Date.UTC(year, month, day + 1)),
    },
    monthly: {
      start: new Date(Date.UTC(year, month, 1)),
      end: new Date(Date.UTC(year, month + 1, 1)),
    },
  };
}

export type UsageWarning = "none" | "near_limit" | "limit_reached";
export type EmailUsageLimits = Readonly<
  Record<string, { readonly daily: number | null; readonly monthly: number | null }>
>;

export function emailUsageWarning(accepted: number, limit: number | null): UsageWarning {
  if (limit === null) return "none";
  if (accepted >= limit) return "limit_reached";
  return accepted / limit >= 0.8 ? "near_limit" : "none";
}

/** PostgreSQL counts are strings to avoid silently rounding a bigint into a JSON number. */
export function safeEmailUsageCount(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("email_usage_count_invalid");
  const count = Number(value);
  if (!Number.isSafeInteger(count)) throw new Error("email_usage_count_unsafe");
  return count;
}

export function providerUsage(
  code: string,
  asOf: Date,
  counts: { readonly daily: number; readonly monthly: number },
  overrides: EmailUsageLimits = {},
) {
  const limits =
    overrides[code] ??
    (code === "resend"
      ? { daily: 100, monthly: 3000 }
      : code === "brevo"
        ? { daily: 300, monthly: null }
        : { daily: null, monthly: null });
  const periods = emailUsagePeriods(asOf);
  const limitSource = Object.hasOwn(overrides, code) ? ("env" as const) : ("default" as const);
  const period = (name: "daily" | "monthly") => ({
    start: periods[name].start.toISOString(),
    end: periods[name].end.toISOString(),
    accepted: counts[name],
    limit: limits[name],
    limitSource,
    warning: emailUsageWarning(counts[name], limits[name]),
  });
  return {
    source: "retained_email_message" as const,
    lowerBound: true as const,
    lowerBoundScope: "provider_all_accounts" as const,
    countScope: "provider_all_accounts" as const,
    credentialChangedAt: null,
    credentialHistory: "unknown" as const,
    warningBasis: "all_accounts_vs_configured_limit" as const,
    timeZone: "UTC" as const,
    daily: period("daily"),
    monthly: period("monthly"),
    providerResetAt: code === "resend" ? periods.daily.end.toISOString() : null,
  };
}
