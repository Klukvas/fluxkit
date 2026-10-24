import type { AdminCustomer, AdminCustomerSummary } from "@fluxkit/api-client";
import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { Button, createTranslator, type Translator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "../../lib/format";
import {
  leftoverText,
  messagesForArea,
  renderInRouter,
  sentinelTranslator,
} from "../../test-helpers";
import { MESSAGE_FILES } from "./index";
import { offeredCustomerActions } from "./customer-actions";
import { CustomerNoticeView, type CustomerNotice } from "./customer-detail-page";
import { CustomerDetailView } from "./customer-detail-view";
import { DeactivateDialog } from "./customer-dialogs";
import { readCustomerListQuery } from "./customer-list-query";
import {
  CustomerListView,
  CustomerResultsView,
  type CustomerListState,
} from "./customer-list-view";
import { StatusLine } from "./customer-parts";

const noop = () => undefined;

/** The `disabled` attribute itself: the class list of every `Button` holds `disabled:opacity-50`, which proves nothing. */
const hasDisabledAttribute = (tag: string): boolean => /\sdisabled=""/.test(tag);
const sentinel = sentinelTranslator();
const ID = "33333333-3333-4333-8333-333333333333";
const owner = [...ROLE_PERMISSIONS.owner];
const manager = [...ROLE_PERMISSIONS.manager];
const viewer = [...ROLE_PERMISSIONS.viewer];

/** Text as React writes it into markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** The markup with the given data texts (as React escapes them) removed, so only words for people are left. */
function withoutData(html: string, data: readonly string[]): string {
  return data.reduce((rest, text) => rest.split(escapeHtml(text)).join(" "), html);
}

const summary: AdminCustomerSummary = {
  id: ID,
  email: "shopper@example.com",
  firstName: "<b>Olena</b>",
  lastName: "Shevchenko",
  isActive: true,
  lastLoginAt: "2026-10-20T10:00:00.000Z",
  createdAt: "2026-10-01T08:30:00.000Z",
};

function customer(overrides: Partial<AdminCustomer> = {}): AdminCustomer {
  return {
    ...summary,
    phone: "+380501234567",
    isLocked: false,
    orderCount: 3,
    updatedAt: "2026-10-20T10:05:00.000Z",
    ...overrides,
  };
}

function results(t: Translator, state: CustomerListState, search = ""): string {
  return renderInRouter(
    <CustomerResultsView
      t={t}
      uiLocale="en"
      query={readCustomerListQuery(new URLSearchParams(search))}
      state={state}
      onRetry={noop}
      hrefForOffset={(offset) => `/customers?offset=${String(offset)}`}
    />,
    "/customers",
  );
}

function listView(t: Translator, search: string, searchText = "") {
  return renderInRouter(
    <CustomerListView
      t={t}
      query={readCustomerListQuery(new URLSearchParams(search))}
      results={<p>results-slot</p>}
      searchText={searchText}
      onSearchChange={noop}
      onSearchSubmit={noop}
    />,
    `/customers${search}`,
  );
}

function detail(
  t: Translator,
  value: AdminCustomer,
  permissions: readonly string[] | null,
  options: { busy?: boolean } = {},
): string {
  return renderInRouter(
    <CustomerDetailView
      t={t}
      uiLocale="en"
      customer={value}
      actions={offeredCustomerActions(value, permissions)}
      canReadOrders={permissions !== null && permissions.includes("orders.read")}
      onAction={noop}
      busy={options.busy ?? false}
      statusLine={<StatusLine />}
    />,
    `/customers/${value.id}`,
  );
}

describe("customer list screen", () => {
  it("renders every state without hardcoded text", () => {
    const states: CustomerListState[] = [
      { status: "loading" },
      { status: "ready", data: { items: [summary], total: 120, limit: 50, offset: 50 } },
      { status: "ready", data: { items: [], total: 0, limit: 50, offset: 0 } },
      { status: "forbidden" },
      { status: "notFound" },
      { status: "error", failure: { kind: "network" } },
    ];
    const rowData = [
      summary.email,
      summary.firstName,
      summary.lastName,
      formatDateTime(summary.lastLoginAt ?? "", "en"),
      formatDate(summary.createdAt, "en"),
    ];
    for (const state of states) {
      expect(leftoverText(withoutData(results(sentinel, state), rowData)), state.status).toBe("");
    }
    expect(leftoverText(listView(sentinel, "?q=ann", "ann"))).toBe("results slot");
  });

  it("links each row to its detail by id, as text, with the status in words", () => {
    const html = results(sentinel, {
      status: "ready",
      data: { items: [summary], total: 1, limit: 50, offset: 0 },
    });
    expect(html).toContain(`href="/admin-ui/customers/${ID}"`);
    expect(html).toContain("§customer.status.active");
    expect(html).toContain('<th scope="row"');
    // Personal text is escaped markup text, never markup.
    expect(html).toContain("&lt;b&gt;Olena&lt;/b&gt;");
    expect(html).not.toContain("<b>Olena");
    // No personal data in any link.
    for (const href of html.matchAll(/href="([^"]*)"/g)) {
      expect(href[1]).not.toContain("example.com");
      expect(href[1]).not.toContain("Olena");
    }
  });

  it("shows a deactivated customer, a missing name and a customer who never signed in", () => {
    const html = results(sentinel, {
      status: "ready",
      data: {
        items: [{ ...summary, isActive: false, firstName: "", lastName: "", lastLoginAt: null }],
        total: 1,
        limit: 50,
        offset: 0,
      },
    });
    expect(html).toContain("§customer.status.deactivated");
    expect(html).toContain("§customer.list.noName");
    expect(html).toContain("§customer.list.neverSignedIn");
  });

  it("asks for nothing the list does not have: no lock column, no order count column", () => {
    const html = results(sentinel, {
      status: "ready",
      data: { items: [summary], total: 1, limit: 50, offset: 0 },
    });
    expect(html).not.toContain("§customer.lock.");
    expect(html).not.toContain("§customer.detail.orderCount");
  });

  it("tells an empty shop from no match, and a page past the end from both", () => {
    const empty = { status: "ready" as const, data: { items: [], total: 0, limit: 50, offset: 0 } };
    expect(results(sentinel, empty)).toContain("§customer.list.emptyTitle");
    const none = results(sentinel, empty, "?q=zzz");
    expect(none).toContain("§customer.list.noMatchTitle");
    expect(none).toContain('href="/admin-ui/customers"');
    const past = results(
      sentinel,
      { status: "ready", data: { items: [], total: 3, limit: 50, offset: 50 } },
      "?offset=50",
    );
    expect(past).toContain("§customer.list.pastEnd");
    expect(past).toContain("offset=0");
  });

  it("pages with links and spells out the range", () => {
    const html = results(
      sentinel,
      { status: "ready", data: { items: [summary], total: 120, limit: 50, offset: 50 } },
      "?offset=50",
    );
    expect(html).toContain("§customer.list.pageRange");
    expect(html).toContain('href="/admin-ui/customers?offset=0"');
    expect(html).toContain('href="/admin-ui/customers?offset=100"');
  });

  it("explains a forbidden, failed or missing read in words, with a retry for a failure", () => {
    expect(results(sentinel, { status: "forbidden" })).toContain("§error.forbiddenData");
    const failed = results(sentinel, { status: "error", failure: { kind: "network" } });
    expect(failed).toContain("§errors.network");
    expect(failed).toContain("§action.retry");
  });

  it("has a search form that posts to nowhere, with the API's length limit, and a way back", () => {
    const html = listView(sentinel, "?q=ann", "ann");
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).not.toMatch(/<form[^>]*action=/);
    expect(html).toMatch(/<input[^>]*name="q"[^>]*/);
    expect(html).toContain('maxLength="254"');
    expect(html).toContain("§customer.list.clearSearch");
    expect(listView(sentinel, "")).not.toContain("§customer.list.clearSearch");
  });
});

