import type { Order } from "@fluxkit/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accountOrderHref,
  accountOrdersHref,
  guestOrderHref,
  isOrderNumber,
  tokenFromFragment,
} from "./order-links";
import {
  ACCOUNT_ORDERS_PAGE_SIZE,
  canCancel,
  orderMoney,
  orderStatusKey,
  parseOrdersPage,
  ORDER_STATUSES,
} from "./order-model";
import {
  accountOrderSource,
  createOrderListStore,
  createOrderStore,
  guestOrderSource,
} from "./order-store";
import { formatMoney } from "./money";
import { immediateClient, json, problem, settle, stagedClient } from "./test-fetch";

afterEach(() => vi.restoreAllMocks());

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE";

function anOrder(overrides: Partial<Order> = {}): Order {
  const money = { amount: 1999, currency: "UAH" };
  return {
    number: "7K3M-9QX2",
    status: "awaiting_payment",
    placedAt: "2026-10-19T10:00:00.000Z",
    expiresAt: "2026-10-19T10:30:00.000Z",
    currency: "UAH",
    items: [],
    subtotal: money,
    shippingTotal: { amount: 0, currency: "UAH" },
    discountTotal: { amount: 0, currency: "UAH" },
    taxTotal: { amount: 0, currency: "UAH" },
    total: money,
    adjustments: [],
    contact: {
      email: "guest@example.test",
      phone: "+380441234567",
      firstName: "Ada",
      lastName: "Guest",
    },
    shippingAddress: null,
    billingAddress: null,
    shipping: null,
    shipments: [],
    history: [{ status: "awaiting_payment", at: "2026-10-19T10:00:00.000Z" }],
    ...overrides,
  };
}

describe("order links and the fragment token", () => {
  it("puts the token in the fragment only, never in the path or a query", () => {
    const href = guestOrderHref("uk", "7K3M-9QX2", TOKEN);
    expect(href).toBe(`/uk/order/7K3M-9QX2#t=${TOKEN}`);
    expect(href.indexOf(TOKEN)).toBeGreaterThan(href.indexOf("#"));
    expect(accountOrderHref("en", "7K3M-9QX2")).toBe("/en/account/orders/7K3M-9QX2");
    expect(accountOrdersHref("en")).toBe("/en/account/orders");
    expect(accountOrdersHref("en", 3)).toBe("/en/account/orders?page=3");
  });

  it("reads exactly one well-formed token from the fragment", () => {
    expect(tokenFromFragment(`#t=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromFragment(`t=${TOKEN}`)).toBe(TOKEN);
    for (const bad of [
      "",
      "#",
      "#t=",
      "#x=1",
      `#t=${TOKEN}&t=${TOKEN}`,
      "#t=short",
      "#t=has space",
      "#t=a%2Fb",
    ]) {
      expect(tokenFromFragment(bad), bad).toBeNull();
    }
  });

  it("accepts an order number as typed, nothing that could leave the path", () => {
    expect(isOrderNumber("7k3m9qx2")).toBe(true);
    for (const bad of ["", "../x", "a/b", "a?b", "a#b", "x".repeat(33), "7K3M 9QX2"]) {
      expect(isOrderNumber(bad), bad).toBe(false);
    }
  });
});

describe("order model", () => {
  it("has a status text for every status of the API, and a fallback", () => {
    expect(ORDER_STATUSES).toEqual([
      "awaiting_payment",
      "paid",
      "fulfilled",
      "cancelled",
      "expired",
    ]);
    expect(orderStatusKey("paid")).toBe("order.status.paid");
    expect(orderStatusKey("refunded" as never)).toBe("order.status.unknown");
  });

  it("allows a cancel only while the order awaits payment", () => {
    expect(ORDER_STATUSES.filter((status) => canCancel(anOrder({ status })))).toEqual([
      "awaiting_payment",
    ]);
  });

  it("formats an amount with the shop's digits in the shop currency and Intl's otherwise (never computes)", () => {
    const shop = { currency: "UAH", exponent: 2 };
    expect(orderMoney({ amount: 123456, currency: "UAH" }, shop, "en")).toBe(
      formatMoney({ amount: 123456, currency: "UAH" }, 2, "en"),
    );
    expect(orderMoney({ amount: 123456, currency: "UAH" }, shop, "en")).toMatch(/1,234\.56/);
    expect(orderMoney({ amount: 1500, currency: "JPY" }, shop, "en")).toBe("¥1,500");
  });

  it("parses ?page like the catalog: 1 when absent, null when malformed or beyond the API's offset cap", () => {
    expect(ACCOUNT_ORDERS_PAGE_SIZE).toBe(24);
    expect(parseOrdersPage(null)).toBe(1);
    expect(parseOrdersPage("3")).toBe(3);
    for (const bad of ["0", "-1", "1.5", "abc", "01", "9999"])
      expect(parseOrdersPage(bad), bad).toBeNull();
  });
});

