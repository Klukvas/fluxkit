import type { AdminConfig, AdminOrder, AdminOrderSummary } from "@fluxkit/api-client";
import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { createTranslator, type Translator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import { formatDateTime } from "../../lib/format";
import {
  leftoverText,
  messagesForArea,
  renderInRouter,
  sentinelTranslator,
} from "../../test-helpers";
import { MESSAGE_FILES } from "./index";
import { offeredActions } from "./order-actions";
import { OrderDetailView, type HistoryRow } from "./order-detail-view";
import { OrderNoticeView } from "./order-detail-page";
import { CancelDialog, FulfilDialog, MarkPaidDialog } from "./order-dialogs";
import { readOrderListQuery } from "./order-list-query";
import { OrderListView, OrderResultsView, type OrderListState } from "./order-list-view";
import { StatusLine } from "./order-parts";
import { historyActor } from "./order-view";

const noop = () => undefined;

/** The opening tag of the element with this `name`. */
function tag(html: string, element: string, name: string): string {
  const found = [...html.matchAll(new RegExp(`<${element}[^>]*>`, "g"))]
    .map((match) => match[0])
    .find((text) => text.includes(`name="${name}"`));
  if (found === undefined) throw new Error(`No <${element} name="${name}">`);
  return found;
}

/** The markup with the given data texts (as React escapes them) removed, so only words for people are left. */
function withoutData(html: string, data: readonly string[]): string {
  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return data.reduce((rest, text) => rest.split(escape(text)).join(" "), html);
}
const sentinel = sentinelTranslator();
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";

const config: AdminConfig = {
  defaultLocale: "uk",
  locales: ["uk", "en"],
  shopCurrency: "UAH",
  currencyExponent: 2,
  supportedCurrencies: [{ code: "UAH", exponent: 2 }],
  pricesIncludeTax: true,
  lowStockThreshold: 5,
  emailDelivery: false,
  onlinePayment: false,
  search: false,
  media: {
    uploadsEnabled: true,
    maxBytes: 10485760,
    contentTypes: ["image/jpeg", "image/png", "image/webp"],
  },
};

function order(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: "0b5f8a52-7a9e-4c7a-9d0e-1a2b3c4d5e6f",
    number: "7K3M-9QX2",
    status: "awaiting_payment",
    locale: "uk",
    currency: "UAH",
    customerId: CUSTOMER,
    isGuest: false,
    contact: {
      email: "shopper@example.com",
      phone: "+380501234567",
      firstName: "<b>Olena</b>",
      lastName: "Shevchenko",
    },
    contactErasedAt: null,
    shippingAddress: {
      countryCode: "UA",
      city: "Kyiv",
      line1: "<script>alert(1)</script> Street 1",
      postalCode: "01001",
    },
    billingAddress: null,
    shipping: null,
    shipments: [],
    payments: [],
    items: [
      {
        position: 0,
        productId: null,
        variantId: null,
        sku: "SKU-1",
        productTitle: { uk: "Футболка", en: "T-shirt" },
        variantTitle: null,
        optionValues: [],
        imageUrl: "https://example.com/a.jpg",
        unitPrice: { amount: 1999, currency: "UAH" },
        compareAtAmount: null,
        quantity: 2,
        lineTotal: { amount: 3998, currency: "UAH" },
        requiresShipping: true,
        reservations: [{ status: "active", quantity: 2 }],
      },
    ],
    subtotal: { amount: 3998, currency: "UAH" },
    shippingTotal: { amount: 0, currency: "UAH" },
    discountTotal: { amount: 0, currency: "UAH" },
    taxTotal: { amount: 0, currency: "UAH" },
    total: { amount: 3998, currency: "UAH" },
    adjustments: [],
    history: [
      {
        fromStatus: null,
        toStatus: "awaiting_payment",
        actorType: "guest",
        actorAdminId: null,
        reason: null,
        at: "2026-10-20T10:00:00.000Z",
      },
    ],
    placedAt: "2026-10-20T10:00:00.000Z",
    expiresAt: "2026-10-20T10:30:00.000Z",
    paidAt: null,
    fulfilledAt: null,
    cancelledAt: null,
    expiredAt: null,
    cancellationReason: null,
    paymentReference: null,
    ...overrides,
  };
}

function history(value: AdminOrder, emails: ReadonlyMap<string, string> | null): HistoryRow[] {
  return value.history.map((entry, index) => ({
    key: String(index),
    at: entry.at,
    from: entry.fromStatus,
    to: entry.toStatus,
    actor: historyActor(entry, ME, emails),
    reason: entry.reason,
  }));
}