describe("customer detail screen", () => {
  it("renders without hardcoded text", () => {
    const value = customer({ isLocked: true });
    const data = [
      value.email,
      value.firstName,
      value.lastName,
      value.phone ?? "",
      formatDateTime(value.lastLoginAt ?? "", "en"),
      formatDateTime(value.createdAt, "en"),
      formatDateTime(value.updatedAt, "en"),
    ];
    const html = withoutData(detail(sentinel, value, owner), data);
    expect(leftoverText(html)).toBe("");
  });

  it("shows the profile, the status, the lock and the order count as text only", () => {
    const html = detail(sentinel, customer({ isLocked: true }), owner);
    expect(html).toContain("shopper@example.com");
    expect(html).toContain("&lt;b&gt;Olena&lt;/b&gt; Shevchenko");
    expect(html).not.toContain("<b>Olena");
    expect(html).toContain("+380501234567");
    expect(html).toContain("§customer.status.active");
    expect(html).toContain("§customer.lock.locked");
    expect(html).toContain("§customer.detail.lockedAlert");
    expect(html).toContain("<dd");
    expect(html).toContain(">3<");
  });

  it("says a missing name, phone and sign-in in words", () => {
    const html = detail(
      sentinel,
      customer({ firstName: "", lastName: "", phone: null, lastLoginAt: null }),
      owner,
    );
    expect(html).toContain("§customer.detail.noName");
    expect(html).toContain("§customer.detail.noPhone");
    expect(html).toContain("§customer.detail.neverSignedIn");
  });

  it("shows no lock alert for a customer who is not locked", () => {
    const html = detail(sentinel, customer(), owner);
    expect(html).toContain("§customer.lock.notLocked");
    expect(html).not.toContain("§customer.detail.lockedAlert");
  });

  it("links the customer's orders by id only, and only to a session that may read orders", () => {
    const withOrders = detail(sentinel, customer(), [...owner]);
    expect(withOrders).toContain(`href="/admin-ui/orders?customerId=${ID}"`);
    expect(withOrders).toContain("§customer.detail.ordersLink");
    const without = detail(sentinel, customer(), ["customers.read", "customers.write"]);
    expect(without).not.toContain("§customer.detail.ordersLink");
    expect(without).not.toContain("customerId=");
    for (const href of withOrders.matchAll(/href="([^"]*)"/g)) {
      expect(href[1]).not.toContain("example.com");
      expect(href[1]).not.toContain("Olena");
      expect(href[1]).not.toContain("380501234567");
    }
  });

  it("offers deactivate to the owner and the manager for an active customer, and nothing to the viewer", () => {
    for (const permissions of [owner, manager]) {
      const html = detail(sentinel, customer(), permissions);
      expect(html).toContain("§customer.action.deactivate");
      expect(html).not.toContain("§customer.action.activate<");
      expect(html).not.toContain("§customer.action.unlock");
    }
    for (const permissions of [viewer, ["customers.read"], [], null]) {
      const html = detail(sentinel, customer({ isLocked: true }), permissions);
      expect(html).not.toContain("§customer.detail.actionsTitle");
      expect(html).not.toContain("<button");
    }
  });

  it("offers activate (not deactivate) for a deactivated customer", () => {
    const html = detail(sentinel, customer({ isActive: false }), owner);
    expect(html).toContain("§customer.action.activate<");
    expect(html).not.toContain("§customer.action.deactivate<");
    expect(html).toContain("§customer.status.deactivated");
  });

  it("offers unlock only while the customer is locked", () => {
    expect(detail(sentinel, customer({ isLocked: false }), owner)).not.toContain(
      "§customer.action.unlock",
    );
    const locked = detail(sentinel, customer({ isLocked: true }), owner);
    expect(locked).toContain("§customer.action.unlock<");
    expect(locked).toContain("§customer.action.unlockHint");
  });

  it("turns every action button off while a write runs or the customer reloads", () => {
    const html = detail(sentinel, customer({ isLocked: true }), owner, { busy: true });
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((match) => match[0]);
    expect(buttons.length).toBe(2);
    for (const button of buttons) expect(hasDisabledAttribute(button), button).toBe(true);
  });

  it("explains in the hint what each action does, and nothing else", () => {
    const html = detail(sentinel, customer({ isLocked: true }), owner);
    expect(html).toContain("§customer.action.deactivateHint");
    expect(html).toContain("§customer.action.unlockHint");
  });
});

