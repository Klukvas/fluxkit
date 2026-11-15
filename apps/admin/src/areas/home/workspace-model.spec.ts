import { describe, expect, it, vi } from "vitest";
import {
  COUNTERS,
  QUICK_ACTIONS,
  formatTotal,
  readCounter,
  selectWorkspace,
} from "./workspace-model";

describe("workspace model", () => {
  it("keeps presentation variants out of quick-action definitions", () => {
    for (const action of QUICK_ACTIONS) expect(action).not.toHaveProperty("variant");
  });

  it("selects only operations allowed by permissions, including missing and empty lists", () => {
    for (const permissions of [null, []])
      expect(selectWorkspace(permissions)).toEqual({ counters: [], actions: [] });
    expect(selectWorkspace(["catalog.read"]).counters.map(({ id }) => id)).toEqual([
      "draftProducts",
      "activeProducts",
    ]);
    expect(selectWorkspace(["catalog.read"]).actions).toEqual([]);
    expect(selectWorkspace(["orders.read"]).counters.map(({ id }) => id)).toEqual([
      "awaitingPayment",
      "paid",
      "paymentsAttention",
    ]);
    expect(selectWorkspace(["orders.read"]).actions.map(({ id }) => id)).toEqual(["processOrders"]);
    expect(selectWorkspace(["customers.read"]).counters.map(({ id }) => id)).toEqual(["customers"]);
    expect(selectWorkspace(["customers.read"]).actions.map(({ id }) => id)).toEqual(["customers"]);
    expect(selectWorkspace(["catalog.write"]).actions.map(({ id }) => id)).toEqual(["newProduct"]);
    expect(
      selectWorkspace(["catalog.read", "catalog.write", "orders.read", "customers.read"]),
    ).toEqual({ counters: [...COUNTERS], actions: [...QUICK_ACTIONS] });
  });

  it("reads bounded status queries with the caller's signal and uses response totals", async () => {
    const result = {
      ok: true as const,
      status: 200,
      data: { items: [], total: 1234, limit: 1, offset: 0 },
    };
    const paymentResult = {
      ...result,
      data: { items: [], total: 1234, limit: 1, nextCursor: null },
    };
    const client = {
      listOrders: vi.fn(async () => result),
      listPayments: vi.fn(async () => paymentResult),
      listCustomers: vi.fn(async () => result),
      listProducts: vi.fn(async () => result),
    };
    const signal = new AbortController().signal;
    for (const counter of COUNTERS) {
      await expect(readCounter(client, counter, signal)).resolves.toEqual(
        counter.operation === "listPayments" ? paymentResult : result,
      );
    }
    expect(client.listOrders.mock.calls).toEqual([
      [{ status: "awaiting_payment", limit: 1, offset: 0, signal }],
      [{ status: "paid", limit: 1, offset: 0, signal }],
    ]);
    expect(client.listPayments.mock.calls).toEqual([[{ needsAttention: true, limit: 1, signal }]]);
    expect(COUNTERS.map(({ id }) => id)).toEqual([
      "awaitingPayment",
      "paid",
      "paymentsAttention",
      "customers",
      "draftProducts",
      "activeProducts",
    ]);
    expect(client.listCustomers.mock.calls).toEqual([[{ limit: 1, offset: 0, signal }]]);
    expect(client.listProducts.mock.calls).toEqual([
      [{ status: "draft", limit: 1, offset: 0, signal }],
      [{ status: "active", limit: 1, offset: 0, signal }],
    ]);
    expect(COUNTERS.map(({ target }) => target)).toEqual([
      "/orders?status=awaiting_payment",
      "/orders?status=paid",
      "/payments",
      "/customers",
      "/products?status=draft",
      "/products?status=active",
    ]);
    expect(QUICK_ACTIONS.map(({ target }) => target)).toEqual([
      "/products/new",
      "/orders?status=paid",
      "/customers",
    ]);
  });

  it("formats zero and thousands in both UI locales without compact rounding", () => {
    expect(formatTotal(0, "uk")).toBe("0");
    expect(formatTotal(0, "en")).toBe("0");
    expect(formatTotal(12345, "uk")).toBe("12\u00a0345");
    expect(formatTotal(12345, "en")).toBe("12,345");
  });
});
