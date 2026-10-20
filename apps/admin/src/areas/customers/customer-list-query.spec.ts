import { describe, expect, it } from "vitest";
import {
  CUSTOMER_LIST_LIMIT,
  CUSTOMER_SEARCH_MAX_LENGTH,
  checkCustomerSearch,
  listRequest,
  readCustomerListQuery,
  withSearch,
  writeCustomerListQuery,
} from "./customer-list-query";

const read = (search: string) => readCustomerListQuery(new URLSearchParams(search));

describe("the customer list's URL state", () => {
  it("uses the API's default page size and no search when the URL is bare", () => {
    expect(CUSTOMER_LIST_LIMIT).toBe(50);
    expect(read("")).toEqual({ q: "", limit: 50, offset: 0 });
    expect(writeCustomerListQuery(read(""))).toBe("");
  });

  it("round-trips the search and the paging", () => {
    const query = read("?q=anna&limit=20&offset=40");
    expect(query).toEqual({ q: "anna", limit: 20, offset: 40 });
    expect(writeCustomerListQuery(query)).toBe("?q=anna&limit=20&offset=40");
  });

  it("leaves the default limit and the first page out of the URL", () => {
    expect(writeCustomerListQuery({ q: "a", limit: 50, offset: 0 })).toBe("?q=a");
    expect(writeCustomerListQuery({ q: "", limit: 50, offset: 50 })).toBe("?offset=50");
  });

  it("reads a hand-edited bad value as no filter, never throws", () => {
    expect(read("?limit=0&offset=-1")).toEqual({ q: "", limit: 50, offset: 0 });
    expect(read("?limit=101&offset=10001")).toEqual({ q: "", limit: 50, offset: 0 });
    expect(read("?limit=abc&offset=1e3")).toEqual({ q: "", limit: 50, offset: 0 });
  });

  it("trims the search it reads and drops one the API would refuse", () => {
    expect(read("?q=%20%20Anna%20").q).toBe("Anna");
    expect(read(`?q=${"a".repeat(CUSTOMER_SEARCH_MAX_LENGTH + 1)}`).q).toBe("");
    expect(read(`?q=${"a".repeat(CUSTOMER_SEARCH_MAX_LENGTH)}`).q).toHaveLength(254);
  });

  it("puts nothing but the typed search and the paging into the URL", () => {
    const keys = [...new URLSearchParams(writeCustomerListQuery(read("?q=a&limit=10&offset=5")))]
      .map(([key]) => key)
      .sort();
    expect(keys).toEqual(["limit", "offset", "q"]);
  });

  it("starts at the first page again when the search changes, keeping the page size", () => {
    expect(withSearch({ q: "a", limit: 20, offset: 60 }, "b")).toEqual({
      q: "b",
      limit: 20,
      offset: 0,
    });
  });
});

describe("the search check", () => {
  it("trims the text as the API will read it; blank means no search", () => {
    expect(checkCustomerSearch("  Anna@Example.com ")).toEqual({
      ok: true,
      value: "Anna@Example.com",
    });
    expect(checkCustomerSearch("   ")).toEqual({ ok: true, value: "" });
  });

  it("refuses text longer than an email can be, after trimming", () => {
    expect(checkCustomerSearch("a".repeat(255))).toEqual({ ok: false, reason: "too_long" });
    expect(checkCustomerSearch(`  ${"a".repeat(254)}  `)).toEqual({
      ok: true,
      value: "a".repeat(254),
    });
  });
});

describe("the request for a query", () => {
  it("sends only what is set, with the page the URL names", () => {
    expect(listRequest({ q: "", limit: 50, offset: 0 })).toEqual({ limit: 50, offset: 0 });
    expect(listRequest({ q: "ann", limit: 20, offset: 40 })).toEqual({
      q: "ann",
      limit: 20,
      offset: 40,
    });
  });
});