describe("the deactivation confirmation", () => {
  function dialog(busy: boolean) {
    return renderInRouter(
      <DeactivateDialog t={sentinel} open busy={busy} onConfirm={noop} onClose={noop} />,
    );
  }

  it("is a modal alert dialog with the consequence spelled out and the safe choice first", () => {
    const html = dialog(false);
    expect(leftoverText(html)).toBe("");
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("§customer.deactivate.description");
    expect(html).toContain("§customer.deactivate.submit");
    expect(html.indexOf("§customer.dialog.cancel")).toBeLessThan(
      html.indexOf("§customer.deactivate.submit"),
    );
    expect(html).toContain('data-autofocus=""');
  });

  it("has the danger look and turns both buttons off while sending", () => {
    const html = dialog(true);
    expect(html).toContain("§customer.dialog.sending");
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((match) => match[0]);
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const button of buttons) expect(hasDisabledAttribute(button), button).toBe(true);
    // The confirm button has the danger look: the very classes a danger Button renders.
    const dangerClass = /class="([^"]*)"/.exec(
      renderToStaticMarkup(<Button variant="danger">x</Button>),
    )?.[1];
    expect(dangerClass).toBeDefined();
    expect(dialog(false)).toContain(`class="${dangerClass ?? ""}"`);
  });
});

