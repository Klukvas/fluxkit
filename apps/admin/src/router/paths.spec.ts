import { describe, expect, it } from "vitest";
import { ADMIN_BASE_PATH, API_PATH_PATTERN } from "./base-path";
import { PATHS, browserPath, buildPath, pathTo } from "./paths";

describe("base path", () => {
  it("is /admin-ui, which the API prefix pattern does not match", () => {
    expect(ADMIN_BASE_PATH).toBe("/admin-ui");
    expect(API_PATH_PATTERN.test(ADMIN_BASE_PATH)).toBe(false);
    expect(API_PATH_PATTERN.test(`${ADMIN_BASE_PATH}/`)).toBe(false);
    expect(API_PATH_PATTERN.test(`${ADMIN_BASE_PATH}/orders`)).toBe(false);
  });

  it("uses the same pattern as the API (apps/api/src/common/admin-path.ts): /admin, /admin/ and any case", () => {
    for (const path of ["/admin", "/admin/", "/admin/orders", "/ADMIN/x", "/Admin"]) {
      expect(API_PATH_PATTERN.test(path), path).toBe(true);
    }
    for (const path of ["/admin-ui", "/administration", "/x/admin", "/adminx/"]) {
      expect(API_PATH_PATTERN.test(path), path).toBe(false);
    }
  });
});

describe("buildPath", () => {
  it("fills named parameters, encoded", () => {
    expect(buildPath("/orders/:id", { id: "a b/c" })).toBe("/orders/a%20b%2Fc");
    expect(buildPath("/products/:id/variants/:variantId", { id: "p1", variantId: "v1" })).toBe(
      "/products/p1/variants/v1",
    );
    expect(buildPath("/orders")).toBe("/orders");
  });

  it("refuses an empty parameter instead of building a different route", () => {
    expect(() => buildPath("/orders/:id", { id: "" })).toThrow(/id/);
  });
});

describe("pathTo and browserPath", () => {
  it("gives the route path relative to the base, and the browser path with the base", () => {
    expect(pathTo("orders")).toBe("/orders");
    expect(pathTo("home")).toBe("/");
    expect(browserPath("/")).toBe("/admin-ui/");
    expect(browserPath("/orders?status=paid")).toBe("/admin-ui/orders?status=paid");
  });

  it("has unique paths that start with one slash", () => {
    const paths = Object.values(PATHS);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path, path).toMatch(/^\/(?!\/)/);
  });
});
