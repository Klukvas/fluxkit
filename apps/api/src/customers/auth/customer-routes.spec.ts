import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { customerProbeFeature, unmarkedAccountProbeFeature } from "../../test/customer-probe.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { storeRoutes, type StoreRoute } from "../../test/store-routes.js";

/**
 * Store routes that are PUBLIC under `/store/account` on purpose (register and login, step 3b adds them here). Every
 * other route there must be marked `@CustomerAuthenticated()`.
 */
const PUBLIC_ACCOUNT_ROUTES: readonly string[] = [];

function unmarkedAccountRoutes(routes: StoreRoute[]): string[] {
  return routes
    .filter(({ pattern }) => /^\/store\/account(\/|$)/i.test(pattern))
    .filter(({ customerAuthenticated }) => !customerAuthenticated)
    .map(({ method, pattern }) => `${method} ${pattern}`)
    .filter((route) => !PUBLIC_ACCOUNT_ROUTES.includes(route));
}

describe("customer route walk (default for the store is public; customer routes must be marked)", () => {
  let running: RunningApp;
  let broken: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ extraFeatures: customerProbeFeature });
    broken = await startApp({ extraFeatures: unmarkedAccountProbeFeature });
  });

  afterAll(async () => {
    await running.app.close();
    await broken.app.close();
  });

  it("every route marked customer-authenticated rejects an anonymous caller with 401", async () => {
    const routes = storeRoutes(running.app);
    const marked = routes.filter(({ customerAuthenticated }) => customerAuthenticated);
    // The probe fixture has routes marked on the method and on the class; the walk must see both kinds.
    expect(marked.map(({ method, pattern }) => `${method} ${pattern}`).sort()).toEqual(
      [
        "DELETE /store/probe-customer-class/two",
        "GET /store/probe-customer-class/one",
        "GET /store/probe-customer/me",
        "POST /store/probe-customer/sign-out",
        "POST /store/probe-customer/write",
      ].sort(),
    );
    for (const { method, path } of marked) {
      const result = await http<ProblemBody>(running.baseUrl, method as "GET", path, {
        ...(method === "GET" || method === "DELETE" ? {} : { body: {} }),
      });
      expect(result.status, `${method} ${path}`).toBe(401);
      expect(result.body, `${method} ${path}`).toMatchObject({ code: "unauthorized" });
      expect(result.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("an unmarked store route stays public: the default of the store did not change", async () => {
    const routes = storeRoutes(running.app);
    const publicRoutes = routes.filter(({ customerAuthenticated }) => !customerAuthenticated);
    expect(publicRoutes.length).toBeGreaterThan(5);
    const result = await http(running.baseUrl, "GET", "/store/probe-customer/public");
    expect(result.status).toBe(200);
    // Real catalog routes are public too.
    for (const path of ["/store/config", "/store/categories"]) {
      expect((await http(running.baseUrl, "GET", path)).status, path).toBe(200);
    }
  });

  it("every route under /store/account is marked, except the explicit public list", () => {
    expect(unmarkedAccountRoutes(storeRoutes(running.app))).toEqual([]);
  });

  it("the walk catches a route under /store/account that forgot the decorator", async () => {
    const routes = storeRoutes(broken.app);
    expect(unmarkedAccountRoutes(routes)).toEqual(["GET /store/account/probe-unmarked"]);
    // And it really is open, which is what the walk protects against.
    const leak = await http(broken.baseUrl, "GET", "/store/account/probe-unmarked");
    expect(leak.status).toBe(200);
  });
});
