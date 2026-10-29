import type { AdminAuditEvent } from "@fluxkit/api-client";
import { createTranslator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import {
  leftoverText,
  messagesForArea,
  renderInRouter,
  sentinelTranslator,
} from "../../test-helpers";
import { appendPage, emptyFeed } from "./audit-model";
import { AuditFilterForm, AuditResultsView } from "./audit-view";
import { MESSAGE_FILES } from "./index";

const sentinel = sentinelTranslator();
const noop = () => undefined;
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const TARGET = "22222222-2222-4222-8222-222222222222";

function event(index: number, extra: Partial<AdminAuditEvent> = {}): AdminAuditEvent {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    createdAt: "2026-10-29T10:00:00.000Z",
    adminUserId: ME,
    action: "privacy.erased",
    targetKind: "privacy_request",
    targetId: TARGET,
    detail: { ordersAnonymised: 2, customerDeleted: true },
    ...extra,
  };
}

const query = { from: "", to: "", adminUserId: "", targetId: "" };

function results(feed: ReturnType<typeof emptyFeed>, t = sentinel, loadingMore = false) {
  return renderInRouter(
    <AuditResultsView
      t={t}
      uiLocale="en"
      query={query}
      feed={feed}
      meId={ME}
      adminEmails={new Map([[OTHER, "owner2@example.com"]])}
      loadingMore={loadingMore}
      moreError={null}
      onLoadMore={noop}
    />,
    "/audit",
  );
}

describe("audit log screen", () => {
  it("shows each event with who, what, concerning what and its detail, and links the target", () => {
    const feed = appendPage(emptyFeed(), {
      items: [
        event(1),
        event(2, {
          adminUserId: OTHER,
          action: "customer.unlocked",
          targetKind: "customer",
          detail: {},
        }),
      ],
      total: 2,
      limit: 50,
      offset: 0,
    });
    const html = results(feed);
    expect(html).toContain("§audit.actor.you");
    expect(html).toContain("owner2@example.com");
    expect(html).toContain("§audit.action.privacy.erased");
    expect(html).toContain("/admin-ui/privacy/requests/22222222-2222-4222-8222-222222222222");
    expect(html).toContain("/admin-ui/customers/22222222-2222-4222-8222-222222222222");
    expect(html).toContain("customerDeleted: true; ordersAnonymised: 2");
    expect(html).toContain("§audit.list.noDetail");
  });

  it("offers load more only while the API holds more, and says when the offset limit is reached", () => {
    const some = appendPage(emptyFeed(), { items: [event(1)], total: 5, limit: 1, offset: 0 });
    expect(results(some)).toContain("§audit.list.loadMore");
    const all = appendPage(emptyFeed(), { items: [event(1)], total: 1, limit: 50, offset: 0 });
    expect(results(all)).not.toContain("§audit.list.loadMore");
    const deep = { events: [event(1)], nextOffset: 10_050, total: 40_000 };
    expect(results(deep)).toContain("§audit.list.offsetLimit");
    expect(results(deep)).not.toContain("§audit.list.loadMore");
    expect(results(some, sentinel, true)).toMatch(
      /<button[^>]*disabled=""[^>]*>§audit\.list\.loadingMore</,
    );
  });

  it("renders the empty state and the filter form without hardcoded text", () => {
    const empty = results(emptyFeed());
    expect(empty).toContain("§audit.list.emptyTitle");
    const form = renderInRouter(
      <AuditFilterForm
        t={sentinel}
        query={query}
        adminEmails={null}
        rangeError={null}
        onApply={noop}
      />,
      "/audit",
    );
    expect(form).toContain("§audit.list.action");
    for (const html of [empty, form]) expect(leftoverText(html)).not.toMatch(/[A-Za-z]{3}/);
  });

  it("renders in uk and en with the real messages and no raw key", async () => {
    for (const locale of ["uk", "en"] as const) {
      const t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
      const feed = appendPage(emptyFeed(), { items: [event(1)], total: 9, limit: 1, offset: 0 });
      const html = results(feed, t);
      const form = renderInRouter(
        <AuditFilterForm t={t} query={query} adminEmails={null} rangeError={null} onApply={noop} />,
        "/audit",
      );
      for (const part of [html, form]) expect(part).not.toMatch(/audit\.[a-z]+\.[A-Za-z_.]+/);
    }
  });
});