function detail(t: Translator, value: AdminOrder, permissions: readonly string[] | null): string {
  return renderInRouter(
    <OrderDetailView
      t={t}
      uiLocale="en"
      order={value}
      money={{ locale: "en", config }}
      history={history(value, null)}
      actions={offeredActions(value.status, permissions)}
      onAction={noop}
      busy={false}
      statusLine={<StatusLine />}
    />,
    `/orders/${value.id}`,
  );
}

const summary: AdminOrderSummary = {
  id: "0b5f8a52-7a9e-4c7a-9d0e-1a2b3c4d5e6f",
  number: "7K3M-9QX2",
  status: "paid",
  placedAt: "2026-10-20T10:00:00.000Z",
  expiresAt: "2026-10-20T10:30:00.000Z",
  total: { amount: 3998, currency: "UAH" },
  currency: "UAH",
  customerId: null,
  email: "guest@example.com",
  itemCount: 2,
};

function results(t: Translator, state: OrderListState, search = ""): string {
  return renderInRouter(
    <OrderResultsView
      t={t}
      uiLocale="en"
      query={readOrderListQuery(new URLSearchParams(search))}
      state={state}
      onRetry={noop}
      totalText={() => "UAH 39.98"}
      hrefForOffset={(offset) => `/orders?offset=${String(offset)}`}
    />,
    "/orders",
  );
}

function listView(
  t: Translator,
  search: string,
  rangeError: Parameters<typeof OrderListView>[0]["rangeError"] = null,
) {
  return renderInRouter(
    <OrderListView
      t={t}
      query={readOrderListQuery(new URLSearchParams(search))}
      rangeError={rangeError}
      results={<p>results-slot</p>}
      searchText=""
      onSearchChange={noop}
      onSearchSubmit={noop}
      onStatusChange={noop}
      onFromChange={noop}
      onToChange={noop}
      hrefWithoutCustomer="/orders"
    />,
    `/orders${search}`,
  );
}

describe("order list screen", () => {
  it("renders every state without hardcoded text", () => {
    const states: OrderListState[] = [
      { status: "loading" },
      { status: "ready", data: { items: [summary], total: 41, limit: 20, offset: 20 } },
      { status: "ready", data: { items: [], total: 0, limit: 20, offset: 0 } },
      { status: "forbidden" },
      { status: "notFound" },
      { status: "error", failure: { kind: "network" } },
    ];
    const rowData = [
      summary.number,
      formatDateTime(summary.placedAt, "en"),
      summary.email ?? "",
      "UAH 39.98",
    ];
    for (const state of states) {
      expect(leftoverText(withoutData(results(sentinel, state), rowData)), state.status).toBe("");
    }
    expect(leftoverText(listView(sentinel, `?customerId=${CUSTOMER}&q=x`))).toBe("results slot");
  });

  it("links each row to its detail and shows the guest marker, the item count and the total", () => {
    const html = results(sentinel, {
      status: "ready",
      data: { items: [summary], total: 1, limit: 20, offset: 0 },
    });
    expect(html).toContain(`href="/admin-ui/orders/${summary.id}"`);
    expect(html).toContain("§order.status.paid");
    expect(html).toContain("§order.list.noAccount");
    expect(html).toContain("UAH 39.98");
    expect(html).toContain('<th scope="row"');
  });

  it("tells an empty shop from no match, and offers the detail for an order id search", () => {
    const empty = { status: "ready" as const, data: { items: [], total: 0, limit: 20, offset: 0 } };
    expect(results(sentinel, empty)).toContain("§order.list.emptyTitle");
    expect(results(sentinel, empty, "?q=7K3M-9QX2")).toContain("§order.list.noMatchTitle");
    expect(results(sentinel, empty, "?q=7K3M-9QX2")).not.toContain("§order.list.openById");
    const byId = results(sentinel, empty, `?q=${CUSTOMER}`);
    expect(byId).toContain(`href="/admin-ui/orders/${CUSTOMER}"`);
  });

  it("shows the customer filter as a removable chip and the date range problem instead of the results", () => {
    const html = listView(sentinel, `?customerId=${CUSTOMER}`);
    expect(html).toContain("§order.list.customerChip");
    expect(html).toContain("§order.list.removeCustomer");
    const invalid = listView(sentinel, "?from=2026-10-21&to=2026-10-20", {
      field: "to",
      reason: "end_before_start",
    });
    expect(invalid).toContain("§order.list.dateRange.end_before_start");
    expect(invalid).toContain("§order.list.rangeNotSent");
    expect(invalid).not.toContain("results-slot");
    expect(invalid).toMatch(/<form[^>]*method="post"/);
    expect(invalid).not.toMatch(/<form[^>]*action=/);
  });
});

