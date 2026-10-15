import { describe, expect, it } from "vitest";
import { z } from "zod";
import { pageSchema, paginationQuerySchema, toPage } from "./pagination.js";

describe("paginationQuerySchema", () => {
  it("defaults to limit 50 and offset 0", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it("parses numeric strings from the query string", () => {
    expect(paginationQuerySchema.parse({ limit: "100", offset: "10000" })).toEqual({
      limit: 100,
      offset: 10000,
    });
    expect(paginationQuerySchema.parse({ limit: "1", offset: "0" })).toEqual({
      limit: 1,
      offset: 0,
    });
  });

  it.each([
    { limit: "0" },
    { limit: "101" },
    { limit: "-1" },
    { limit: "1.5" },
    { limit: "abc" },
    { limit: "" },
    { limit: "1e2" },
    { limit: ["1", "2"] },
    { offset: "10001" },
    { offset: "-1" },
    { offset: "x" },
    { offset: "99999999999999999999" },
  ])("rejects %j", (query) => {
    expect(paginationQuerySchema.safeParse(query).success).toBe(false);
  });

  it("can be extended with list filters", () => {
    const extended = paginationQuerySchema.extend({
      status: z.enum(["draft", "active"]).optional(),
    });
    expect(extended.parse({ status: "draft", limit: "5" })).toEqual({
      status: "draft",
      limit: 5,
      offset: 0,
    });
  });
});

describe("toPage", () => {
  it("builds { items, total, limit, offset }", () => {
    expect(toPage(["a"], 7, { limit: 1, offset: 3 })).toEqual({
      items: ["a"],
      total: 7,
      limit: 1,
      offset: 3,
    });
  });

  it("pageSchema describes the same shape", () => {
    expect(pageSchema(z.string()).parse(toPage(["a"], 1, { limit: 50, offset: 0 }))).toEqual({
      items: ["a"],
      total: 1,
      limit: 50,
      offset: 0,
    });
  });
});
