import { describe, expect, it } from "vitest";
import {
  MAX_LIMIT,
  MAX_OFFSET,
  offsetForPage,
  pageOfOffset,
  readEnum,
  readPaging,
  readText,
  writeQuery,
} from "./query";

const params = (search: string) => new URLSearchParams(search);

describe("readPaging", () => {
  it("uses the defaults without parameters", () => {
    expect(readPaging(params(""), { defaultLimit: 50 })).toEqual({ limit: 50, offset: 0 });
    expect(readPaging(params(""), { defaultLimit: 20 })).toEqual({ limit: 20, offset: 0 });
  });

  it("reads whole numbers in range", () => {
    expect(readPaging(params("?limit=10&offset=30"), { defaultLimit: 50 })).toEqual({
      limit: 10,
      offset: 30,
    });
    expect(
      readPaging(params(`?limit=${MAX_LIMIT}&offset=${MAX_OFFSET}`), { defaultLimit: 50 }),
    ).toEqual({ limit: MAX_LIMIT, offset: MAX_OFFSET });
  });

  it.each([
    "?limit=0",
    "?limit=-5",
    "?limit=101",
    "?limit=1.5",
    "?limit=1e1",
    "?limit=0x10",
    "?limit=%20",
    "?limit=",
    "?limit=abc",
    "?limit=99999999999999999999",
  ])("falls back to the default limit for %s", (search) => {
    expect(readPaging(params(search), { defaultLimit: 50 }).limit).toBe(50);
  });

  it.each(["?offset=-1", "?offset=10001", "?offset=2.5", "?offset=x", "?offset=+3"])(
    "falls back to offset 0 for %s",
    (search) => {
      expect(readPaging(params(search), { defaultLimit: 50 }).offset).toBe(0);
    },
  );

  it("takes the first value of a repeated parameter", () => {
    expect(readPaging(params("?offset=20&offset=40"), { defaultLimit: 50 }).offset).toBe(20);
  });

  it("respects a smaller maximum limit of a list", () => {
    expect(readPaging(params("?limit=80"), { defaultLimit: 20, maxLimit: 50 }).limit).toBe(20);
  });
});

describe("readText and readEnum", () => {
  it("trims text, keeps an empty value as no filter and refuses too long text", () => {
    expect(readText(params("?q=%20abc%20"), "q", { maxLength: 10 })).toBe("abc");
    expect(readText(params("?q="), "q", { maxLength: 10 })).toBe("");
    expect(readText(params(""), "q", { maxLength: 10 })).toBe("");
    expect(readText(params(`?q=${"a".repeat(11)}`), "q", { maxLength: 10 })).toBe("");
  });

  it("accepts only listed values", () => {
    const statuses = ["draft", "active", "archived"] as const;
    expect(readEnum(params("?status=active"), "status", statuses)).toBe("active");
    expect(readEnum(params("?status=ACTIVE"), "status", statuses)).toBeUndefined();
    expect(readEnum(params("?status=deleted"), "status", statuses)).toBeUndefined();
    expect(readEnum(params(""), "status", statuses)).toBeUndefined();
  });
});

describe("writeQuery", () => {
  it("drops empty values and defaults, so a shared URL stays short", () => {
    expect(
      writeQuery({ q: "", status: undefined, offset: 0, limit: 50 }, { offset: 0, limit: 50 }),
    ).toBe("");
    expect(writeQuery({ q: "abc", offset: 50, limit: 50 }, { offset: 0, limit: 50 })).toBe(
      "?q=abc&offset=50",
    );
  });

  it("encodes values and keeps the given order", () => {
    expect(writeQuery({ status: "paid", q: "a&b=c d" })).toBe("?status=paid&q=a%26b%3Dc+d");
  });

  it("round-trips with the readers", () => {
    const search = writeQuery({ q: "ab c", limit: 20, offset: 40 });
    const read = params(search);
    expect(readText(read, "q", { maxLength: 100 })).toBe("ab c");
    expect(readPaging(read, { defaultLimit: 50 })).toEqual({ limit: 20, offset: 40 });
  });
});

describe("pages and offsets", () => {
  it("converts between 1-based pages and offsets", () => {
    expect(pageOfOffset(0, 50)).toBe(1);
    expect(pageOfOffset(50, 50)).toBe(2);
    expect(pageOfOffset(75, 50)).toBe(2);
    expect(offsetForPage(1, 50)).toBe(0);
    expect(offsetForPage(3, 20)).toBe(40);
  });

  it("never builds an offset beyond the API's maximum", () => {
    expect(offsetForPage(1000, 100)).toBe(MAX_OFFSET);
    expect(offsetForPage(0, 50)).toBe(0);
  });
});
