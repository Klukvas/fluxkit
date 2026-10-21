import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, matchRoutes, type RouteObject } from "react-router";
import { describe, expect, it } from "vitest";
import { withAreaMessages } from "./i18n/area-messages";
import { I18nProvider } from "./i18n/i18n-context";
import { ADMIN_BASE_PATH, API_PATH_PATTERN } from "./router/base-path";
import { browserPath } from "./router/paths";
import { buildRouteObjects, NOT_FOUND_ROUTE_ID } from "./router/route-objects";
import { ROUTES, routeById, type AppRoute } from "./routes";
import { RouteErrorBoundary } from "./views/error-boundaries";

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
      userNew: "users.manage",
      userDetail: "users.manage",
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
    expect(declared.users).toEqual(["users"]);
    expect(declared.userNew).toEqual(["users"]);
    expect(declared.userDetail).toEqual(["users"]);
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

describe("a lazy route whose chunk cannot be loaded (step 13 review, M1)", () => {
  const failure = new TypeError(
    "Failed to fetch dynamically imported module: /admin-ui/assets/x.js",
  );
  function Orders() {
    return <p>orders-body</p>;
  }
  function table(load: () => Promise<{ Component: () => ReactElement; messageFiles: [] }>) {
    const orders: AppRoute = { ...routeById("orders"), page: { kind: "lazy", load } };
    return buildRouteObjects([routeById("login"), routeById("home"), orders]);
  }
  type Router = ReturnType<typeof createMemoryRouter>;
  function settled(router: Router): Promise<void> {
    return new Promise((done) => {
      const check = () => {
        if (router.state.initialized && router.state.navigation.state === "idle") done();
      };
      router.subscribe(check);
      check();
    });
  }
  /** The route that holds the error, and whether it is the shell's error boundary. */
  function errorAt(router: Router): { error: unknown; boundary: unknown } | null {
    const entries = Object.entries(router.state.errors ?? {});
    if (entries.length === 0) return null;
    expect(entries).toHaveLength(1);
    const [routeId, error] = entries[0] as [string, unknown];
    const match = router.state.matches.find((entry) => entry.route.id === routeId);
    // The router turns `ErrorBoundary` and `Component` into elements (`errorElement`, `element`).
    return { error, boundary: (match?.route.errorElement as ReactElement | undefined)?.type };
  }

  it("ends an in-app navigation with the error at the shell's route error boundary (not a blank route)", async () => {
    const router = createMemoryRouter(
      table(() => Promise.reject(failure)),
      {
        initialEntries: ["/"],
      },
    );
    await settled(router);
    await router.navigate("/orders");
    expect(router.state.location.pathname).toBe("/orders");
    expect(errorAt(router)).toEqual({ error: failure, boundary: RouteErrorBoundary });
    router.dispose();
  });

  it("does the same on a deep link (the first load)", async () => {
    const router = createMemoryRouter(
      table(() => Promise.reject(failure)),
      {
        initialEntries: ["/orders"],
      },
    );
    await settled(router);
    expect(errorAt(router)).toEqual({ error: failure, boundary: RouteErrorBoundary });
    router.dispose();
  });

  it("renders the page and records no error when the chunk loads", async () => {
    const router = createMemoryRouter(
      table(() => Promise.resolve({ Component: Orders, messageFiles: [] })),
      { initialEntries: ["/"] },
    );
    await settled(router);
    await router.navigate("/orders");
    expect(errorAt(router)).toBeNull();
    const leaf = router.state.matches[router.state.matches.length - 1];
    expect((leaf?.route.element as ReactElement | undefined)?.type).toBe(Orders);
    router.dispose();
  });
});
