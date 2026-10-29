import { describe, expect, it } from "vitest";
import {
  REQUEST_LIST_LIMIT,
  readRequestListQuery,
  withStatus,
  writeRequestListQuery,
} from "./request-list-query";

describe("the request list query", () => {
  it("reads a status and paging, and ignores junk", () => {
    expect(
      readRequestListQuery(new URLSearchParams("status=completed&limit=20&offset=40")),
    ).toEqual({
      status: "completed",
      limit: 20,
      offset: 40,
    });
    expect(readRequestListQuery(new URLSearchParams("status=nope&limit=0&offset=-1"))).toEqual({
      limit: REQUEST_LIST_LIMIT,
      offset: 0,
    });
  });

  it("writes the bare path for the first unfiltered page and omits defaults", () => {
    expect(writeRequestListQuery({ limit: REQUEST_LIST_LIMIT, offset: 0 })).toBe("");
    expect(
      writeRequestListQuery({ status: "received", limit: REQUEST_LIST_LIMIT, offset: 50 }),
    ).toBe("?status=received&offset=50");
  });

  it("starts at the first page when the status changes", () => {
    expect(withStatus({ status: "received", limit: 20, offset: 40 }, "rejected")).toEqual({
      status: "rejected",
      limit: 20,
      offset: 0,
    });
    expect(withStatus({ status: "received", limit: 20, offset: 40 }, undefined)).toEqual({
      limit: 20,
      offset: 0,
    });
  });
});
