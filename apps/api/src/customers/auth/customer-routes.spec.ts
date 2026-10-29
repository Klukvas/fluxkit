import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { customerProbeFeature, unmarkedAccountProbeFeature } from "../../test/customer-probe.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { testEmailProviders } from "../../test/test-email-provider.js";
import { storeRoutes, type StoreRoute } from "../../test/store-routes.js";

/**
 * Store routes that are PUBLIC under `/store/account` on purpose: register and login, and the three mail-link routes of
 * ADR 0031 (the person is signed out, or opened the link in another browser), nothing else. Every other route there
 * must be marked `@CustomerAuthenticated()`. A new public account route is a decision: it has to be added here by name,
 * and the walk below fails until it is.
 */
const PUBLIC_ACCOUNT_ROUTES: readonly string[] = [
  "POST /store/account/login",
  "POST /store/account/password-reset",
  "POST /store/account/password-reset/confirm",
  "POST /store/account/register",
  "POST /store/account/verify-email",
];

/** The public account routes that need mail: `404` without a provider, the handler with one (ADR 0031 decision 11). */
const PUBLIC_MAIL_ROUTES: readonly string[] = [
  "/store/account/password-reset",
  "/store/account/password-reset/confirm",
  "/store/account/verify-email",
];

/** Every route under `/store/account` that is NOT marked `@CustomerAuthenticated()`, public ones included. */
function unmarkedAccountRoutes(routes: StoreRoute[]): string[] {
  return routes
    .filter(({ pattern }) => /^\/store\/account(\/|$)/i.test(pattern))
    .filter(({ customerAuthenticated }) => !customerAuthenticated)
    .map(({ method, pattern }) => `${method} ${pattern}`)
    .sort();
}

describe("customer route walk (default for the store is public; customer routes must be marked)", () => {
  let running: RunningApp;
  let broken: RunningApp;
  let mailing: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ extraFeatures: customerProbeFeature });
    broken = await startApp({ extraFeatures: unmarkedAccountProbeFeature });
    mailing = await startApp({ extraEmailProviders: testEmailProviders() });
  });

  afterAll(async () => {
    await running.app.close();
    await broken.app.close();
    await mailing.app.close();
  });

  it("every route marked customer-authenticated rejects an anonymous caller with 401", async () => {
    const routes = storeRoutes(running.app);
    const marked = routes.filter(({ customerAuthenticated }) => customerAuthenticated);
    // The probe fixture has routes marked on the method and on the class; the walk must see both kinds.
    expect(marked.map(({ method, pattern }) => `${method} ${pattern}`).sort()).toEqual(
      [
        "DELETE /store/probe-customer-class/two",
        "GET /store/account/data-export",
        "GET /store/account/me",
        "GET /store/account/orders",
        "GET /store/account/orders/:number",
        "GET /store/account/orders/:number/payments/:paymentId",
        "POST /store/account/orders/:number/cancel",
        "POST /store/account/orders/:number/payments",
        "GET /store/probe-customer-class/one",
        "GET /store/probe-customer/me",
        "PATCH /store/account/me",
        "POST /store/account/change-password",
        "POST /store/account/delete",
        "POST /store/account/logout",
        "POST /store/account/verify-email/resend",
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

  it("every route under /store/account is marked, except exactly the explicit public list (register, login and the mail-link routes)", () => {
    expect(unmarkedAccountRoutes(storeRoutes(running.app))).toEqual(
      [...PUBLIC_ACCOUNT_ROUTES].sort(),
    );
    // The same routes exist with a mail provider: the provider adds no route and removes none.
    expect(unmarkedAccountRoutes(storeRoutes(mailing.app))).toEqual(
      [...PUBLIC_ACCOUNT_ROUTES].sort(),
    );
  });

  it("the public mail-link routes answer 404 without a provider and reach their handler (400 for an empty body) with one", async () => {
    for (const path of PUBLIC_MAIL_ROUTES) {
      const off = await http<ProblemBody>(running.baseUrl, "POST", path, { body: {} });
      expect(off.status, path).toBe(404);
      expect(off.body, path).toMatchObject({ code: "not_found" });
      expect(off.headers.get("cache-control"), path).toBe("no-store");
      const on = await http<ProblemBody>(mailing.baseUrl, "POST", path, { body: {} });
      expect(on.status, path).toBe(400);
      expect(on.body, path).toMatchObject({ code: "validation_failed" });
      expect(on.headers.get("cache-control"), path).toBe("no-store");
    }
  });

  it("register and login are public on purpose: an anonymous call reaches the handler (400 for an empty body, not 401)", async () => {
    for (const path of ["/store/account/register", "/store/account/login"]) {
      const result = await http<ProblemBody>(running.baseUrl, "POST", path, { body: {} });
      expect(result.status, path).toBe(400);
      expect(result.body, path).toMatchObject({ code: "validation_failed" });
    }
  });

  it("the walk catches a route under /store/account that forgot the decorator", async () => {
    const routes = storeRoutes(broken.app);
    expect(unmarkedAccountRoutes(routes)).toEqual(
      [...PUBLIC_ACCOUNT_ROUTES, "GET /store/account/probe-unmarked"].sort(),
    );
    // And it really is open, which is what the walk protects against.
    const leak = await http(broken.baseUrl, "GET", "/store/account/probe-unmarked");
    expect(leak.status).toBe(200);
  });
});
