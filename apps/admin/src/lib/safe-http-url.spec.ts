import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "./safe-http-url";

describe("safeHttpUrl", () => {
  it.each([
    ["https://example.com/a.jpg", "https://example.com/a.jpg"],
    ["http://example.com/a.jpg?x=1#y", "http://example.com/a.jpg?x=1#y"],
    ["HTTPS://EXAMPLE.COM/A.jpg", "https://example.com/A.jpg"],
    ["https://cdn.example.org:8443/p", "https://cdn.example.org:8443/p"],
    ["https://example.com/a b.jpg", "https://example.com/a%20b.jpg"],
  ])("accepts the http(s) URL %s", (value, expected) => {
    expect(safeHttpUrl(value)).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:image/png;base64,AAAA",
    "vbscript:x",
    "file:///etc/passwd",
    "blob:https://example.com/uuid",
    "ftp://example.com/a",
    "//example.com/a.jpg",
    "/relative/a.jpg",
    "a.jpg",
    "https:example.com",
    "https://user:secret@example.com/a.jpg",
    "https://",
    "",
    "   ",
  ])("refuses %s", (value) => {
    expect(safeHttpUrl(value)).toBeNull();
  });

  it("refuses non-strings and very long values", () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
    expect(safeHttpUrl(`https://example.com/${"a".repeat(3000)}`)).toBeNull();
  });
});
