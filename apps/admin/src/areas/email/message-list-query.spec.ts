import { describe, expect, it } from "vitest";
import {
  MESSAGE_LIST_LIMIT,
  RECIPIENT_MAX_LENGTH,
  checkRecipient,
  hasFilters,
  isTemplateKey,
  listRequest,
  readMessageListQuery,
  readTemplateKey,
  withFilters,
  writeMessageListQuery,
  type MessageListQuery,
} from "./message-list-query";

const read = (query: string) => readMessageListQuery(new URLSearchParams(query));

const bare: MessageListQuery = {
  template: "",
  recipient: "",
  from: "",
  to: "",
  limit: MESSAGE_LIST_LIMIT,
  offset: 0,
};

describe("the URL codec", () => {
  it("reads an empty query as no filters on the first page", () => {
    expect(read("")).toEqual(bare);
    expect(writeMessageListQuery(bare)).toBe("");
    expect(hasFilters(bare)).toBe(false);
  });

  it("reads every filter and writes them back in a stable order", () => {
    const query = read(
      "status=failed&template=order.placed&recipient=%20Anna%20&from=2026-10-01&to=2026-10-26&limit=20&offset=40",
    );
    expect(query).toEqual({
      status: "failed",
      template: "order.placed",
      recipient: "Anna",
      from: "2026-10-01",
      to: "2026-10-26",
      limit: 20,
      offset: 40,
    });
    expect(writeMessageListQuery(query)).toBe(
      "?status=failed&template=order.placed&recipient=Anna&from=2026-10-01&to=2026-10-26&limit=20&offset=40",
    );
    expect(hasFilters(query)).toBe(true);
  });

  it("never throws on a hand-edited URL: a bad value means no filter", () => {
    const query = read(
      "status=exploded&template=NOT%20A%20KEY&recipient=" +
        "x".repeat(RECIPIENT_MAX_LENGTH + 1) +
        "&from=2026-02-31&to=soon&limit=0&offset=-4",
    );
    expect(query).toEqual(bare);
  });

  it("accepts the six statuses only", () => {
    for (const status of ["pending", "sending", "sent", "failed", "unknown", "cancelled"]) {
      expect(read(`status=${status}`).status).toBe(status);
    }
    expect(read("status=PENDING").status).toBeUndefined();
  });
});

describe("template keys", () => {
  it("accepts the shape of the API (a dotted lower-case key) and nothing else", () => {
    expect(isTemplateKey("order.placed")).toBe(true);
    expect(isTemplateKey("customer.password_reset")).toBe(true);
    for (const bad of [
      "order",
      "Order.placed",
      "order..placed",
      "order.placed;x",
      "a.".repeat(40),
    ]) {
      expect(isTemplateKey(bad), bad).toBe(false);
    }
    expect(readTemplateKey(null)).toBe("");
    expect(readTemplateKey("nope")).toBe("");
  });
});

describe("withFilters", () => {
  it("starts at the first page again, keeps the page size and trims the recipient", () => {
    const next = withFilters(
      { ...bare, limit: 20, offset: 60, status: "sent" },
      { template: "order.paid", recipient: "  a@b  ", from: "", to: "" },
    );
    expect(next).toEqual({
      template: "order.paid",
      recipient: "a@b",
      from: "",
      to: "",
      limit: 20,
      offset: 0,
    });
  });
  it("removes the status when the filters name none", () => {
    expect(
      withFilters({ ...bare, status: "sent" }, { template: "", recipient: "", from: "", to: "" }),
    ).not.toHaveProperty("status");
  });
});

describe("checkRecipient", () => {
  it("trims, allows empty and refuses what the API would refuse", () => {
    expect(checkRecipient("  a@b ")).toEqual({ ok: true, value: "a@b" });
    expect(checkRecipient("")).toEqual({ ok: true, value: "" });
    expect(checkRecipient("x".repeat(RECIPIENT_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });
});

describe("listRequest", () => {
  it("sends only the filters that are set, with the days as instants of the zone (to is exclusive at the next day)", () => {
    const request = listRequest(
      {
        ...bare,
        status: "failed",
        template: "order.placed",
        recipient: "anna",
        from: "2026-10-01",
        to: "2026-10-26",
      },
      "UTC",
    );
    expect(request).toEqual({
      ok: true,
      options: {
        status: "failed",
        template: "order.placed",
        recipient: "anna",
        createdFrom: "2026-10-01T00:00:00+00:00",
        createdTo: "2026-10-27T00:00:00+00:00",
        limit: MESSAGE_LIST_LIMIT,
        offset: 0,
      },
    });
  });

  it("uses the offset in force in the zone (Kyiv changes its clock on 2026-10-25)", () => {
    const request = listRequest({ ...bare, from: "2026-10-25", to: "2026-10-25" }, "Europe/Kyiv");
    expect(request).toMatchObject({
      ok: true,
      options: { createdFrom: "2026-10-25T00:00:00+03:00", createdTo: "2026-10-26T00:00:00+02:00" },
    });
  });

  it("sends nothing for no filters but the paging", () => {
    expect(listRequest(bare, "UTC")).toEqual({
      ok: true,
      options: { limit: MESSAGE_LIST_LIMIT, offset: 0 },
    });
  });

  it("refuses an end before the start and says which field", () => {
    expect(listRequest({ ...bare, from: "2026-10-26", to: "2026-10-01" }, "UTC")).toEqual({
      ok: false,
      field: "to",
      reason: "end_before_start",
    });
  });
});
