import type { AdminEmailSuppression } from "@fluxkit/api-client";
import { createTranslator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import { messagesForArea, renderInRouter, sentinelTranslator } from "../../test-helpers";
import { MESSAGE_FILES } from "./index";
import { SuppressionsView, type SuppressionsState } from "./suppressions-view";

const entry: AdminEmailSuppression = {
  id: "11111111-1111-4111-8111-111111111111",
  toAddress: "alice@example.com",
  toAddressMasked: "a***@e***.com",
  reason: "hard_bounce",
  sourceProvider: "resend",
  firstSeenAt: "2026-11-16T10:00:00.000Z",
  lastSeenAt: "2026-11-16T10:00:00.000Z",
};

const ready: SuppressionsState = {
  status: "ready",
  data: { items: [entry], total: 120, limit: 50, offset: 50 },
};

function view(state: SuppressionsState, canManage = true, busy = false, offset = 50) {
  return renderInRouter(
    <SuppressionsView
      t={sentinelTranslator()}
      uiLocale="en"
      state={state}
      limit={50}
      offset={offset}
      canManage={canManage}
      busy={busy}
      onRetry={() => undefined}
      onRemove={() => undefined}
      hrefForOffset={(next) => `/email/suppressions?offset=${String(next)}`}
    />,
  );
}

describe("email suppressions", () => {
  it("shows a masked address, reason, provider and both event times with paging", () => {
    const html = view(ready);
    expect(html).toContain(entry.toAddressMasked);
    expect(html).toContain("§mail.suppressions.reason.hard_bounce");
    expect(html).toContain("resend");
    expect(html).toContain("§mail.suppressions.firstSeen");
    expect(html).toContain("§mail.suppressions.lastSeen");
    expect(html).toContain('rel="prev"');
    expect(html).toContain('rel="next"');
    expect(html).toContain("tabular-nums");
    expect(html).not.toContain(entry.id);
    expect(html).not.toContain("@example.com");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("§mail.suppressions.showLabel");
    expect(html).toContain("§mail.suppressions.show");
  });

  it("offers removal only with email.manage and disables it during a write", () => {
    expect(view(ready)).toContain("§mail.suppressions.remove");
    expect(view(ready, false)).not.toContain("§mail.suppressions.remove");
    expect(view(ready, true, true)).toMatch(/<button[^>]*disabled=""/);
  });

  it("starts each row masked even when recipients have identical masks", () => {
    const html = view({
      status: "ready",
      data: {
        ...ready.data,
        items: [
          entry,
          { ...entry, id: "22222222-2222-4222-8222-222222222222", toAddress: "amy@example.com" },
        ],
      },
    });
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(html).not.toContain(entry.toAddress);
    expect(html).not.toContain("amy@example.com");
  });

  it("shows skeleton rows, empty, past-end, forbidden and retry states", () => {
    expect(view({ status: "loading" })).toContain('aria-busy="true"');
    const empty: SuppressionsState = {
      status: "ready",
      data: { items: [], total: 0, limit: 50, offset: 0 },
    };
    expect(view(empty, true, false, 0)).toContain("§mail.suppressions.emptyTitle");
    expect(view(empty)).toContain("§mail.list.firstPage");
    expect(view({ status: "forbidden" })).toContain("§error.forbiddenData");
    expect(view({ status: "error", failure: { kind: "network" } })).toContain("§action.retry");
  });

  it("renders both languages with translated reasons and no untranslated keys", async () => {
    for (const locale of ["uk", "en"] as const) {
      const t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
      const html = renderInRouter(
        <SuppressionsView
          t={t}
          uiLocale={locale}
          state={ready}
          limit={50}
          offset={50}
          canManage
          busy={false}
          onRetry={() => undefined}
          onRemove={() => undefined}
          hrefForOffset={() => "/email/suppressions"}
        />,
      );
      expect(html, locale).not.toMatch(/mail\.[a-z]+\.[a-zA-Z]+/);
    }
  });
});