describe("guest order store", () => {
  it("looks the order up with the token in the POST body only, in the page's locale", async () => {
    const { client, calls } = immediateClient(() => json(anOrder()));
    const store = createOrderStore({ source: guestOrderSource(client, "7K3M-9QX2", TOKEN, "en") });
    await store.load();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("/store/orders/lookup?locale=en");
    expect(calls[0]?.body).toEqual({ number: "7K3M-9QX2", accessToken: TOKEN });
    expect(calls[0]?.headers.get("X-Fluxkit-CSRF")).toBe("1");
    expect(calls[0]?.init.cache).toBe("no-store");
    expect(store.getState().load).toEqual({ status: "ready", order: anOrder() });
  });

  it("shows one identical not-found state for 404 and 400, revealing nothing", async () => {
    for (const answer of [problem(404, "not_found"), problem(400, "validation_failed")]) {
      const { client } = immediateClient(() => answer);
      const store = createOrderStore({
        source: guestOrderSource(client, "7K3M-9QX2", TOKEN, "uk"),
      });
      await store.load();
      expect(store.getState().load).toEqual({ status: "notFound" });
    }
  });

  it("shows a retry for a network failure, a 5xx and a 429 (with the wait)", async () => {
    const { client } = immediateClient(() =>
      problem(429, "too_many_requests", {}, { "Retry-After": "30" }),
    );
    const store = createOrderStore({ source: guestOrderSource(client, "7K3M-9QX2", TOKEN, "uk") });
    await store.load();
    expect(store.getState().load).toMatchObject({
      status: "error",
      failure: { messageKey: "errors.too_many_requests", retryAfterSeconds: 30 },
    });
  });

  it("cancels after a confirmation, with the token in the body, and shows the cancelled order", async () => {
    const { client, calls } = stagedClient();
    const store = createOrderStore({ source: guestOrderSource(client, "7K3M-9QX2", TOKEN, "uk") });
    const loading = store.load();
    calls[0]?.answer(json(anOrder()));
    await loading;
    expect(store.getState().cancel.confirming).toBe(false);
    store.askCancel();
    expect(store.getState().cancel.confirming).toBe(true);
    const first = store.cancel();
    const second = store.cancel();
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe("/store/orders/cancel?locale=uk");
    expect(calls[1]?.body).toEqual({ number: "7K3M-9QX2", accessToken: TOKEN });
    expect(store.getState().cancel.pending).toBe(true);
    calls[1]?.answer(json(anOrder({ status: "cancelled" })));
    await Promise.all([first, second]);
    expect(store.getState()).toMatchObject({
      load: { status: "ready", order: { status: "cancelled" } },
      cancel: { pending: false, confirming: false, done: true, failure: null },
    });
  });

  it("does not cancel without the confirmation step or an order that cannot be cancelled", async () => {
    const { client, calls } = immediateClient(() => json(anOrder({ status: "paid" })));
    const store = createOrderStore({ source: guestOrderSource(client, "7K3M-9QX2", TOKEN, "uk") });
    await store.load();
    store.askCancel();
    await store.cancel();
    expect(calls).toHaveLength(1);
  });

  it("reads the order again when the cancel is refused because the status changed meanwhile", async () => {
    let round = 0;
    const { client, calls } = immediateClient(() => {
      round += 1;
      if (round === 1) return json(anOrder());
      if (round === 2) return problem(409, "rule_violation", { rule: "invalid_transition" });
      return json(anOrder({ status: "expired" }));
    });
    const store = createOrderStore({ source: guestOrderSource(client, "7K3M-9QX2", TOKEN, "uk") });
    await store.load();
    store.askCancel();
    await store.cancel();
    expect(calls.map((call) => call.url)).toEqual([
      "/store/orders/lookup?locale=uk",
      "/store/orders/cancel?locale=uk",
      "/store/orders/lookup?locale=uk",
    ]);
    expect(store.getState()).toMatchObject({
      load: { status: "ready", order: { status: "expired" } },
      cancel: { failure: { messageKey: "errors.rule.invalid_transition" }, done: false },
    });
  });

  it("never puts the token in a URL, a console call or anything but the request bodies", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => {}),
    );
    const { client, calls } = immediateClient((call) =>
      call.url.includes("cancel") ? problem(503, "service_unavailable") : json(anOrder()),
    );
    const store = createOrderStore({ source: guestOrderSource(client, "7K3M-9QX2", TOKEN, "uk") });
    await store.load();
    store.askCancel();
    await store.cancel();
    for (const call of calls) expect(call.url).not.toContain(TOKEN);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(store.getState())).not.toContain(TOKEN);
  });
});

