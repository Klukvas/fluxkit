import type { AdminEmailProviderStatus, AdminEmailUsagePeriod } from "@fluxkit/api-client";
import { createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { messagesForArea } from "../../test-helpers";
import { MESSAGE_FILES } from "./index";
import {
  ProviderUsageView,
  usageBarPercent,
  strongestUsageWarning,
  includesEarlierCredentials,
} from "./provider-usage-view";

const day: AdminEmailUsagePeriod = {
  start: "2026-11-16T00:00:00.000Z",
  end: "2026-11-17T00:00:00.000Z",
  accepted: 120,
  limit: 100,
  limitSource: "env",
  warning: "limit_reached",
};
function provider(code = "resend"): AdminEmailProviderStatus {
  return {
    code,
    role: code === "resend" ? "primary" : "fallback",
    cooldownUntil: "2026-11-17T00:05:00.000Z",
    cooldownReason: "quota_exceeded",
    recoveryProbe: "idle",
    usage: {
      source: "retained_email_message",
      lowerBound: true,
      lowerBoundScope: "provider_all_accounts",
      countScope: "provider_all_accounts",
      credentialHistory: "unknown",
      credentialChangedAt: null,
      warningBasis: "all_accounts_vs_configured_limit",
      timeZone: "UTC",
      daily: day,
      monthly: { ...day, limit: null, warning: "none" },
      providerResetAt: null,
    },
  };
}
const messages = {} as Record<"uk" | "en", Awaited<ReturnType<typeof messagesForArea>>>;
beforeAll(async () => {
  messages.uk = await messagesForArea("uk", MESSAGE_FILES);
  messages.en = await messagesForArea("en", MESSAGE_FILES);
});

describe("provider route and usage", () => {
  it("clamps only the visual percentage", () => {
    expect(usageBarPercent(day)).toBe(100);
    expect(usageBarPercent({ ...day, accepted: 79 })).toBe(79);
    expect(usageBarPercent({ ...day, limit: null })).toBeNull();
  });

  it.each(["uk", "en"] as const)(
    "shows ordered providers, unchanged counts and qualified accessible warnings in %s",
    (locale) => {
      const html = renderToStaticMarkup(
        <ProviderUsageView
          t={createTranslator(messages[locale], locale)}
          uiLocale={locale}
          providers={[provider(), provider("brevo")]}
          asOf="2026-11-16T12:00:00.000Z"
        />,
      );
      expect(html.indexOf("resend")).toBeLessThan(html.indexOf("brevo"));
      expect(html).toContain("120 / 100");
      expect(html).toContain('role="progressbar"');
      expect(html).toContain('aria-valuenow="100"');
      expect(html).toContain('aria-valuetext="120 / 100"');
      expect(html).toContain('value="100"');
      expect(html).toContain('max="100"');
      expect(html).not.toContain("style=");
      expect(html).toContain("UTC");
      expect(html).not.toContain("mail.usage.");
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("NaN");
    },
  );

  it("uses the strongest local warning and only notes a credential change inside the captured window", () => {
    const current = provider();
    expect(strongestUsageWarning(current.usage)).toBe("limit_reached");
    expect(
      strongestUsageWarning({ ...current.usage, daily: { ...day, warning: "near_limit" } }),
    ).toBe("near_limit");
    expect(strongestUsageWarning({ ...current.usage, daily: { ...day, warning: "none" } })).toBe(
      "none",
    );
    const changed = {
      ...current,
      usage: {
        ...current.usage,
        credentialHistory: "tracked" as const,
        credentialChangedAt: "2026-11-16T10:00:00.000Z",
      },
    };
    expect(includesEarlierCredentials(changed, "2026-11-16T12:00:00.000Z")).toBe(true);
    expect(includesEarlierCredentials(changed, "2026-11-16T09:00:00.000Z")).toBe(false);
  });

  it("renders no usage chain in off mode", () => {
    expect(
      renderToStaticMarkup(
        <ProviderUsageView
          t={createTranslator(messages.en, "en")}
          uiLocale="en"
          providers={[]}
          asOf="2026-11-16T12:00:00.000Z"
        />,
      ),
    ).toBe("");
  });
});
