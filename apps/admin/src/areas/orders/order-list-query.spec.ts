import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ORDER_STATUSES } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  ORDER_LIST_LIMIT,
  ORDER_SEARCH_MAX_LENGTH,
  ORDER_STATUS_FILTERS,
  checkOrderSearch,
  listRequest,
  looksLikeOrderId,
  readOrderListQuery,
  withFilter,
  writeOrderListQuery,
  type OrderListQuery,
} from "./order-list-query";

const openapi = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../../../docs/api/openapi.json"), "utf8"),
) as {
  paths: Record<
    string,
    { get: { parameters: { name: string; schema: Record<string, unknown> }[] } }
  >;
};
const listParameters = Object.fromEntries(
  openapi.paths["/admin/orders"]?.get.parameters.map((parameter) => [
    parameter.name,
    parameter.schema,
  ]) ?? [],
);

const CUSTOMER = "8f14e45f-ceea-467a-9575-0123456789ab";

function read(search: string): OrderListQuery {
  return readOrderListQuery(new URLSearchParams(search));
}

describe("order list query (URL state)", () => {
  it("matches the API: page size 20, search up to 254 characters, the five statuses", () => {
    expect(ORDER_LIST_LIMIT).toBe(listParameters.limit?.default);
    expect(ORDER_SEARCH_MAX_LENGTH).toBe(listParameters.q?.maxLength);
    expect([...ORDER_STATUS_FILTERS]).toEqual(listParameters.status?.enum);
    expect([...ORDER_STATUS_FILTERS]).toEqual([...ORDER_STATUSES]);
  });

  it("reads an empty URL as the unfiltered first page and writes it back as nothing", () => {
    const query = read("");
    expect(query).toEqual({ from: "", to: "", q: "", limit: 20, offset: 0 });
    expect(writeOrderListQuery(query)).toBe("");
  });

  it("round-trips every filter in a fixed order", () => {
    const search = `?status=paid&from=2026-10-01&to=2026-10-20&q=7K3M-9QX2&customerId=${CUSTOMER}&limit=50&offset=100`;
    const query = read(search);
    expect(query).toEqual({
      status: "paid",
      from: "2026-10-01",
      to: "2026-10-20",
      q: "7K3M-9QX2",
      customerId: CUSTOMER,
      limit: 50,
      offset: 100,
    });
    expect(writeOrderListQuery(query)).toBe(search);
  });

  it("reads the reservation link of the Stock tab (`?q=<order number>`) as the search", () => {
    expect(read("?q=7K3M-9QX2").q).toBe("7K3M-9QX2");
    expect(read(`?q=${encodeURIComponent(" shopper@example.com ")}`).q).toBe("shopper@example.com");
  });

  it("drops a value it cannot use instead of failing (a hand-edited URL)", () => {
    expect(read("?status=shipped").status).toBeUndefined();
    expect(read("?from=2026-02-30&to=tomorrow")).toMatchObject({ from: "", to: "" });
    expect(read("?customerId=not-a-uuid").customerId).toBeUndefined();
    expect(read(`?q=${"a".repeat(255)}`).q).toBe("");
    expect(read("?limit=0&offset=-1")).toMatchObject({ limit: 20, offset: 0 });
    expect(read("?limit=101").limit).toBe(20);
    expect(read(`?customerId=${CUSTOMER.toUpperCase()}`).customerId).toBe(CUSTOMER);
  });

  it("keeps a from day after the to day as it is, so the screen can say what is wrong", () => {
    expect(read("?from=2026-10-21&to=2026-10-20")).toMatchObject({
      from: "2026-10-21",
      to: "2026-10-20",
    });
  });

  it("starts a changed filter at the first page and keeps the other filters", () => {
    const query = read(`?status=paid&q=a@b.c&customerId=${CUSTOMER}&offset=40`);
    expect(withFilter(query, { status: undefined })).toEqual({
      from: "",
      to: "",
      q: "a@b.c",
      customerId: CUSTOMER,
      limit: 20,
      offset: 0,
    });
    expect(withFilter(query, { customerId: undefined })).not.toHaveProperty("customerId");
    expect(withFilter(query, { from: "2026-10-01" }).from).toBe("2026-10-01");
    expect(withFilter(query, { q: "" }).q).toBe("");
    expect(withFilter(query, {}).status).toBe("paid");
  });
});

describe("order search text", () => {
  it("trims and allows up to 254 characters (an order number or an exact email)", () => {
    expect(checkOrderSearch("  7k3m9qx2 ")).toEqual({ ok: true, value: "7k3m9qx2" });
    expect(checkOrderSearch("")).toEqual({ ok: true, value: "" });
    expect(checkOrderSearch("a".repeat(254))).toEqual({ ok: true, value: "a".repeat(254) });
    expect(checkOrderSearch("a".repeat(255))).toEqual({ ok: false, reason: "too_long" });
  });

  it("recognizes an order id (the Stock tab links one when a reservation has no number)", () => {
    expect(looksLikeOrderId(CUSTOMER)).toBe(true);
    expect(looksLikeOrderId("7K3M-9QX2")).toBe(false);
    expect(looksLikeOrderId("shopper@example.com")).toBe(false);
  });
});

describe("list request", () => {
  it("sends only the filters that are set, the dates as instants with the zone's offset", () => {
    expect(listRequest(read(""), "Europe/Kyiv")).toEqual({
      ok: true,
      options: { limit: 20, offset: 0 },
    });
    expect(
      listRequest(
        read(
          `?status=awaiting_payment&from=2026-10-25&to=2026-10-25&q=a@b.c&customerId=${CUSTOMER}&offset=20`,
        ),
        "Europe/Kyiv",
      ),
    ).toEqual({
      ok: true,
      options: {
        status: "awaiting_payment",
        placedFrom: "2026-10-25T00:00:00+03:00",
        placedTo: "2026-10-26T00:00:00+02:00",
        q: "a@b.c",
        customerId: CUSTOMER,
        limit: 20,
        offset: 20,
      },
    });
  });

  it("sends nothing for a range the API would refuse and says which field is wrong", () => {
    expect(listRequest(read("?from=2026-10-21&to=2026-10-20"), "UTC")).toEqual({
      ok: false,
      field: "to",
      reason: "end_before_start",
    });
    expect(listRequest(read("?from=2000-01-01"), "Europe/Kyiv")).toEqual({
      ok: false,
      field: "from",
      reason: "out_of_range",
    });
  });
});