describe("account order store", () => {
  it("reads and cancels through the session routes; a 401 ends the session", async () => {
    const signedOut = vi.fn();
    const { client, calls } = immediateClient((call) =>
      call.method === "GET" ? json(anOrder()) : problem(401, "unauthorized"),
    );
    const store = createOrderStore({
      source: accountOrderSource(client, "7K3M-9QX2", "en"),
      onSignedOut: signedOut,
    });
    await store.load();
    expect(calls[0]?.url).toBe("/store/account/orders/7K3M-9QX2?locale=en");
    store.askCancel();
    await store.cancel();
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.url).toBe("/store/account/orders/7K3M-9QX2/cancel?locale=en");
    expect(signedOut).toHaveBeenCalledTimes(1);
    expect(store.getState().load).toEqual({ status: "signedOut" });
  });

  it("shows the same not-found state for an order of someone else (404)", async () => {
    const { client } = immediateClient(() => problem(404, "not_found"));
    const store = createOrderStore({ source: accountOrderSource(client, "7K3M-9QX2", "uk") });
    await store.load();
    expect(store.getState().load).toEqual({ status: "notFound" });
  });
});

describe("account order list store", () => {
  const list = (total: number, items = 1) => ({
    items: Array.from({ length: items }, (_, index) => ({
      number: `AAAA-000${String(index)}`,
      status: "paid",
      placedAt: "2026-10-19T10:00:00.000Z",
      expiresAt: "2026-10-19T10:30:00.000Z",
      total: { amount: 1999, currency: "UAH" },
      itemCount: 2,
    })),
    total,
    limit: ACCOUNT_ORDERS_PAGE_SIZE,
    offset: 0,
  });

  it("asks for the page's offset and limit and keeps the answer", async () => {
    const { client, calls } = immediateClient(() => json(list(30)));
    const store = createOrderListStore({ client, page: 2, locale: "uk" });
    await store.load();
    expect(calls[0]?.url).toBe("/store/account/orders?locale=uk&limit=24&offset=24");
    expect(store.getState()).toMatchObject({ status: "ready", pageCount: 2, list: { total: 30 } });
  });

  it("is empty on page 1 without orders and out of range on a later page without items", async () => {
    const empty = createOrderListStore({
      client: immediateClient(() => json(list(0, 0))).client,
      page: 1,
      locale: "uk",
    });
    await empty.load();
    expect(empty.getState()).toMatchObject({ status: "ready", pageCount: 0 });
    const beyond = createOrderListStore({
      client: immediateClient(() => json(list(5, 0))).client,
      page: 3,
      locale: "uk",
    });
    await beyond.load();
    expect(beyond.getState()).toEqual({ status: "outOfRange" });
  });

  it("ends the session on 401 and offers a retry otherwise", async () => {
    const signedOut = vi.fn();
    const gone = createOrderListStore({
      client: immediateClient(() => problem(401, "unauthorized")).client,
      page: 1,
      locale: "uk",
      onSignedOut: signedOut,
    });
    await gone.load();
    expect(gone.getState()).toEqual({ status: "signedOut" });
    expect(signedOut).toHaveBeenCalledTimes(1);
    const failing = createOrderListStore({
      client: immediateClient(() => problem(500, "internal_error")).client,
      page: 1,
      locale: "uk",
    });
    await failing.load();
    expect(failing.getState()).toMatchObject({
      status: "error",
      failure: { messageKey: "errors.internal_error" },
    });
  });
});
