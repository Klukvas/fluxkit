import { describe, expect, it } from "vitest";
import { authHref, loginHref, safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it.each([
    "/uk/cart",
    "/uk/account/profile",
    "/uk/account/orders/7k3m9qx2",
    "/uk/catalog?page=2",
    "/uk/c/shoes?brand=acme",
    "/uk/кошик",
  ])("keeps the same-locale storefront path %s", (path) => {
    expect(safeNextPath(path, "uk")).toBe(path);
  });

  it.each([
    ["//evil.com", "protocol-relative URL"],
    ["//evil.com/uk/cart", "protocol-relative URL with a locale path"],
    ["/\\evil.com", "backslash after the slash (browsers read it as //)"],
    ["/\\/evil.com", "backslash then slash"],
    ["\\\\evil.com", "two backslashes"],
    ["/uk/\\evil.com", "backslash inside the path"],
    ["https://evil.com", "absolute https URL"],
    ["http://evil.com/uk/cart", "absolute http URL"],
    ["https:evil.com", "scheme without slashes"],
    ["javascript:alert(1)", "javascript URL"],
    ["JaVaScRiPt:alert(1)", "javascript URL in mixed case"],
    ["data:text/html,<script>alert(1)</script>", "data URL"],
    ["%2F%2Fevil.com", "encoded protocol-relative URL"],
    ["%2f%2fevil.com", "encoded protocol-relative URL, lower case"],
    ["/%2Fevil.com", "slash then encoded slash"],
    ["/uk/%2F%2Fevil.com", "encoded double slash inside the path"],
    ["/uk/%252F%252Fevil.com", "double-encoded double slash"],
    ["/uk/%5Cevil.com", "encoded backslash"],
    ["/uk/%5cevil.com", "encoded backslash, lower case"],
    ["/%09/evil.com", "encoded tab (browsers drop it)"],
    ["/\t/evil.com", "tab inside the URL"],
    ["\t//evil.com", "leading tab"],
    [" //evil.com", "leading space"],
    ["/uk//evil.com", "double slash inside the path"],
    ["/uk/../evil", "dot segments out of the locale"],
    ["/uk/%2e%2e/evil", "encoded dot segments"],
    ["/uk/..%2F..%2Fevil", "encoded traversal"],
    ["/uk/a%00b", "encoded NUL"],
    ["/uk/%E0%A4%A", "malformed percent-encoding"],
    ["/uk/cart#frag", "a fragment"],
    ["/en/cart", "another locale than the page's"],
    ["/ukraine/cart", "a prefix that only looks like the locale"],
    ["/uk", "no path after the locale"],
    ["/cart", "no locale"],
    ["", "empty"],
    ["   ", "blank"],
    ["/uk/account/login", "the login page itself (a redirect loop)"],
    ["/uk/account/login?next=/uk/cart", "the login page with a query"],
    ["/uk/account/register", "the register page"],
  ])("falls back to the account page for %s (%s)", (value) => {
    expect(safeNextPath(value, "uk")).toBe("/uk/account");
  });

  it("falls back for a missing value and for a repeated query parameter (an array)", () => {
    expect(safeNextPath(undefined, "en")).toBe("/en/account");
    expect(safeNextPath(null, "en")).toBe("/en/account");
    expect(safeNextPath(["/en/cart", "//evil.com"], "en")).toBe("/en/account");
  });

  it("falls back for a very long value", () => {
    expect(safeNextPath(`/uk/${"a".repeat(2000)}`, "uk")).toBe("/uk/account");
  });

  it("accepts the other locale's paths only on that locale's pages", () => {
    expect(safeNextPath("/en/cart", "en")).toBe("/en/cart");
    expect(safeNextPath("/uk/cart", "en")).toBe("/en/account");
  });
});

describe("loginHref", () => {
  it("sends the visitor to the login page of the locale with the current path as next", () => {
    expect(loginHref("uk", "/uk/account/profile")).toBe(
      "/uk/account/login?next=%2Fuk%2Faccount%2Fprofile",
    );
  });

  it("leaves next out when the current path is not a safe storefront path", () => {
    expect(loginHref("uk", "//evil.com")).toBe("/uk/account/login");
    expect(loginHref("uk", "/en/cart")).toBe("/uk/account/login");
    expect(loginHref("uk", "/uk/account/login")).toBe("/uk/account/login");
  });

  it("produces a next that safeNextPath accepts again", () => {
    const href = loginHref("en", "/en/account");
    const next = new URL(href, "http://localhost").searchParams.get("next");
    expect(safeNextPath(next, "en")).toBe("/en/account");
  });
});

describe("authHref", () => {
  it("links the register page and keeps a safe next", () => {
    expect(authHref("uk", "register", "/uk/cart")).toBe("/uk/account/register?next=%2Fuk%2Fcart");
  });

  it("drops a next that is not safe, and has none without one", () => {
    expect(authHref("uk", "register", "//evil.com")).toBe("/uk/account/register");
    expect(authHref("uk", "login", "javascript:alert(1)")).toBe("/uk/account/login");
    expect(authHref("uk", "login", undefined)).toBe("/uk/account/login");
    expect(authHref("uk", "login", null)).toBe("/uk/account/login");
  });
});
