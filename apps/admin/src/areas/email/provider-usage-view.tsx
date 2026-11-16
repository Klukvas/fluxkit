import type { AdminEmailProviderStatus, AdminEmailUsagePeriod } from "@fluxkit/api-client";
import { Alert, StatusBadge, type Translator } from "@fluxkit/ui";
import { formatDateTime } from "../../lib/format";
import "./provider-usage.css";

export function usageBarPercent(period: AdminEmailUsagePeriod): number | null {
  if (period.limit === null) return null;
  if (period.accepted >= period.limit) return 100;
  if (period.accepted <= 0) return 0;
  // Counts are safe integers; floor only the visual percentage, keeping count text exact.
  return Number((BigInt(period.accepted) * 100n) / BigInt(period.limit));
}

export function strongestUsageWarning(
  usage: AdminEmailProviderStatus["usage"],
): AdminEmailUsagePeriod["warning"] {
  const warnings = [usage.daily.warning, usage.monthly.warning];
  return warnings.includes("limit_reached")
    ? "limit_reached"
    : warnings.includes("near_limit")
      ? "near_limit"
      : "none";
}

export function includesEarlierCredentials(
  provider: AdminEmailProviderStatus,
  asOf: string,
): boolean {
  const changed = provider.usage.credentialChangedAt;
  return (
    changed !== null &&
    Date.parse(changed) >= Date.parse(provider.usage.monthly.start) &&
    Date.parse(changed) < Date.parse(asOf)
  );
}

export function UsagePeriod({
  t,
  uiLocale,
  period,
  kind,
  code,
}: {
  t: Translator;
  uiLocale: string;
  period: AdminEmailUsagePeriod;
  kind: "daily" | "monthly";
  code: string;
}) {
  const percent = usageBarPercent(period);
  const number = (value: number) => new Intl.NumberFormat(uiLocale).format(value);
  const label = t(`mail.usage.${kind}`);
  const values =
    period.limit === null
      ? t("mail.usage.noLimitValue", { accepted: number(period.accepted) })
      : t("mail.usage.value", { accepted: number(period.accepted), limit: number(period.limit) });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-medium text-foreground">{label}</h4>
        <span className="tabular-nums">{values}</span>
      </div>
      {percent === null ? (
        <p className="text-sm text-muted-foreground">{t("mail.usage.noLimit")}</p>
      ) : (
        <progress
          role="progressbar"
          value={percent}
          max={100}
          aria-label={`${code}: ${label}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={values}
          className={`email-usage-progress h-2 w-full appearance-none overflow-hidden rounded-control border-0 bg-muted ${period.warning === "limit_reached" ? "text-danger" : period.warning === "near_limit" ? "text-warning" : "text-primary"}`}
        >
          {values}
        </progress>
      )}
      {period.warning === "none" ? null : (
        <Alert variant="warning">{t(`mail.usage.warning.${period.warning}`)}</Alert>
      )}
      <p className="text-sm text-muted-foreground">
        {t(`mail.usage.limitSource.${period.limitSource}`)}
      </p>
    </div>
  );
}

export function ProviderUsageView({
  t,
  uiLocale,
  providers,
  asOf,
}: {
  t: Translator;
  uiLocale: string;
  providers: readonly AdminEmailProviderStatus[];
  asOf: string;
}) {
  if (providers.length === 0) return null;
  return (
    <section aria-labelledby="email-providers" className="flex max-w-2xl flex-col gap-4">
      <h2 id="email-providers" className="text-lg font-semibold text-foreground">
        {t("mail.usage.title")}
      </h2>
      <p className="text-muted-foreground">
        {t("mail.usage.asOf", { time: formatDateTime(asOf, uiLocale) })}
      </p>
      <p className="text-muted-foreground">{t("mail.usage.lowerBound")}</p>
      <p className="text-muted-foreground">{t("mail.usage.advisory")}</p>
      <ol className="flex flex-col gap-4">
        {providers.map((provider) => (
          <li
            key={provider.code}
            className="flex flex-col gap-4 rounded-card border border-border p-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="break-all font-mono font-semibold text-foreground">{provider.code}</h3>
              <StatusBadge tone="neutral" label={t(`mail.usage.role.${provider.role}`)} />
              {strongestUsageWarning(provider.usage) === "none" ? null : (
                <StatusBadge
                  tone={
                    strongestUsageWarning(provider.usage) === "limit_reached" ? "danger" : "warning"
                  }
                  label={t(`mail.usage.summary.${strongestUsageWarning(provider.usage)}`)}
                />
              )}
            </div>
            <p className="text-sm text-muted-foreground">{t("mail.usage.scope")}</p>
            {provider.cooldownReason === null ? (
              <p>{t("mail.usage.ready")}</p>
            ) : (
              <Alert variant="warning">
                <p>
                  {t("mail.usage.cooldown", {
                    reason: t(`mail.code.${provider.cooldownReason}`),
                    time:
                      provider.cooldownUntil === null
                        ? t("mail.detail.none")
                        : formatDateTime(provider.cooldownUntil, uiLocale),
                  })}
                </p>
                <p>{t(`mail.usage.probe.${provider.recoveryProbe}`)}</p>
              </Alert>
            )}
            <UsagePeriod
              t={t}
              uiLocale={uiLocale}
              period={provider.usage.daily}
              kind="daily"
              code={provider.code}
            />
            <UsagePeriod
              t={t}
              uiLocale={uiLocale}
              period={provider.usage.monthly}
              kind="monthly"
              code={provider.code}
            />
            <p className="text-sm text-muted-foreground">
              {provider.usage.providerResetAt === null
                ? t("mail.usage.unknownReset")
                : t("mail.usage.reset", {
                    time: formatDateTime(provider.usage.providerResetAt, uiLocale),
                  })}
            </p>
            <p className="text-sm text-muted-foreground">
              {provider.usage.credentialHistory === "unknown"
                ? t("mail.usage.unknownChanges")
                : includesEarlierCredentials(provider, asOf)
                  ? t("mail.usage.includesBeforeChange")
                  : t("mail.usage.trackedChanges")}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
