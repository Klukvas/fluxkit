import type { AdminConfig, AdminOrder, AdminOrderHistoryEntry } from "@fluxkit/api-client";
import { ORDER_STATUSES, ROLE_PERMISSIONS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { PATHS } from "../../router/paths";
import {
  ORDER_STATUS_TONES,
  customerDetailHref,
  customerOrdersHref,
  exponentOf,
  historyActor,
  moneyText,
  orderLineRows,
  orderStatusLabelKey,
  orderTotalRows,
  snapshotText,
  wantsAdminEmails,
  type MoneyContext,
} from "./order-view";

const config: AdminConfig = {
  defaultLocale: "uk",
  locales: ["uk", "en"],
  shopCurrency: "UAH",
  currencyExponent: 2,
  supportedCurrencies: [
    { code: "UAH", exponent: 2 },
    { code: "JPY", exponent: 0 },
    { code: "KWD", exponent: 3 },
  ],
  pricesIncludeTax: true,
  lowStockThreshold: 5,
  emailDelivery: false,
  onlinePayment: false,
  media: {
    uploadsEnabled: true,
    maxBytes: 10485760,
    contentTypes: ["image/jpeg", "image/png", "image/webp"],
  },
};

const ctx: MoneyContext = { locale: "en", config };

/** Intl separates the currency with a no-break space; the expectations are written with plain spaces. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replace(/\u00a0|\u202f/g, " ")) as T;
}

function money(amount: number, currency = "UAH") {
  return { amount, currency };
}

function order(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: "0b5f8a52-7a9e-4c7a-9d0e-1a2b3c4d5e6f",
    number: "7K3M-9QX2",
    status: "awaiting_payment",
    locale: "uk",
    currency: "UAH",
    customerId: null,
    isGuest: true,
    contact: { email: "a@example.com", phone: "+380501234567", firstName: "A", lastName: "B" },
    shippingAddress: null,
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
        variantTitle: { uk: "Варіант" },
        optionValues: [{ option: { uk: "Опція", en: "Option" }, value: { uk: "Значення" } }],
        imageUrl: "https://example.com/a.jpg",
        unitPrice: money(1999),
        compareAtAmount: 2999,
        quantity: 3,
        // Deliberately not 3 x 1999: the screen shows the API's figure, it never multiplies.
        lineTotal: money(6000),
        requiresShipping: true,
        reservations: [
          { status: "committed", quantity: 2 },
          { status: "active", quantity: 1 },
        ],
      },
    ],
    subtotal: money(6000),
    shippingTotal: money(0),
    discountTotal: money(-500),
    taxTotal: money(0),
    total: money(5500),
    adjustments: [],
    history: [],
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

describe("order status as text plus tone", () => {
  it("has a tone and a message key for every status the API has", () => {
    expect(Object.keys(ORDER_STATUS_TONES).sort()).toEqual([...ORDER_STATUSES].sort());
    for (const status of ORDER_STATUSES) {
      expect(orderStatusLabelKey(status)).toBe(`order.status.${status}`);
    }
    expect(ORDER_STATUS_TONES.awaiting_payment).toBe("warning");
    expect(ORDER_STATUS_TONES.paid).toBe("success");
  });
});

describe("snapshot texts in the UI language with fallback", () => {
  it("prefers the UI language, then the order's language, then any text in a fixed order", () => {
    const texts = { uk: "Футболка", en: "T-shirt", de: "Hemd" };
    expect(snapshotText(texts, "en", "uk")).toBe("T-shirt");
    expect(snapshotText(texts, "uk", "en")).toBe("Футболка");
    expect(snapshotText({ uk: "Футболка", de: "Hemd" }, "en", "uk")).toBe("Футболка");
    expect(snapshotText({ de: "Hemd", fr: "Chemise" }, "en", "uk")).toBe("Hemd");
    expect(snapshotText({ en: "", uk: "Футболка" }, "en", "pl")).toBe("Футболка");
    expect(snapshotText({}, "en", "uk")).toBe("");
  });
});

describe("money from integer minor units", () => {
  it("uses the currency's exponent from the admin config", () => {
    expect(exponentOf(config, "UAH")).toBe(2);
    expect(exponentOf(config, "JPY")).toBe(0);
    expect(exponentOf(config, "KWD")).toBe(3);
    expect(plain(moneyText(money(123456), ctx))).toBe("UAH 1,234.56");
    expect(plain(moneyText(money(1234, "JPY"), ctx))).toBe("¥1,234");
    expect(plain(moneyText(money(1234, "KWD"), ctx))).toBe("KWD 1.234");
  });

  it("formats the largest amount exactly (no float on the way)", () => {
    expect(plain(moneyText(money(999_999_999_999), ctx))).toBe("UAH 9,999,999,999.99");
    expect(plain(moneyText(money(1_000_000_000_000), ctx))).toBe("UAH 10,000,000,000.00");
    expect(plain(moneyText(money(-500), ctx))).toBe("-UAH 5.00");
  });

  it("falls back to the ISO exponent for a currency the config no longer lists", () => {
    expect(exponentOf(config, "EUR")).toBe(2);
    expect(plain(moneyText(money(1050, "EUR"), ctx))).toBe("€10.50");
  });
});

describe("lines and totals", () => {
  it("shows each line's snapshot and the API's money as it is", () => {
    const [row] = plain(orderLineRows(order(), { ...ctx, orderLocale: "uk" }));
    expect(row).toEqual({
      key: "0",
      title: "T-shirt",
      variantTitle: "Варіант",
      options: [{ option: "Option", value: "Значення" }],
      sku: "SKU-1",
      imageUrl: "https://example.com/a.jpg",
      unitPrice: "UAH 19.99",
      compareAt: "UAH 29.99",
      quantity: 3,
      lineTotal: "UAH 60.00",
      requiresShipping: true,
      reservations: [
        { status: "committed", quantity: 2 },
        { status: "active", quantity: 1 },
      ],
    });
  });

  it("drops an image address that is not plain http(s)", () => {
    const base = order();
    const item = base.items[0];
    if (item === undefined) throw new Error("fixture");
    const rows = orderLineRows(
      order({ items: [{ ...item, imageUrl: "javascript:alert(1)", compareAtAmount: null }] }),
      { ...ctx, orderLocale: "uk" },
    );
    expect(rows[0]?.imageUrl).toBeNull();
    expect(rows[0]?.compareAt).toBeNull();
  });

  it("lists every total the API gives, in order, signed as the API signs it", () => {
    expect(plain(orderTotalRows(order(), ctx))).toEqual([
      { id: "subtotal", text: "UAH 60.00" },
      { id: "shipping", text: "UAH 0.00" },
      { id: "discount", text: "-UAH 5.00" },
      { id: "tax", text: "UAH 0.00" },
      { id: "total", text: "UAH 55.00" },
    ]);
  });
});

describe("who changed the status (owner answer 11)", () => {
  const me = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  function entry(overrides: Partial<AdminOrderHistoryEntry>): AdminOrderHistoryEntry {
    return {
      fromStatus: "awaiting_payment",
      toStatus: "paid",
      actorType: "admin",
      actorAdminId: other,
      reason: null,
      at: "2026-10-20T10:00:00.000Z",
      ...overrides,
    };
  }

  it("says you, the email (owners only, when known), or another admin with a short id", () => {
    expect(historyActor(entry({ actorAdminId: me }), me, null)).toEqual({ kind: "you" });
    expect(historyActor(entry({}), me, new Map([[other, "m@example.com"]]))).toEqual({
      kind: "email",
      email: "m@example.com",
    });
    expect(historyActor(entry({}), me, null)).toEqual({ kind: "other", shortId: "22222222" });
    expect(historyActor(entry({}), me, new Map())).toEqual({ kind: "other", shortId: "22222222" });
  });

  it("names the customer, the guest, the system and an admin whose account is gone", () => {
    expect(historyActor(entry({ actorType: "customer", actorAdminId: null }), me, null)).toEqual({
      kind: "customer",
    });
    expect(historyActor(entry({ actorType: "guest", actorAdminId: null }), me, null)).toEqual({
      kind: "guest",
    });
    expect(historyActor(entry({ actorType: "system", actorAdminId: null }), me, null)).toEqual({
      kind: "system",
    });
    expect(historyActor(entry({ actorAdminId: null }), me, null)).toEqual({ kind: "removedAdmin" });
  });

  it("reads the admin emails only with users.manage: no extra request for managers", () => {
    expect(wantsAdminEmails([...ROLE_PERMISSIONS.owner])).toBe(true);
    expect(wantsAdminEmails([...ROLE_PERMISSIONS.manager])).toBe(false);
    expect(wantsAdminEmails(["orders.read", "orders.write"])).toBe(false);
    expect(wantsAdminEmails(null)).toBe(false);
  });
});

describe("customer links", () => {
  it("links the customer's detail by the account id (the route exists since step 9)", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    expect(PATHS.customerDetail).toBe("/customers/:id");
    expect(customerDetailHref(id)).toBe(`/customers/${id}`);
    expect(customerDetailHref("a/b")).toBe("/customers/a%2Fb");
  });

  it("lists the customer's orders through the customerId filter", () => {
    expect(customerOrdersHref("33333333-3333-4333-8333-333333333333")).toBe(
      "/orders?customerId=33333333-3333-4333-8333-333333333333",
    );
  });
});
