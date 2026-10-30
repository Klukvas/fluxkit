import type { AdminAuditEvent } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTIONS,
  AUDIT_PAGE_SIZE,
  appendPage,
  auditRequest,
  canLoadMore,
  detailText,
  emptyFeed,
  hasAuditFilters,
  readAuditQuery,
  writeAuditQuery,
} from "./audit-model";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

function event(index: number, extra: Partial<AdminAuditEvent> = {}): AdminAuditEvent {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    createdAt: `2026-10-29T10:${String(59 - index).padStart(2, "0")}:00.000Z`,
    adminUserId: ID_A,
    action: "customer.unlocked",
    targetKind: "customer",
    targetId: ID_B,
    detail: {},
    ...extra,
  };
}

describe("the audit feed", () => {
  it("appends pages in order and skips an event it already holds (new events shift offset paging)", () => {
    const first = appendPage(emptyFeed(), {
      items: [event(1), event(2)],
      total: 5,
      limit: 2,
      offset: 0,
    });
    expect(first.events.map((entry) => entry.id.slice(-2))).toEqual(["01", "02"]);
    expect(first.nextOffset).toBe(2);
    // A newer event arrived meanwhile: the next page starts with the last event of the first one.
    const second = appendPage(first, {
      items: [event(2), event(3)],
      total: 6,
      limit: 2,
      offset: 2,
    });
    expect(second.events.map((entry) => entry.id.slice(-2))).toEqual(["01", "02", "03"]);
    expect(second.nextOffset).toBe(4);
    expect(second.total).toBe(6);
  });

  it("offers more while the API holds more and the offset stays within its limit", () => {
    const feed = appendPage(emptyFeed(), { items: [event(1)], total: 3, limit: 1, offset: 0 });
    expect(canLoadMore(feed)).toBe("more");
    const done = appendPage(feed, { items: [event(2), event(3)], total: 3, limit: 2, offset: 1 });
    expect(canLoadMore(done)).toBe("end");
    const deep = { events: [], nextOffset: 10_001, total: 50_000 };
    expect(canLoadMore(deep)).toBe("offset_limit");
    expect(canLoadMore(emptyFeed())).toBe("end");
  });
});

describe("the audit query in the URL", () => {
  it("reads known filters and drops junk (a hand-edited address means no filter)", () => {
    const query = readAuditQuery(
      new URLSearchParams(
        `action=privacy.erased&targetKind=privacy_request&adminUserId=${ID_A}&targetId=${ID_B}&from=2026-10-01&to=2026-10-02`,
      ),
    );
    expect(query).toEqual({
      action: "privacy.erased",
      targetKind: "privacy_request",
      adminUserId: ID_A,
      targetId: ID_B,
      from: "2026-10-01",
      to: "2026-10-02",
    });
    expect(
      readAuditQuery(
        new URLSearchParams("action=nope&targetKind=x&adminUserId=y&targetId=z&from=1&to=2"),
      ),
    ).toEqual({ from: "", to: "", adminUserId: "", targetId: "" });
  });

  it("writes only set filters, and the bare path for none", () => {
    expect(writeAuditQuery({ from: "", to: "", adminUserId: "", targetId: "" })).toBe("");
    expect(
      writeAuditQuery({
        action: "privacy.lookup",
        from: "2026-10-01",
        to: "",
        adminUserId: "",
        targetId: "",
      }),
    ).toBe("?action=privacy.lookup&from=2026-10-01");
    expect(hasAuditFilters({ from: "", to: "", adminUserId: "", targetId: "" })).toBe(false);
    expect(
      hasAuditFilters({ targetKind: "order", from: "", to: "", adminUserId: "", targetId: "" }),
    ).toBe(true);
  });

  it("builds the API options for a page: filters, day range as instants, and the offset", () => {
    const request = auditRequest(
      {
        action: "privacy.exported",
        from: "2026-10-01",
        to: "2026-10-02",
        adminUserId: ID_A,
        targetId: "",
      },
      "UTC",
      40,
    );
    expect(request).toEqual({
      ok: true,
      options: {
        action: "privacy.exported",
        adminUserId: ID_A,
        from: "2026-10-01T00:00:00+00:00",
        to: "2026-10-03T00:00:00+00:00",
        limit: AUDIT_PAGE_SIZE,
        offset: 40,
      },
    });
    expect(
      auditRequest(
        { from: "2026-10-05", to: "2026-10-01", adminUserId: "", targetId: "" },
        "UTC",
        0,
      ),
    ).toEqual({
      ok: false,
      field: "to",
      reason: "end_before_start",
    });
  });

  it("knows every action of the API (hand-written list of docs/api/audit.md)", () => {
    expect([...AUDIT_ACTIONS].sort()).toEqual(
      [
        "admin_user.created",
        "admin_user.deactivated",
        "admin_user.activated",
        "admin_user.password_reset",
        "admin_user.role_changed",
        "customer.activated",
        "customer.deactivated",
        "customer.unlocked",
        "privacy.erased",
        "privacy.exported",
        "privacy.lookup",
        "privacy.request_changed",
      ].sort(),
    );
  });
});

describe("detailText", () => {
  it("writes codes, counts, flags and lists of codes as key: value pairs in key order", () => {
    expect(
      detailText({
        toRole: "manager",
        fromRole: "viewer",
        count: 3,
        flag: false,
        codes: ["a", "b"],
      }),
    ).toBe("codes: a, b; count: 3; flag: false; fromRole: viewer; toRole: manager");
    expect(detailText({})).toBe("");
  });
});
