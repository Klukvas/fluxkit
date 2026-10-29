import type { Order, OrderStatus } from "@fluxkit/api-client";
import { Button, createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { formatDateTime } from "../lib/date";
import { clientFailure } from "../lib/failure";
import { formatMoney } from "../lib/money";
import { ORDER_STATUSES } from "../lib/order-model";
import { initialOrderState, type CancelState } from "../lib/order-store";
import en from "../messages/en.json";
import uk from "../messages/uk.json";
import { AccountOrdersView } from "./account-orders";
import { GuestOrderPage, OrderStatusView, SaveLinkView, copyLink } from "./guest-order-page";
import { OrderDetailsView, addressLines } from "./order-details";
import { SiteShell } from "./site-shell";
import {
  findElements,
  leftoverText,
  sentinelTranslator,
  textAttributes,
  textOf,
} from "./test-helpers";

const t = sentinelTranslator();
const shop = { currency: "UAH", exponent: 2 };
const idle: CancelState = initialOrderState.cancel;

function anOrder(overrides: Partial<Order> = {}): Order {
  const money = (amount: number) => ({ amount, currency: "UAH" });
  return {
    number: "7K3M-9QX2",
    status: "awaiting_payment",
    placedAt: "2026-10-19T10:00:00.000Z",
    expiresAt: "2026-10-19T10:30:00.000Z",
    currency: "UAH",
    items: [
      {
        sku: "§sku-1",
        productTitle: "§product-1",
        variantTitle: "§variant-1",
        optionValues: [{ option: "§option", value: "§value" }],
        imageUrl: null,
        unitPrice: money(1000),
        compareAtAmount: null,
        quantity: 2,
        lineTotal: money(2000),
      },
    ],
    // The API's totals; a view that summed the lines would show 2000.
    subtotal: money(5555),
    shippingTotal: money(0),
    discountTotal: money(0),
    taxTotal: money(0),
    total: money(5555),
    adjustments: [],
    contact: { email: "§email", phone: "§phone", firstName: "§first", lastName: "§last" },
    shippingAddress: { countryCode: "UA", city: "§city", line1: "§line1", postalCode: "§zip" },
    billingAddress: null,
    shipping: null,
    shipments: [],
    history: [{ status: "awaiting_payment", at: "2026-10-19T10:00:00.000Z" }],
    payment: { canPay: false, providers: [], latest: null },
    ...overrides,
  };
}

function details(order: Order, cancel: CancelState = idle, handlers = {}) {
  return OrderDetailsView({
    order,
    t,
    locale: "uk",
    shop,
    cancel,
    onAskCancel: vi.fn(),
    onKeepOrder: vi.fn(),
    onConfirmCancel: vi.fn(),
    ...handlers,
  });
}

function withoutData(html: string): string {
  let rest = html;
  for (const amount of [1000, 2000, 5555])
    rest = rest.split(formatMoney({ amount, currency: "UAH" }, 2, "uk")).join(" ");
  for (const at of ["2026-10-19T10:00:00.000Z", "2026-10-19T10:30:00.000Z"])
    rest = rest.split(formatDateTime(at, "uk")).join(" ");
  return rest.split("Україна").join(" ");
}

describe("OrderDetailsView", () => {
  it("shows a translated status (text in a badge) for every status", () => {
    for (const status of ORDER_STATUSES) {
      const html = renderToStaticMarkup(details(anOrder({ status })));
      expect(html).toContain(`§order.status.${status}`);
      for (const locale of [uk, en] as Record<string, string>[]) {
        expect(locale[`order.status.${status}`], status).toBeTruthy();
      }
    }
  });

  it("states the neutral payment wording with the formatted expiry only while the order awaits payment", () => {
    const html = renderToStaticMarkup(details(anOrder()));
    expect(html).toContain("§order.payment.awaiting");
    const real = createTranslator(en, "en");
    const text = renderToStaticMarkup(
      OrderDetailsView({
        order: anOrder(),
        t: real,
        locale: "en",
        shop,
        cancel: idle,
        onAskCancel: vi.fn(),
        onKeepOrder: vi.fn(),
        onConfirmCancel: vi.fn(),
      }),
    );
    expect(text).toContain(formatDateTime("2026-10-19T10:30:00.000Z", "en"));
    expect(text).toContain("contact you to arrange payment");
    for (const status of ["paid", "fulfilled", "cancelled", "expired"] as OrderStatus[]) {
      expect(renderToStaticMarkup(details(anOrder({ status })))).not.toContain(
        "§order.payment.awaiting",
      );
    }
  });

  it("shows the API's totals, never a sum of the lines, and hides zero shipping, discount and tax", () => {
    const html = renderToStaticMarkup(details(anOrder()));
    expect(html).toContain(formatMoney({ amount: 5555, currency: "UAH" }, 2, "uk"));
    expect(html).toContain(formatMoney({ amount: 2000, currency: "UAH" }, 2, "uk"));
    expect(html).not.toContain("§order.totals.shipping");
    const shipped = renderToStaticMarkup(
      details(anOrder({ shippingTotal: { amount: 300, currency: "UAH" } })),
    );
    expect(shipped).toContain("§order.totals.shipping");
  });

  it("offers cancel only while awaiting payment, asks for confirmation, and shows busy, failure and done states", () => {
    const onAskCancel = vi.fn();
    const onConfirmCancel = vi.fn();
    const onKeepOrder = vi.fn();
    const element = details(anOrder(), idle, { onAskCancel });
    const [ask] = findElements(element, (node) => node.type === Button);
    expect(textOf(ask?.props.children as never)).toBe("§order.cancel");
    (ask?.props.onClick as () => void)();
    expect(onAskCancel).toHaveBeenCalledTimes(1);
    expect(renderToStaticMarkup(details(anOrder({ status: "paid" })))).not.toContain(
      "§order.cancel",
    );

    const confirming = details(
      anOrder(),
      { ...idle, confirming: true },
      { onConfirmCancel, onKeepOrder },
    );
    const buttons = findElements(confirming, (node) => node.type === Button);
    expect(buttons.map((button) => textOf(button.props.children as never))).toEqual([
      "§order.cancel.yes",
      "§order.cancel.no",
    ]);
    (buttons[0]?.props.onClick as () => void)();
    (buttons[1]?.props.onClick as () => void)();
    expect(onConfirmCancel).toHaveBeenCalledTimes(1);
    expect(onKeepOrder).toHaveBeenCalledTimes(1);

    const pending = renderToStaticMarkup(
      details(anOrder(), { ...idle, confirming: true, pending: true }),
    );
    expect(pending).toContain("§order.cancel.pending");
    expect(pending).toContain('aria-busy="true"');
    const failed = renderToStaticMarkup(
      details(anOrder({ status: "expired" }), {
        ...idle,
        failure: clientFailure("errors.rule.invalid_transition"),
      }),
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("§errors.rule.invalid_transition");
    const done = renderToStaticMarkup(
      details(anOrder({ status: "cancelled" }), { ...idle, done: true }),
    );
    expect(done).toMatch(/role="status" aria-live="polite"[^>]*>§order\.cancel\.done/);
  });

  it("lists the address with the country named by Intl, and the history", () => {
    expect(
      addressLines(
        { countryCode: "UA", city: "Kyiv", line1: "Street 1", postalCode: "01001" },
        "en",
      ),
    ).toEqual(["Street 1", "01001 Kyiv", "Ukraine"]);
    const html = renderToStaticMarkup(details(anOrder()));
    expect(html).toContain("<address");
    expect(html).toContain("§order.history.entry");
  });

  it("renders API text as text, has no hardcoded text and one h1", () => {
    const hostile = anOrder({
      items: anOrder().items.map((item) => ({
        ...item,
        productTitle: "<img src=x onerror=alert(1)>",
      })),
    });
    expect(renderToStaticMarkup(details(hostile))).not.toContain("<img");
    for (const status of ORDER_STATUSES) {
      const html = renderToStaticMarkup(
        details(anOrder({ status }), { ...idle, confirming: true }),
      );
      expect(leftoverText(withoutData(html))).toBe("");
      for (const attribute of textAttributes(html)) expect(leftoverText(attribute)).toBe("");
      expect(html.match(/<h1/g)).toHaveLength(1);
    }
  });
});

describe("order page states", () => {
  it("shows ONE not-found state, with no hint of why", () => {
    const html = renderToStaticMarkup(
      <OrderStatusView state={{ status: "notFound" }} t={t} locale="uk" onRetry={vi.fn()} />,
    );
    expect(html).toContain("§order.notFound.title");
    expect(html).toContain("§order.notFound.description");
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(leftoverText(html)).toBe("");
  });

  it("shows an error with a retry and a loading state", () => {
    const onRetry = vi.fn();
    const element = OrderStatusView({
      state: { status: "error", failure: clientFailure("errors.network") },
      t,
      locale: "uk",
      onRetry,
    });
    const [retry] = findElements(element, (node) => node.type === Button);
    (retry?.props.onClick as () => void)();
    expect(onRetry).toHaveBeenCalledTimes(1);
    const loading = renderToStaticMarkup(
      <OrderStatusView state={{ status: "loading" }} t={t} locale="uk" onRetry={vi.fn()} />,
    );
    expect(loading).toContain('aria-busy="true"');
  });
});

describe("save this link", () => {
  const link = "https://shop.example/uk/order/7K3M-9QX2#t=AbCdEfGhIjKlMnOpQrSt";

  it("shows the link in a labelled read-only field with a copy button and a polite status", () => {
    const html = renderToStaticMarkup(
      <SaveLinkView link={link} t={t} copy="idle" onCopy={vi.fn()} />,
    );
    expect(html).toMatch(/<input[^>]*id="order-link"[^>]*readOnly/);
    expect(html).toContain('for="order-link"');
    expect(html).toContain("§order.saveLink.copy");
    expect(html).toContain('role="status"');
    // The link is a value, never a title or a label.
    for (const attribute of textAttributes(html)) expect(attribute).not.toContain("#t=");
    expect(
      renderToStaticMarkup(<SaveLinkView link={link} t={t} copy="copied" onCopy={vi.fn()} />),
    ).toContain("§order.saveLink.copied");
    expect(
      renderToStaticMarkup(<SaveLinkView link={link} t={t} copy="failed" onCopy={vi.fn()} />),
    ).toContain("§order.saveLink.copyFailed");
  });

  it("copies with the Clipboard API and falls back visibly when it is missing or refused", async () => {
    const writeText = vi.fn(async () => {});
    expect(await copyLink(link, { writeText })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(link);
    expect(await copyLink(link, undefined)).toBe("failed");
    expect(
      await copyLink(link, { writeText: async () => Promise.reject(new Error("denied")) }),
    ).toBe("failed");
  });
});

describe("the guest order page on the server", () => {
  it("renders the loading shell only: the token is unknown to the server and never in its HTML", () => {
    const messages = Object.fromEntries(Object.keys(uk).map((key) => [key, `§${key}`]));
    const html = renderToStaticMarkup(
      <SiteShell locale="uk" messages={messages} t={t} categories={[]} year={2026}>
        <GuestOrderPage number="7K3M-9QX2" shop={shop} />
      </SiteShell>,
    );
    expect(html).toContain("§order.title");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("#t=");
    expect(html).not.toContain("order-link");
    // The locale switcher has no fragment on the server either.
    expect(html).toContain('href="/en"');
  });
});

describe("AccountOrdersView", () => {
  const summary = {
    number: "AAAA-0001",
    status: "paid" as const,
    placedAt: "2026-10-19T10:00:00.000Z",
    expiresAt: "2026-10-19T10:30:00.000Z",
    total: { amount: 1999, currency: "UAH" },
    itemCount: 3,
  };

  it("lists orders with a link, status, date, item count and the API's total, and pages through links", () => {
    const html = renderToStaticMarkup(
      <AccountOrdersView
        state={{
          status: "ready",
          list: { items: [summary], total: 60, limit: 24, offset: 24 },
          pageCount: 3,
        }}
        page={2}
        t={t}
        locale="uk"
        shop={shop}
        onRetry={vi.fn()}
      />,
    );
    expect(html).toContain('href="/uk/account/orders/AAAA-0001"');
    expect(html).toContain("§order.status.paid");
    expect(html).toContain("§account.orders.items:3");
    expect(html).toContain("§account.orders.total");
    expect(html).toContain('href="/uk/account/orders?page=3"');
    expect(html).toContain('href="/uk/account/orders"');
    expect(html).toContain('aria-current="page"');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("has empty, out-of-range, loading and error states", () => {
    const render = (state: Parameters<typeof AccountOrdersView>[0]["state"]) =>
      renderToStaticMarkup(
        <AccountOrdersView
          state={state}
          page={1}
          t={t}
          locale="uk"
          shop={shop}
          onRetry={vi.fn()}
        />,
      );
    expect(
      render({
        status: "ready",
        list: { items: [], total: 0, limit: 24, offset: 0 },
        pageCount: 0,
      }),
    ).toContain("§account.orders.empty.title");
    expect(render({ status: "outOfRange" })).toContain("§account.orders.firstPage");
    expect(render({ status: "loading" })).toContain('aria-busy="true"');
    const error = render({ status: "error", failure: clientFailure("errors.network") });
    expect(error).toContain("§account.orders.error");
    expect(leftoverText(error)).toBe("");
  });
});

// ------------------------------------------------------------------ shipping (plan step 10)

describe("OrderDetailsView: delivery and tracking", () => {
  const money = (amount: number) => ({ amount, currency: "UAH" });
  const courier = {
    methodCode: "courier",
    kind: "address" as const,
    providerCode: null,
    amount: money(5000),
    payer: "shop_charge" as const,
    estimatedCarrierAmount: null,
    destination: null,
    title: "§courier-title",
  };
  const point = {
    providerRef: "p1",
    number: "12",
    kind: "locker" as const,
    cityRef: "c1",
    cityName: "§city-name",
    description: "§point-description",
  };

  it("shows nothing about delivery for an order placed without a method (as before shipping existed)", () => {
    const html = renderToStaticMarkup(details(anOrder()));
    expect(html).not.toContain("§order.shipping.title");
    expect(html).not.toContain("§order.shipments.title");
  });

  it("shows the method title, the price the shop charged and the delivery row of the totals", () => {
    const html = renderToStaticMarkup(
      details(anOrder({ shipping: courier, shippingTotal: money(5000) })),
    );
    expect(html).toContain("§courier-title");
    expect(html).toContain("§order.shipping.price");
    expect(html).toContain(formatMoney(money(5000), 2, "uk"));
    expect(html).toContain("§order.totals.shipping");
    expect(html).toContain("<address");
  });

  it("says Free for a free method and keeps its row in the totals, and says who pays on delivery", () => {
    const free = renderToStaticMarkup(
      details(anOrder({ shipping: { ...courier, amount: money(0) } })),
    );
    expect(free).toContain("§order.shipping.free");
    expect(free).toContain("§order.totals.shipping");
    const onDelivery = renderToStaticMarkup(
      details(
        anOrder({
          shipping: {
            ...courier,
            amount: money(0),
            payer: "recipient_on_delivery",
            estimatedCarrierAmount: money(8800),
          },
        }),
      ),
    );
    expect(onDelivery).toContain("§order.shipping.onDeliveryEstimate");
    expect(onDelivery).not.toContain("§order.shipping.free");
  });

  it("shows the pickup point with its kind, number, city and the carrier's text as sent, once (no duplicate address)", () => {
    const html = renderToStaticMarkup(
      details(
        anOrder({
          shipping: { ...courier, kind: "pickup_point", providerCode: "fake", destination: point },
          shippingAddress: { countryCode: "UA", city: "§city-name", line1: "§point-description" },
        }),
      ),
    );
    expect(html).toContain("§order.shipping.point");
    expect(html).toContain("§order.shipping.pointValue");
    expect(html).not.toContain("<address");
    expect(html).not.toContain("§order.address.title");
    const real = renderToStaticMarkup(
      OrderDetailsView({
        order: anOrder({
          shipping: { ...courier, kind: "pickup_point", providerCode: "fake", destination: point },
        }),
        t: createTranslator(en, "en"),
        locale: "en",
        shop,
        cancel: idle,
        onAskCancel: vi.fn(),
        onKeepOrder: vi.fn(),
        onConfirmCancel: vi.fn(),
      }),
    );
    expect(real).toContain("Parcel locker 12, §city-name: §point-description");
  });

  it("lists the tracking number and a translated status for every status of a shipment", () => {
    const statuses = [
      "pending",
      "unknown",
      "created",
      "in_transit",
      "arrived",
      "delivered",
      "returning",
      "returned",
      "cancelled",
      "failed",
    ] as const;
    for (const status of statuses) {
      const html = renderToStaticMarkup(
        details(
          anOrder({
            shipping: courier,
            shipments: [
              {
                providerCode: "fake",
                trackingNumber: "FAKE000001",
                status,
                createdAt: "2026-10-19T11:00:00.000Z",
                updatedAt: "2026-10-19T12:00:00.000Z",
                deliveredAt: null,
                cancelledAt: null,
              },
            ],
          }),
        ),
      );
      expect(html, status).toContain("FAKE000001");
      expect(html, status).toContain(`§order.shipment.status.${status}`);
      for (const messages of [uk, en] as Record<string, string>[]) {
        expect(messages[`order.shipment.status.${status}`], status).toBeTruthy();
      }
    }
  });

  it("shows no tracking section until the shop created a waybill, and survives a status it does not know", () => {
    expect(renderToStaticMarkup(details(anOrder({ shipping: courier })))).not.toContain(
      "§order.shipments.title",
    );
    const html = renderToStaticMarkup(
      details(
        anOrder({
          shipping: courier,
          shipments: [
            {
              providerCode: "fake",
              trackingNumber: "FAKE000002",
              status: "teleported" as never,
              createdAt: "2026-10-19T11:00:00.000Z",
              updatedAt: "2026-10-19T12:00:00.000Z",
              deliveredAt: null,
              cancelledAt: null,
            },
          ],
        }),
      ),
    );
    expect(html).toContain("§order.shipment.status.fallback");
  });

  it("renders carrier text as text, never as markup", () => {
    const html = renderToStaticMarkup(
      OrderDetailsView({
        order: anOrder({
          shipping: {
            ...courier,
            title: "<b>x</b>",
            kind: "pickup_point",
            providerCode: "fake",
            destination: { ...point, description: "<script>alert(1)</script>" },
          },
        }),
        t: createTranslator(en, "en"),
        locale: "en",
        shop,
        cancel: idle,
        onAskCancel: vi.fn(),
        onKeepOrder: vi.fn(),
        onConfirmCancel: vi.fn(),
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("has no hardcoded words around the delivery data", () => {
    const html = renderToStaticMarkup(
      details(
        anOrder({
          shipping: {
            ...courier,
            kind: "pickup_point",
            providerCode: "fake",
            destination: point,
          },
          shipments: [
            {
              providerCode: "fake",
              trackingNumber: "000003",
              status: "in_transit",
              createdAt: "2026-10-19T11:00:00.000Z",
              updatedAt: "2026-10-19T12:00:00.000Z",
              deliveredAt: null,
              cancelledAt: null,
            },
          ],
        }),
      ),
    );
    const rest = withoutData(html)
      .split(formatMoney(money(5000), 2, "uk"))
      .join(" ");
    expect(leftoverText(rest)).toBe("");
    for (const attribute of textAttributes(html)) expect(leftoverText(attribute)).toBe("");
  });
});