describe("order detail screen", () => {
  it("renders without hardcoded text, with every section", () => {
    const paid = order({
      status: "paid",
      paidAt: "2026-10-20T10:05:00.000Z",
      paymentReference: "R-1",
      history: [
        ...order().history,
        {
          fromStatus: "awaiting_payment",
          toStatus: "paid",
          actorType: "admin",
          actorAdminId: OTHER,
          reason: null,
          at: "2026-10-20T10:05:00.000Z",
        },
      ],
    });
    const html = detail(sentinel, paid, [...ROLE_PERMISSIONS.manager]);
    const data = [
      paid.number,
      paid.contact.email ?? "",
      paid.contact.phone ?? "",
      paid.contact.lastName ?? "",
      paid.contact.firstName ?? "",
      "<script>alert(1)</script> Street 1",
      "01001 Kyiv",
      "R-1",
      "SKU-1",
      "T-shirt",
      "UAH 19.99",
      "UAH 39.98",
      "UAH 0.00",
      ...[paid.placedAt, paid.paidAt ?? "", "2026-10-20T10:00:00.000Z"].map((at) =>
        formatDateTime(at, "en"),
      ),
    ];
    // The country and language codes are whole elements; removing them as text would cut into longer texts.
    const rest = withoutData(html.replace(/\u00a0/g, " "), data).replace(/>(UA|uk)</g, "><");
    expect(leftoverText(rest)).toBe("");
    expect(html).toContain("§order.detail.paymentReference");
    expect(html).toContain("§order.actor.another");
  });

  it("renders names and addresses as text only, never as markup", () => {
    const html = detail(sentinel, order(), null);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; Street 1");
    expect(html).not.toContain("<b>Olena</b>");
  });

  it("offers the actions the status and the permission allow, and none to a reader", () => {
    const manager = [...ROLE_PERMISSIONS.manager];
    const unpaid = detail(sentinel, order(), manager);
    expect(unpaid).toContain("§order.action.markPaid");
    expect(unpaid).toContain("§order.action.cancel");
    expect(unpaid).not.toContain("§order.action.markFulfilled");
    const paid = detail(sentinel, order({ status: "paid" }), manager);
    expect(paid).toContain("§order.action.markFulfilled");
    expect(paid).not.toContain("§order.action.markPaid");
    for (const permissions of [["orders.read"], [...ROLE_PERMISSIONS.viewer], null]) {
      const html = detail(sentinel, order(), permissions);
      expect(html).not.toContain("§order.detail.actions");
      expect(html).not.toContain("<button");
    }
    expect(detail(sentinel, order({ status: "fulfilled" }), manager)).not.toContain("<button");
  });

  it("links the customer's email to the customer detail (step 9's route) and the customer's orders, by the account id", () => {
    const html = detail(sentinel, order(), null);
    expect(html).toMatch(
      new RegExp(`<a[^>]*href="/admin-ui/customers/${CUSTOMER}"[^>]*>shopper@example.com</a>`),
    );
    expect(html).toContain(`href="/admin-ui/orders?customerId=${CUSTOMER}"`);
    // The link never carries the email, and a guest order or a deleted account has no customer link at all.
    expect(html).not.toContain("customers/shopper");
    const guest = detail(sentinel, order({ customerId: null, isGuest: true }), null);
    expect(guest).toContain("§order.detail.guestOrder");
    expect(guest).not.toContain("customerId=");
    expect(guest).not.toContain('href="/admin-ui/customers');
    const deleted = detail(sentinel, order({ customerId: null, isGuest: false }), null);
    expect(deleted).not.toContain('href="/admin-ui/customers');
  });

  it("shows a line image only for a plain https address, lazily and without a referrer", () => {
    const html = detail(sentinel, order(), null);
    expect(html).toMatch(/<img[^>]*src="https:\/\/example.com\/a.jpg"[^>]*>/);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    const base = order();
    const item = base.items[0];
    if (item === undefined) throw new Error("fixture");
    const unsafe = detail(
      sentinel,
      order({ items: [{ ...item, imageUrl: "javascript:alert(1)" }] }),
      null,
    );
    expect(unsafe).not.toContain("<img");
  });
});