describe("the status line after an action", () => {
  const stored = customer();
  function notice(value: CustomerNotice | null, current = stored, refreshing = false): string {
    return renderInRouter(
      <CustomerNoticeView t={sentinel} notice={value} customer={current} refreshing={refreshing} />,
    );
  }

  it("says nothing before any action", () => {
    expect(notice(null)).toBe("");
  });

  it("confirms what the server did, for every action", () => {
    for (const action of ["deactivate", "activate", "unlock"] as const) {
      expect(notice({ kind: "done", action })).toContain(`§customer.notice.done.${action}`);
    }
  });

  it("explains a refusal through the shell's problem map, never the API's text", () => {
    const html = notice({
      kind: "refused",
      action: "deactivate",
      descriptor: { key: "errors.code.forbidden" },
    });
    expect(html).toContain("§customer.notice.refused.deactivate");
    expect(html).toContain("§errors.code.forbidden");
    const unknown = notice({
      kind: "refused",
      action: "unlock",
      descriptor: { key: "errors.generic", code: "weird_code" },
    });
    expect(unknown).toContain("§errors.generic");
    expect(unknown).toContain("§errors.reference");
  });

  it("after a lost answer says it is reading, then what the stored customer is", () => {
    const before = customer();
    const reading = notice({ kind: "unknown", action: "deactivate", before }, before, false);
    expect(reading).toContain("§customer.notice.unknownReading");
    expect(notice({ kind: "unknown", action: "deactivate", before }, before, true)).toContain(
      "§customer.notice.unknownReading",
    );
    const after = customer({ isActive: false });
    const html = notice({ kind: "unknown", action: "deactivate", before }, after, false);
    expect(html).toContain("§customer.notice.unknown.now_deactivated");
    expect(html).not.toContain("unknownReading");
    const unchanged = customer();
    expect(notice({ kind: "unknown", action: "deactivate", before }, unchanged, false)).toContain(
      "§customer.notice.unknown.still_active",
    );
  });
});

describe("with the real messages", () => {
  it("renders the list, the detail, the dialog and every notice in uk and en", async () => {
    for (const locale of ["uk", "en"] as const) {
      const t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
      const rows = results(t, {
        status: "ready",
        data: { items: [summary], total: 1, limit: 50, offset: 0 },
      });
      expect(rows).toContain(t("customer.status.active"));
      expect(listView(t, "?q=ann", "ann")).toContain(t("customer.list.clearSearch"));
      const html = detail(t, customer({ isLocked: true }), owner);
      expect(html).toContain(t("customer.action.unlock"));
      expect(html).toContain(escapeHtml(t("customer.detail.lockedAlert")));
      expect(html).toContain(t("customer.detail.ordersLink"));
      expect(
        renderInRouter(
          <DeactivateDialog t={t} open busy={false} onConfirm={noop} onClose={noop} />,
        ),
      ).toContain(t("customer.deactivate.title"));
      const before = customer();
      for (const action of ["deactivate", "activate", "unlock"] as const) {
        renderInRouter(
          <CustomerNoticeView
            t={t}
            notice={{ kind: "done", action }}
            customer={before}
            refreshing={false}
          />,
        );
        renderInRouter(
          <CustomerNoticeView
            t={t}
            notice={{ kind: "unknown", action, before }}
            customer={customer({ isActive: false })}
            refreshing={false}
          />,
        );
      }
    }
  });
});
