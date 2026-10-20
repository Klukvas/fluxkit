import { renderToStaticMarkup } from "react-dom/server";
import { matchRoutes, type RouteObject } from "react-router";
import { describe, expect, it } from "vitest";
import { withAreaMessages } from "./i18n/area-messages";
import { I18nProvider } from "./i18n/i18n-context";
import { ADMIN_BASE_PATH, API_PATH_PATTERN } from "./router/base-path";
import { browserPath } from "./router/paths";
import { buildRouteObjects, NOT_FOUND_ROUTE_ID } from "./router/route-objects";
import { ROUTES, routeById } from "./routes";

const objects: RouteObject[] = buildRouteObjects();

function matchedRouteId(pathname: string): string | undefined {
  const matches = matchRoutes(objects, pathname) ?? [];
  const last = matches[matches.length - 1];
  return (last?.route.handle as { routeId?: string } | undefined)?.routeId;
}

describe("route table", () => {
  it("lists the shell's routes", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(ROUTES.map((route) => route.id)).size).toBe(ROUTES.length);
    expect(new Set(ROUTES.map((route) => route.path)).size).toBe(ROUTES.length);
  });

  it("has no route under the API prefix: neither the path relative to the base nor the full browser path", () => {
    for (const route of ROUTES) {
      expect(route.path.toLowerCase().startsWith("/admin"), route.path).toBe(false);
      expect(API_PATH_PATTERN.test(route.path), route.path).toBe(false);
      const full = browserPath(route.path);
      expect(full.startsWith(`${ADMIN_BASE_PATH}/`), full).toBe(true);
      expect(API_PATH_PATTERN.test(full), full).toBe(false);
    }
  });

  it("gives every route a permission; only /login is public and nothing is denied", () => {
    const allowed = new Set([
      "public",
      "authenticated",
      "catalog.read",
      "catalog.write",
      "catalog.publish",
      "orders.read",
      "orders.write",
      "customers.read",
      "customers.write",
      "users.manage",
    ]);
    for (const route of ROUTES) {
      expect(allowed.has(route.permission), `${route.id}: ${route.permission}`).toBe(true);
    }
    expect(
      ROUTES.filter((route) => route.permission === "public").map((route) => route.path),
    ).toEqual(["/login"]);
  });

  it("guards each area with the permission its list needs (hand-written expectation)", () => {
    const expected: Record<string, string> = {
      login: "public",
      home: "authenticated",
      account: "authenticated",
      products: "catalog.read",
      productNew: "catalog.write",
      productDetail: "catalog.read",
      attributes: "catalog.read",
      attributeNew: "catalog.write",
      attributeDetail: "catalog.read",
      options: "catalog.read",
      optionNew: "catalog.write",
      optionDetail: "catalog.read",
      productTypes: "catalog.read",
      productTypeNew: "catalog.write",
      productTypeDetail: "catalog.read",
      brands: "catalog.read",
      brandNew: "catalog.write",
      brandDetail: "catalog.read",
      categories: "catalog.read",
      categoryNew: "catalog.write",
      categoryDetail: "catalog.read",
      orders: "orders.read",
      orderDetail: "orders.read",
      customers: "customers.read",
      customerDetail: "customers.read",
      users: "users.manage",
    };
    expect(Object.fromEntries(ROUTES.map((route) => [route.id, route.permission]))).toEqual(
      expected,
    );
  });

  it("gives every route a title key", () => {
    for (const route of ROUTES) expect(route.titleKey, route.id).toMatch(/^[a-z][A-Za-z0-9.]+$/);
  });

  it("keeps the sign-in page and the start page in the entry chunk and loads every other route lazily", () => {
    for (const route of ROUTES) {
      const eager = route.id === "login" || route.id === "home";
      expect(route.page.kind, route.id).toBe(eager ? "eager" : "lazy");
    }
  });
});

describe("route objects for the router", () => {
  it("match every route of the table", () => {
    for (const route of ROUTES) expect(matchedRouteId(route.path), route.path).toBe(route.id);
  });

  it("show the not-found route for unknown paths", () => {
    for (const path of ["/nope", "/orders/x/y/z", "/admin", "/catalog", "/login/extra"]) {
      expect(matchedRouteId(path), path).toBe(NOT_FOUND_ROUTE_ID);
    }
  });

  it("find a route by id", () => {
    expect(routeById("orders").path).toBe("/orders");
  });
});

describe("lazy pages and their message files", () => {
  it("load each area page with the lazy message files its module declares", async () => {
    const declared: Record<string, readonly string[]> = {};
    for (const route of ROUTES) {
      if (route.page.kind !== "lazy") continue;
      const loaded = await route.page.load();
      expect(typeof loaded.Component, route.id).toBe("function");
      declared[route.id] = loaded.messageFiles;
    }
    expect(declared.attributes).toEqual(["catalog-dictionaries"]);
    expect(declared.categoryDetail).toEqual(["catalog-dictionaries"]);
    expect(declared.account).toEqual([]);
    expect(declared.orders).toEqual(["orders"]);
    expect(declared.orderDetail).toEqual(["orders"]);
    expect(declared.customers).toEqual(["customers"]);
    expect(declared.customerDetail).toEqual(["customers"]);
    expect(declared.products).toEqual(["catalog-dictionaries", "products"]);
    expect(declared.productDetail).toEqual(["catalog-dictionaries", "products"]);
  });

  it("render an area only after its files are loaded (the shell's loading view meanwhile)", () => {
    function Page() {
      return <p>page-body</p>;
    }
    expect(withAreaMessages(Page, [])).toBe(Page);
    const Wrapped = withAreaMessages(Page, ["catalog-dictionaries"]);
    expect(Wrapped).not.toBe(Page);
    // Static rendering runs no effect, so the files are never loaded: the loading view stays.
    const html = renderToStaticMarkup(
      <I18nProvider initial="en">
        <Wrapped />
      </I18nProvider>,
    );
    expect(html).not.toContain("page-body");
    expect(html).toContain('aria-busy="true"');
  });
});
