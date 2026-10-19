import { describe, expect, it } from "vitest";
import { ADMIN_BASE_PATH, API_PATH_PATTERN } from "./base-path";
import { currentRelativePath, loginPath, safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it.each([
    "/orders",
    "/orders?status=paid&offset=20",
    "/catalog/product-types",
    "/account",
    "/products?q=%D1%84%D1%83",
    "/замовлення",
    "/loginx",
    "/login-help",
    "/orders/login",
  ])("keeps the SPA path %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    ["//evil.com", "protocol-relative URL"],
    ["//evil.com/orders", "protocol-relative URL with a path"],
    ["/\\evil.com", "backslash after the slash (browsers read it as //)"],
    ["\\\\evil.com", "two backslashes"],
    ["/orders/\\evil.com", "backslash inside the path"],
    ["https://evil.com", "absolute https URL"],
    ["http://evil.com/orders", "absolute http URL"],
    ["https:evil.com", "scheme without slashes"],
    ["javascript:alert(1)", "javascript URL"],
    ["JaVaScRiPt:alert(1)", "javascript URL in mixed case"],
    ["data:text/html,<script>alert(1)</script>", "data URL"],
    ["%2F%2Fevil.com", "encoded protocol-relative URL"],
    ["/%2Fevil.com", "slash then encoded slash"],
    ["/orders/%2F%2Fevil.com", "encoded double slash inside the path"],
    ["/orders/%252F%252Fevil.com", "double-encoded double slash"],
    ["/orders/%5Cevil.com", "encoded backslash"],
    ["/%09/evil.com", "encoded tab (browsers drop it)"],
    ["/\t/evil.com", "tab inside the URL"],
    [" /orders", "leading space"],
    ["/orders//evil.com", "double slash inside the path"],
    ["/orders/../login", "dot segments"],
    ["/orders/%2e%2e/login", "encoded dot segments"],
    ["/orders/a%00b", "encoded NUL"],
    ["/orders/%E0%A4%A", "malformed percent-encoding"],
    ["/orders#frag", "a fragment"],
    ["orders", "not starting with a slash"],
    ["", "empty"],
    ["/login", "the sign-in page itself (a redirect loop)"],
    ["/login/", "the sign-in page with a trailing slash"],
    ["/login?next=/orders", "the sign-in page with a query"],
    ["/LOGIN", "the sign-in page in upper case"],
    ["/%6Cogin", "the sign-in page with an encoded letter"],
    ["/./login", "the sign-in page behind a dot segment"],
    ["/admin", "the API prefix"],
    ["/admin/orders", "an API path"],
    ["/ADMIN/orders", "an API path in upper case"],
    ["/admin-ui/orders", "the SPA's own base path (it would be doubled)"],
    ["/administration", "any path starting with /admin (no SPA route does)"],
    ["/%61dmin/orders", "an API path with an encoded letter"],
  ])("falls back to the start page for %s (%s)", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });

  it("falls back for a missing value, a repeated parameter (an array) and a very long value", () => {
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(["/orders", "//evil.com"])).toBe("/");
    expect(safeNextPath(`/${"a".repeat(2000)}`)).toBe("/");
  });
});

describe("safeNextPath, whatever it returns stays inside the SPA (property)", () => {
  // The URL parser is the judge: the router navigates to `ADMIN_BASE_PATH + result`, so that URL must stay on the origin,
  // stay under the base path, never be the sign-in page and never reach the API prefix. A deterministic generator over
  // the characters that matter to URL parsing, so a check removed from the string rules fails here.
  const alphabet = [
    "/",
    "/",
    ".",
    "..",
    "%",
    "2",
    "e",
    "5",
    "c",
    "f",
    "6",
    "1",
    "\\",
    "#",
    "?",
    "\t",
    " ",
    ":",
    "a",
    "admin",
    "login",
    "orders",
    "http",
  ];
  function next(seed: number): number {
    return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  }

  it("never leaves the SPA for 20000 generated values", () => {
    let seed = 20_261_019;
    let kept = 0;
    for (let round = 0; round < 20_000; round += 1) {
      let value = round % 3 === 0 ? "" : "/";
      const length = 1 + (round % 9);
      for (let index = 0; index < length; index += 1) {
        seed = next(seed);
        value += alphabet[seed % alphabet.length] as string;
      }
      const result = safeNextPath(value);
      if (result !== "/") kept += 1;
      const parsed = new URL(`${ADMIN_BASE_PATH}${result}`, "http://admin.invalid");
      expect(parsed.origin, value).toBe("http://admin.invalid");
      expect(parsed.pathname.startsWith(`${ADMIN_BASE_PATH}/`), value).toBe(true);
      const relative = parsed.pathname.slice(ADMIN_BASE_PATH.length);
      expect(relative.replace(/\/+$/, "").toLowerCase(), value).not.toBe("/login");
      expect(API_PATH_PATTERN.test(relative), value).toBe(false);
      expect(API_PATH_PATTERN.test(parsed.pathname), value).toBe(false);
      expect(result.includes("\\"), value).toBe(false);
      expect(result.includes("#"), value).toBe(false);
    }
    // The generator must also produce accepted values, or the property proves nothing.
    expect(kept).toBeGreaterThan(500);
  });
});

describe("currentRelativePath and loginPath", () => {
  it("joins the path and its query string", () => {
    expect(currentRelativePath("/orders", "?status=paid")).toBe("/orders?status=paid");
    expect(currentRelativePath("/orders", "")).toBe("/orders");
    expect(currentRelativePath("/orders", "?")).toBe("/orders");
  });

  it("links the sign-in page with a safe next only", () => {
    expect(loginPath("/orders?status=paid")).toBe("/login?next=%2Forders%3Fstatus%3Dpaid");
    expect(loginPath("/")).toBe("/login");
    expect(loginPath(null)).toBe("/login");
    expect(loginPath("//evil.com")).toBe("/login");
    expect(loginPath("/login")).toBe("/login");
  });

  it("produces a next that safeNextPath accepts again", () => {
    const next = new URL(loginPath("/customers?q=a"), "http://admin.invalid").searchParams.get(
      "next",
    );
    expect(safeNextPath(next)).toBe("/customers?q=a");
  });
});
