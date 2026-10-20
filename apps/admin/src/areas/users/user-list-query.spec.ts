import { describe, expect, it } from "vitest";
import {
  USER_LIST_LIMIT,
  listRequest,
  readUserListQuery,
  writeUserListQuery,
} from "./user-list-query";

const read = (search: string) => readUserListQuery(new URLSearchParams(search));

describe("the users list's URL state", () => {
  it("uses the API's default page size of 50 when the URL is bare", () => {
    expect(USER_LIST_LIMIT).toBe(50);
    expect(read("")).toEqual({ limit: 50, offset: 0 });
    expect(writeUserListQuery(read(""))).toBe("");
  });

  it("round-trips the paging and leaves the defaults out", () => {
    expect(writeUserListQuery(read("?limit=20&offset=40"))).toBe("?limit=20&offset=40");
    expect(writeUserListQuery({ limit: 50, offset: 50 })).toBe("?offset=50");
  });

  it("reads a hand-edited bad value as the default, never throws, and keeps nothing else", () => {
    expect(read("?limit=0&offset=-1")).toEqual({ limit: 50, offset: 0 });
    expect(read("?limit=101&offset=10001")).toEqual({ limit: 50, offset: 0 });
    expect(read("?limit=abc&email=x%40y.z&q=a")).toEqual({ limit: 50, offset: 0 });
    expect(writeUserListQuery(read("?email=x%40y.z&offset=50"))).toBe("?offset=50");
  });

  it("asks the API for exactly the page in the URL", () => {
    expect(listRequest({ limit: 20, offset: 40 })).toEqual({ limit: 20, offset: 40 });
  });
});