describe("action dialogs", () => {
  it("mark paid: the amount is text (no amount input), a reference and a required confirmation", () => {
    const html = renderInRouter(
      <MarkPaidDialog
        t={sentinel}
        open
        orderNumber="7K3M-9QX2"
        amountText="UAH 39.98"
        currency="UAH"
        values={{ reference: "", received: false }}
        onChange={noop}
        referenceError={null}
        receivedError={{ key: "order.field.confirmation_required" }}
        error={{ key: "order.refusal.amount_mismatch" }}
        retrying
        busy={false}
        onSubmit={noop}
        onClose={noop}
      />,
    );
    expect(leftoverText(html)).toBe("");
    expect(html).not.toMatch(/name="amount"/);
    expect(html.match(/<input/g)?.length).toBe(2);
    expect(tag(html, "input", "reference")).toContain('maxLength="255"');
    expect(tag(html, "input", "reference")).toContain('required=""');
    expect(tag(html, "input", "received")).toContain('type="checkbox"');
    expect(tag(html, "input", "received")).toContain('required=""');
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).not.toMatch(/<form[^>]*action=/);
    expect(html).toContain("§order.refusal.amount_mismatch");
    expect(html).toContain("§order.markPaid.retryHint");
  });

  it("disables everything while the payment is being sent", () => {
    const html = renderInRouter(
      <MarkPaidDialog
        t={sentinel}
        open
        orderNumber="7K3M-9QX2"
        amountText="UAH 39.98"
        currency="UAH"
        values={{ reference: "R-1", received: true }}
        onChange={noop}
        referenceError={null}
        receivedError={null}
        error={null}
        retrying={false}
        busy
        onSubmit={noop}
        onClose={noop}
      />,
    );
    expect(html.match(/<button[^>]*disabled=""/g)?.length).toBe(2);
    expect(html).toContain("§order.dialog.sending");
  });

  it("fulfil: explains a refusal such as awaiting_stock in the dialog", () => {
    const html = renderInRouter(
      <FulfilDialog
        t={sentinel}
        open
        orderNumber="7K3M-9QX2"
        error={{ key: "order.refusal.awaiting_stock" }}
        busy={false}
        onConfirm={noop}
        onClose={noop}
      />,
    );
    expect(leftoverText(html)).toBe("");
    expect(html).toContain("§order.refusal.awaiting_stock");
    expect(html).toContain('role="alertdialog"');
  });

  it("cancel: a required reason, the paid warning only for a paid order, a danger button", () => {
    const render = (consequence: "release" | "release_unsold" | null) =>
      renderInRouter(
        <CancelDialog
          t={sentinel}
          open
          orderNumber="7K3M-9QX2"
          consequence={consequence}
          values={{ reason: "" }}
          onChange={noop}
          reasonError={null}
          error={null}
          busy={false}
          onSubmit={noop}
          onClose={noop}
        />,
      );
    const paid = render("release_unsold");
    expect(leftoverText(paid)).toBe("");
    expect(paid).toContain("§order.cancel.paidBody");
    expect(tag(paid, "textarea", "reason")).toContain('maxLength="500"');
    expect(tag(paid, "textarea", "reason")).toContain('required=""');
    expect(paid).toContain('role="alertdialog"');
    const unpaid = render("release");
    expect(unpaid).not.toContain("§order.cancel.paidBody");
    expect(unpaid).toContain("§order.cancel.unpaidBody");
  });
});

describe("with the real messages", () => {
  it("renders the list, the detail, the dialogs and every notice in uk and en", async () => {
    for (const locale of ["uk", "en"] as const) {
      const t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
      expect(listView(t, `?customerId=${CUSTOMER}`)).toContain(t("order.list.removeCustomer"));
      const html = detail(t, order({ status: "paid" }), [...ROLE_PERMISSIONS.owner]);
      expect(html).toContain(t("order.action.markFulfilled"));
      expect(html).toContain(t("order.detail.title", { number: "7K3M-9QX2" }));
      for (const check of [
        "recorded",
        "not_recorded",
        "paid_with_other_reference",
        "not_payable",
        "unreadable",
      ] as const) {
        expect(
          renderInRouter(
            <OrderNoticeView t={t} notice={{ kind: "unknownPaid", check, reference: "R-1" }} />,
          ),
        ).toContain("R-1");
      }
      for (const action of ["markPaid", "markFulfilled", "cancel"] as const) {
        renderInRouter(<OrderNoticeView t={t} notice={{ kind: "done", action }} />);
      }
      for (const action of ["markFulfilled", "cancel"] as const) {
        renderInRouter(<OrderNoticeView t={t} notice={{ kind: "unknown", action }} />);
      }
    }
  });
});
