import { matchRoutes, type RouteObject } from "react-router";
import { describe, expect, it } from "vitest";
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
      attributes: "catalog.read",
      options: "catalog.read",
      productTypes: "catalog.read",
      brands: "catalog.read",
      categories: "catalog.read",
      orders: "orders.read",
      customers: "customers.read",
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
