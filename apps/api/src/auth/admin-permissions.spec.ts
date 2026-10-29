import { Controller, Get, Module, Post, RequestMethod } from "@nestjs/common";
import { ModulesContainer, Reflector } from "@nestjs/core";
import { permissionsOf, type AdminPermission, type AdminRole } from "@fluxkit/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../common/problem.filter.js";
import { startApp, type RunningApp } from "../test/app.js";
import { http } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import { testPrincipal } from "../test/allow-all-admin-authenticator.js";
import { adminRoutes, SOME_ID } from "../test/routes.js";
import { PublicAdminRoute, RequirePermission, resolveRouteAccess } from "./route-access.js";

@Controller("admin/probe-users")
class UsersProbeController {
  @Get()
  @RequirePermission("users.manage")
  list(): { ok: true } {
    return { ok: true };
  }

  @Post("open")
  @PublicAdminRoute()
  open(): { ok: true } {
    return { ok: true };
  }
}

@Module({ controllers: [UsersProbeController] })
class UsersProbeModule {}

const probeFeature = [{ name: "users-probe", module: UsersProbeModule }];

/** The documented rule: publish routes need catalog.publish, otherwise GET/HEAD read and everything else write. */
const PUBLISH_ROUTES = new Set([
  "POST /admin/products/:id/publish",
  "POST /admin/products/:id/unpublish",
  "POST /admin/products/:id/archive",
  "POST /admin/products/:id/restore",
]);

/** The sign-in flow: login is public, the other three serve any signed-in admin whatever the role; so does the config read. */
const PUBLIC_ROUTES = ["POST /admin/auth/login"];
const AUTHENTICATED_ROUTES = [
  "GET /admin/auth/me",
  "POST /admin/auth/change-password",
  "POST /admin/auth/logout",
  "GET /admin/config",
];
const USERS_ROUTES = [
  "GET /admin/users",
  "POST /admin/users",
  "GET /admin/users/:id",
  "PATCH /admin/users/:id",
  "POST /admin/users/:id/reset-password",
];

/** The admin audit log (ADR 0033 decision 9): read only, owner only, declared once on the controller. */
const AUDIT_ROUTES = ["GET /admin/audit-events"];

/** Customer management: declared once on the controller with its own default pair (`customers.read`, `customers.write`). */
const CUSTOMERS_ROUTES = [
  "GET /admin/customers",
  "GET /admin/customers/:id",
  "PATCH /admin/customers/:id",
  "POST /admin/customers/:id/unlock",
];

/** Order management: declared once on the controller with its own default pair (`orders.read`, `orders.write`). */
const ORDERS_ROUTES = [
  "GET /admin/orders",
  "GET /admin/orders/:id",
  "POST /admin/orders/:id/cancel",
  "POST /admin/orders/:id/mark-paid",
  "POST /admin/orders/:id/mark-fulfilled",
  // Shipments (ADR 0029 decision 10): the same pair on their own controller, never `shipping.manage`.
  "GET /admin/orders/:id/shipments",
  "POST /admin/orders/:id/shipments",
  "POST /admin/orders/:id/shipments/:shipmentId/reconcile",
  "POST /admin/orders/:id/shipments/:shipmentId/cancel",
  "POST /admin/orders/:id/shipments/:shipmentId/refresh",
  "GET /admin/orders/:id/shipments/:shipmentId/label",
  // Payments of an order (ADR 0032 decision 18): the same pair; the refund is `payments.refund` (PAYMENTS_ROUTES).
  "GET /admin/orders/:id/payments",
  "POST /admin/orders/:id/payments/:paymentId/resync",
];

/**
 * Online payments (ADR 0032 decisions 11 and 18): the attention list reads with `orders.read` (its controller's default
 * pair is `orders.read` / `payments.refund`); a refund (declared on the route) and the attention clear need `payments.refund`.
 */
const PAYMENTS_ROUTES = [
  "GET /admin/payments",
  "POST /admin/payments/:paymentId/attention/clear",
  "POST /admin/orders/:id/payments/:paymentId/refunds",
];

/** Shipping settings: declared once on the controllers with their own default pair (`shipping.manage` for reads and writes). */
const SHIPPING_ROUTES = [
  "GET /admin/shipping/methods",
  "POST /admin/shipping/methods",
  "GET /admin/shipping/methods/:id",
  "PATCH /admin/shipping/methods/:id",
  "DELETE /admin/shipping/methods/:id",
  "GET /admin/shipping/providers/:code/settings",
  "PUT /admin/shipping/providers/:code/settings",
  "POST /admin/shipping/providers/:code/check",
];

/** Mail delivery (ADR 0031 decision 15): declared once on the controllers with their own default pair (`email.manage` for reads and writes). */
const EMAIL_ROUTES = [
  "GET /admin/email/status",
  "POST /admin/email/test",
  "GET /admin/email/messages",
  "GET /admin/email/messages/:id",
  "POST /admin/email/messages/:id/resend",
  "POST /admin/email/messages/:id/cancel",
  "GET /admin/email/templates",
  "GET /admin/email/templates/:key/preview",
];

/** The one route under /admin/products that needs an order permission: it links the orders that hold a variant's units. */
const RESERVATIONS_ROUTE = "GET /admin/products/:id/variants/:variantId/inventory/reservations";

function expectedPermission(method: string, pattern: string): AdminPermission {
  if (`${method} ${pattern}` === RESERVATIONS_ROUTE) return "orders.read";
  if (USERS_ROUTES.includes(`${method} ${pattern}`)) return "users.manage";
  if (AUDIT_ROUTES.includes(`${method} ${pattern}`)) return "users.manage";
  if (PAYMENTS_ROUTES.includes(`${method} ${pattern}`)) {
    return method === "GET" ? "orders.read" : "payments.refund";
  }
  if (ORDERS_ROUTES.includes(`${method} ${pattern}`)) {
    return method === "GET" || method === "HEAD" ? "orders.read" : "orders.write";
  }
  if (SHIPPING_ROUTES.includes(`${method} ${pattern}`)) return "shipping.manage";
  if (EMAIL_ROUTES.includes(`${method} ${pattern}`)) return "email.manage";
  if (CUSTOMERS_ROUTES.includes(`${method} ${pattern}`)) {
    return method === "GET" || method === "HEAD" ? "customers.read" : "customers.write";
  }
  if (PUBLISH_ROUTES.has(`${method} ${pattern}`)) return "catalog.publish";
  return method === "GET" || method === "HEAD" ? "catalog.read" : "catalog.write";
}

interface DeclaredRoute {
  method: string;
  pattern: string;
  controller: string;
  access: ReturnType<typeof resolveRouteAccess>;
}

/** Walks the Nest controllers of the running app (metadata, not HTTP) and resolves every /admin route. */
function declaredAdminRoutes(app: NestExpressApplication): DeclaredRoute[] {
  const reflector = new Reflector();
  const routes: DeclaredRoute[] = [];
  for (const nestModule of app.get(ModulesContainer).values()) {
    for (const wrapper of nestModule.controllers.values()) {
      const controller = wrapper.metatype as (new () => object) | null;
      if (controller === null) continue;
      const prefix = String(reflector.get<string | string[]>("path", controller) ?? "");
      if (!/^\/?admin(\/|$)/i.test(prefix)) continue;
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = (controller.prototype as Record<string, unknown>)[name];
        if (typeof handler !== "function") continue;
        const requestMethod = reflector.get<number | undefined>("method", handler);
        if (requestMethod === undefined) continue;
        const method = RequestMethod[requestMethod] ?? "UNKNOWN";
        const routePath = String(reflector.get<string | string[]>("path", handler) ?? "");
        const pattern = `/${[prefix, routePath].join("/").split("/").filter(Boolean).join("/")}`;
        routes.push({
          method,
          pattern,
          controller: controller.name,
          access: resolveRouteAccess(reflector, handler, controller, method),
        });
      }
    }
  }
  return routes;
}

describe("admin route permissions", () => {
  let owner: RunningApp;
  let manager: RunningApp;
  let viewer: RunningApp;
  /** An app with probe routes; who is signed in is chosen per call (`undefined` = anonymous). */
  let probe: RunningApp;
  let probeRole: AdminRole | undefined;

  beforeAll(async () => {
    await ensureMigrated();
    owner = await startApp();
    probe = await startApp({
      extraFeatures: probeFeature,
      adminAuthenticator: {
        authenticate: () => (probeRole === undefined ? undefined : testPrincipal(probeRole)),
      },
    });
    manager = await startApp({ adminPrincipal: { role: "manager" } });
    viewer = await startApp({ adminPrincipal: { role: "viewer" } });
  });

  afterAll(async () => {
    for (const started of [owner, manager, viewer, probe]) {
      await started.app.close();
    }
  });

  describe("resolution over the real controllers", () => {
    it("finds exactly the routes the Express router serves under /admin", () => {
      const walked = declaredAdminRoutes(manager.app)
        .map(({ method, pattern }) => `${method} ${pattern}`)
        .sort();
      const served = adminRoutes(manager.app)
        .map(({ method, pattern }) => `${method} ${pattern}`)
        .sort();
      expect(walked.length).toBeGreaterThan(50);
      expect(walked).toEqual(served);
    });

    it("gives EVERY admin route a permission (explicit or default) or marks it public: none is undeclared", () => {
      const undeclared = declaredAdminRoutes(manager.app).filter(
        ({ access }) => access.kind === "undeclared",
      );
      expect(undeclared.map(({ method, pattern }) => `${method} ${pattern}`)).toEqual([]);
      for (const route of declaredAdminRoutes(manager.app)) {
        expect(
          ["permission", "public", "authenticated"],
          `${route.method} ${route.pattern}`,
        ).toContain(route.access.kind);
      }
    });

    it("has exactly one public admin route (login) and exactly four any-signed-in-admin routes", () => {
      const named = (kind: "public" | "authenticated") =>
        declaredAdminRoutes(manager.app)
          .filter(({ access }) => access.kind === kind)
          .map(({ method, pattern }) => `${method} ${pattern}`)
          .sort();
      expect(named("public")).toEqual([...PUBLIC_ROUTES].sort());
      expect(named("authenticated")).toEqual([...AUTHENTICATED_ROUTES].sort());
    });

    it("gives the users routes users.manage, once, on the controller", () => {
      const users = declaredAdminRoutes(manager.app).filter(({ pattern }) =>
        pattern.startsWith("/admin/users"),
      );
      expect(users.map(({ method, pattern }) => `${method} ${pattern}`).sort()).toEqual(
        [...USERS_ROUTES].sort(),
      );
      for (const { method, pattern, access } of users) {
        expect(access, `${method} ${pattern}`).toEqual({
          kind: "permission",
          permission: "users.manage",
          source: "controller",
        });
      }
    });

    it("gives the customers routes the customer pair by the controller default: read for GET, write for the rest", () => {
      const customers = declaredAdminRoutes(manager.app).filter(({ pattern }) =>
        pattern.startsWith("/admin/customers"),
      );
      expect(customers.map(({ method, pattern }) => `${method} ${pattern}`).sort()).toEqual(
        [...CUSTOMERS_ROUTES].sort(),
      );
      for (const { method, pattern, access } of customers) {
        expect(access, `${method} ${pattern}`).toEqual({
          kind: "permission",
          permission: method === "GET" ? "customers.read" : "customers.write",
          source: "default",
        });
      }
    });

    it("gives the orders routes the order pair by the controller default: read for GET, write for the rest", () => {
      const orders = declaredAdminRoutes(manager.app).filter(
        ({ method, pattern }) =>
          pattern.startsWith("/admin/orders") && !PAYMENTS_ROUTES.includes(`${method} ${pattern}`),
      );
      expect(orders.map(({ method, pattern }) => `${method} ${pattern}`).sort()).toEqual(
        [...ORDERS_ROUTES].sort(),
      );
      for (const { method, pattern, access } of orders) {
        expect(access, `${method} ${pattern}`).toEqual({
          kind: "permission",
          permission: method === "GET" ? "orders.read" : "orders.write",
          source: "default",
        });
      }
    });

    it("gives the payment routes orders.read to list and payments.refund to refund or clear attention", () => {
      const payments = declaredAdminRoutes(manager.app).filter(({ method, pattern }) =>
        PAYMENTS_ROUTES.includes(`${method} ${pattern}`),
      );
      expect(payments.map(({ method, pattern }) => `${method} ${pattern}`).sort()).toEqual(
        [...PAYMENTS_ROUTES].sort(),
      );
      for (const { method, pattern, access } of payments) {
        expect(access, `${method} ${pattern}`).toEqual({
          kind: "permission",
          permission: method === "GET" ? "orders.read" : "payments.refund",
          source: pattern.endsWith("/refunds") ? "route" : "default",
        });
      }
    });

    it("gives the shipping routes shipping.manage by the controller default, reads included", () => {
      const shipping = declaredAdminRoutes(manager.app).filter(({ pattern }) =>
        pattern.startsWith("/admin/shipping"),
      );
      expect(shipping.map(({ method, pattern }) => `${method} ${pattern}`).sort()).toEqual(
        [...SHIPPING_ROUTES].sort(),
      );
      for (const { method, pattern, access } of shipping) {
        expect(access, `${method} ${pattern}`).toEqual({
          kind: "permission",
          permission: "shipping.manage",
          source: "default",
        });
      }
    });

    it("gives the email routes email.manage by the controller default, reads included", () => {
      const email = declaredAdminRoutes(manager.app).filter(({ pattern }) =>
        pattern.startsWith("/admin/email"),
      );
      expect(email.map(({ method, pattern }) => `${method} ${pattern}`).sort()).toEqual(
        [...EMAIL_ROUTES].sort(),
      );
      for (const { method, pattern, access } of email) {
        expect(access, `${method} ${pattern}`).toEqual({
          kind: "permission",
          permission: "email.manage",
          source: "default",
        });
      }
    });

    it("keeps every other controller on the catalog pair: no catalog route changed its permission", () => {
      const others = declaredAdminRoutes(manager.app).filter(
        ({ method, pattern, access }) =>
          access.kind === "permission" &&
          access.source === "default" &&
          !CUSTOMERS_ROUTES.includes(`${method} ${pattern}`) &&
          !SHIPPING_ROUTES.includes(`${method} ${pattern}`) &&
          !EMAIL_ROUTES.includes(`${method} ${pattern}`) &&
          !PAYMENTS_ROUTES.includes(`${method} ${pattern}`) &&
          !ORDERS_ROUTES.includes(`${method} ${pattern}`),
      );
      expect(others.length).toBeGreaterThan(30);
      for (const { method, pattern, access } of others) {
        expect(access, `${method} ${pattern}`).toMatchObject({
          permission: method === "GET" || method === "HEAD" ? "catalog.read" : "catalog.write",
        });
      }
    });

    it("gives the media upload catalog.write by the catalog default pair of its controller (ADR 0028)", () => {
      const media = declaredAdminRoutes(manager.app).filter(({ pattern }) =>
        pattern.startsWith("/admin/media"),
      );
      expect(media.map(({ method, pattern }) => `${method} ${pattern}`)).toEqual([
        "POST /admin/media/uploads",
      ]);
      expect(media[0]?.access).toEqual({
        kind: "permission",
        permission: "catalog.write",
        source: "default",
      });
    });

    it("resolves each route to the documented permission: users.manage for users, the customer pair for customers, publish for the four lifecycle routes, read for GET, write otherwise", () => {
      const routes = declaredAdminRoutes(manager.app);
      for (const { method, pattern, access } of routes) {
        // Public and any-signed-in routes (the sign-in flow) have no permission to resolve.
        if (access.kind === "public" || access.kind === "authenticated") continue;
        expect(access, `${method} ${pattern}`).toMatchObject({
          kind: "permission",
          permission: expectedPermission(method, pattern),
        });
      }
      const lifecycle = routes.filter(({ method, pattern }) =>
        PUBLISH_ROUTES.has(`${method} ${pattern}`),
      );
      expect(lifecycle).toHaveLength(4);
      for (const { access } of lifecycle) {
        expect(access).toMatchObject({ source: "route" });
      }
    });

    it("every permission the routes need exists, the owner holds all of them and users.manage is the owner's alone", () => {
      const needed = new Set(
        declaredAdminRoutes(manager.app).flatMap(({ access }) =>
          access.kind === "permission" ? [access.permission] : [],
        ),
      );
      expect([...needed].sort()).toEqual([
        "catalog.publish",
        "catalog.read",
        "catalog.write",
        "customers.read",
        "customers.write",
        "email.manage",
        "orders.read",
        "orders.write",
        "payments.refund",
        "shipping.manage",
        "users.manage",
      ]);
      for (const permission of needed) {
        expect(permissionsOf("owner")).toContain(permission);
      }
      expect(permissionsOf("manager")).not.toContain("users.manage");
      expect(permissionsOf("viewer")).not.toContain("users.manage");
      // Shipping settings are shop configuration: owner and manager, not the viewer.
      expect(permissionsOf("manager")).toContain("shipping.manage");
      expect(permissionsOf("viewer")).not.toContain("shipping.manage");
      // Mail delivery shows recipient addresses: owner and manager, not the viewer.
      expect(permissionsOf("manager")).toContain("email.manage");
      expect(permissionsOf("viewer")).not.toContain("email.manage");
      // Refunds move money: owner and manager, not the viewer.
      expect(permissionsOf("manager")).toContain("payments.refund");
      expect(permissionsOf("viewer")).not.toContain("payments.refund");
      // The customer permissions hold personal data: manager and owner have them, the viewer has neither.
      for (const permission of [
        "customers.read",
        "customers.write",
        "orders.read",
        "orders.write",
      ] as const) {
        expect(permissionsOf("manager")).toContain(permission);
        expect(permissionsOf("viewer")).not.toContain(permission);
      }
    });
  });

  describe("a viewer over HTTP, on every registered route", () => {
    it("holds exactly the permissions the walk says: forbidden where it lacks one, never 401 or 403 where it does not need one", async () => {
      const declared = new Map(
        declaredAdminRoutes(viewer.app).map((route) => [`${route.method} ${route.pattern}`, route]),
      );
      let forbiddenCount = 0;
      let allowedCount = 0;
      for (const { method, pattern, path } of adminRoutes(viewer.app)) {
        const access = declared.get(`${method} ${pattern}`)?.access;
        const result = await http<ProblemBody>(
          viewer.baseUrl,
          method as "GET",
          path,
          method === "GET" ? {} : { body: {} },
        );
        const lacksPermission =
          access?.kind === "permission" && !permissionsOf("viewer").includes(access.permission);
        if (lacksPermission) {
          forbiddenCount += 1;
          expect(result.status, `${method} ${path}`).toBe(403);
          expect(result.body, `${method} ${path}`).toMatchObject({ code: "forbidden" });
        } else {
          allowedCount += 1;
          expect(result.status, `${method} ${path}`).not.toBe(403);
          // The test principal is not a row in admin_user, so only /me and change-password may say 401 here.
          if (access?.kind !== "authenticated") {
            expect(result.status, `${method} ${path}`).not.toBe(401);
          }
        }
      }
      expect(allowedCount).toBeGreaterThan(10);
      expect(forbiddenCount).toBeGreaterThan(30);
    });

    it("is forbidden on every customers route", async () => {
      for (const route of CUSTOMERS_ROUTES) {
        const [method, pattern] = route.split(" ") as ["GET", string];
        const result = await http<ProblemBody>(
          viewer.baseUrl,
          method,
          pattern.replace(":id", SOME_ID),
          method === "GET" ? {} : { body: {} },
        );
        expect(result.status, route).toBe(403);
      }
    });

    it("is forbidden on every orders route (they hold personal data)", async () => {
      for (const route of ORDERS_ROUTES) {
        const [method, pattern] = route.split(" ") as ["GET", string];
        const result = await http<ProblemBody>(
          viewer.baseUrl,
          method,
          pattern.replace(":id", SOME_ID),
          method === "GET" ? {} : { body: {} },
        );
        expect(result.status, route).toBe(403);
      }
    });

    it("is forbidden on every shipping route, reads included", async () => {
      for (const route of SHIPPING_ROUTES) {
        const [method, pattern] = route.split(" ") as ["GET", string];
        const result = await http<ProblemBody>(
          viewer.baseUrl,
          method,
          pattern.replace(":id", SOME_ID).replace(":code", "fake"),
          method === "GET" || method === "DELETE" ? {} : { body: {} },
        );
        expect(result.status, route).toBe(403);
        expect(result.body, route).toMatchObject({ code: "forbidden" });
        expect(result.body.detail, route).toContain("shipping.manage");
      }
    });

    it("is forbidden on every email route, reads included", async () => {
      for (const route of EMAIL_ROUTES) {
        const [method, pattern] = route.split(" ") as ["GET", string];
        const result = await http<ProblemBody>(
          viewer.baseUrl,
          method,
          pattern.replace(":id", SOME_ID).replace(":key", "admin.test"),
          method === "GET" ? {} : { body: {} },
        );
        expect(result.status, route).toBe(403);
        expect(result.body, route).toMatchObject({ code: "forbidden" });
        expect(result.body.detail, route).toContain("email.manage");
      }
    });

    it("is forbidden on every users route", async () => {
      for (const route of USERS_ROUTES) {
        const [method, pattern] = route.split(" ") as ["GET", string];
        const result = await http<ProblemBody>(
          viewer.baseUrl,
          method,
          pattern.replace(":id", SOME_ID),
          method === "GET" ? {} : { body: {} },
        );
        expect(result.status, route).toBe(403);
      }
    });
  });

  describe("role matrix over HTTP (one representative route per permission)", () => {
    const apps = (): Record<AdminRole, RunningApp> => ({ owner, manager, viewer });

    interface Case {
      name: string;
      permission: AdminPermission;
      call: (baseUrl: string) => Promise<{ status: number; body: unknown }>;
      /** Status a role that holds the permission gets (proves the handler ran, not only the guard). */
      allowedStatus: number | undefined;
    }

    const cases: Case[] = [
      {
        name: "GET /admin/brands",
        permission: "catalog.read",
        call: (url) => http(url, "GET", "/admin/brands"),
        allowedStatus: 200,
      },
      {
        name: "POST /admin/brands",
        permission: "catalog.write",
        call: (url) => http(url, "POST", "/admin/brands", { body: {} }),
        allowedStatus: 400,
      },
      {
        name: "PATCH /admin/products/:id",
        permission: "catalog.write",
        call: (url) =>
          http(url, "PATCH", `/admin/products/${SOME_ID}`, { body: { barcode: null } }),
        allowedStatus: undefined,
      },
      {
        name: "DELETE /admin/products/:id",
        permission: "catalog.write",
        call: (url) => http(url, "DELETE", `/admin/products/${SOME_ID}`),
        allowedStatus: 404,
      },
      {
        name: "GET /admin/users",
        permission: "users.manage",
        call: (url) => http(url, "GET", "/admin/users"),
        allowedStatus: 200,
      },
      {
        name: "PATCH /admin/users/:id",
        permission: "users.manage",
        call: (url) => http(url, "PATCH", `/admin/users/${SOME_ID}`, { body: { role: "viewer" } }),
        allowedStatus: 404,
      },
      {
        name: "POST /admin/users/:id/reset-password",
        permission: "users.manage",
        call: (url) =>
          http(url, "POST", `/admin/users/${SOME_ID}/reset-password`, {
            body: { newPassword: "a long enough passphrase" },
          }),
        allowedStatus: 404,
      },
      {
        name: "GET /admin/customers",
        permission: "customers.read",
        call: (url) => http(url, "GET", "/admin/customers"),
        allowedStatus: 200,
      },
      {
        name: "PATCH /admin/customers/:id",
        permission: "customers.write",
        call: (url) =>
          http(url, "PATCH", `/admin/customers/${SOME_ID}`, { body: { isActive: false } }),
        allowedStatus: 404,
      },
      {
        name: "POST /admin/customers/:id/unlock",
        permission: "customers.write",
        call: (url) => http(url, "POST", `/admin/customers/${SOME_ID}/unlock`),
        allowedStatus: 404,
      },
      {
        name: "GET /admin/orders",
        permission: "orders.read",
        call: (url) => http(url, "GET", "/admin/orders"),
        allowedStatus: 200,
      },
      {
        name: "GET /admin/orders/:id",
        permission: "orders.read",
        call: (url) => http(url, "GET", `/admin/orders/${SOME_ID}`),
        allowedStatus: 404,
      },
      {
        name: "POST /admin/orders/:id/cancel",
        permission: "orders.write",
        call: (url) =>
          http(url, "POST", `/admin/orders/${SOME_ID}/cancel`, { body: { reason: "test" } }),
        allowedStatus: 404,
      },
      {
        name: "POST /admin/orders/:id/mark-paid",
        permission: "orders.write",
        call: (url) =>
          http(url, "POST", `/admin/orders/${SOME_ID}/mark-paid`, {
            body: { reference: "REF", amount: { amount: 1, currency: "UAH" } },
          }),
        allowedStatus: 404,
      },
      {
        name: "POST /admin/orders/:id/mark-fulfilled",
        permission: "orders.write",
        call: (url) => http(url, "POST", `/admin/orders/${SOME_ID}/mark-fulfilled`),
        allowedStatus: 404,
      },
      {
        name: "GET /admin/shipping/methods",
        permission: "shipping.manage",
        call: (url) => http(url, "GET", "/admin/shipping/methods"),
        allowedStatus: 200,
      },
      {
        name: "POST /admin/shipping/methods",
        permission: "shipping.manage",
        call: (url) => http(url, "POST", "/admin/shipping/methods", { body: {} }),
        allowedStatus: 400,
      },
      {
        name: "GET /admin/shipping/methods/:id",
        permission: "shipping.manage",
        call: (url) => http(url, "GET", `/admin/shipping/methods/${SOME_ID}`),
        allowedStatus: 404,
      },
      {
        name: "PATCH /admin/shipping/methods/:id",
        permission: "shipping.manage",
        call: (url) =>
          http(url, "PATCH", `/admin/shipping/methods/${SOME_ID}`, { body: { isActive: false } }),
        allowedStatus: 404,
      },
      {
        name: "DELETE /admin/shipping/methods/:id",
        permission: "shipping.manage",
        call: (url) => http(url, "DELETE", `/admin/shipping/methods/${SOME_ID}`),
        allowedStatus: 404,
      },
      {
        name: "GET /admin/shipping/providers/:code/settings",
        permission: "shipping.manage",
        call: (url) => http(url, "GET", "/admin/shipping/providers/nowhere/settings"),
        allowedStatus: 404,
      },
      {
        name: "PUT /admin/shipping/providers/:code/settings",
        permission: "shipping.manage",
        call: (url) =>
          http(url, "PUT", "/admin/shipping/providers/nowhere/settings", {
            body: { settings: {} },
          }),
        allowedStatus: 404,
      },
      {
        name: "POST /admin/shipping/providers/:code/check",
        permission: "shipping.manage",
        call: (url) => http(url, "POST", "/admin/shipping/providers/nowhere/check"),
        allowedStatus: 404,
      },
      {
        name: "GET /admin/email/status",
        permission: "email.manage",
        call: (url) => http(url, "GET", "/admin/email/status"),
        allowedStatus: 200,
      },
      {
        name: "POST /admin/email/test (no provider in this app)",
        permission: "email.manage",
        call: (url) => http(url, "POST", "/admin/email/test", { body: {} }),
        allowedStatus: 409,
      },
      {
        name: "GET /admin/email/messages",
        permission: "email.manage",
        call: (url) => http(url, "GET", "/admin/email/messages"),
        allowedStatus: 200,
      },
      {
        name: "GET /admin/email/messages/:id",
        permission: "email.manage",
        call: (url) => http(url, "GET", `/admin/email/messages/${SOME_ID}`),
        allowedStatus: 404,
      },
      {
        name: "POST /admin/email/messages/:id/resend",
        permission: "email.manage",
        call: (url) => http(url, "POST", `/admin/email/messages/${SOME_ID}/resend`),
        allowedStatus: 404,
      },
      {
        name: "POST /admin/email/messages/:id/cancel",
        permission: "email.manage",
        call: (url) => http(url, "POST", `/admin/email/messages/${SOME_ID}/cancel`),
        allowedStatus: 404,
      },
      {
        name: "GET /admin/email/templates",
        permission: "email.manage",
        call: (url) => http(url, "GET", "/admin/email/templates"),
        allowedStatus: 200,
      },
      {
        name: "GET /admin/email/templates/:key/preview",
        permission: "email.manage",
        call: (url) => http(url, "GET", "/admin/email/templates/admin.test/preview"),
        allowedStatus: 200,
      },
      {
        name: "POST /admin/products/:id/publish (lifecycle override)",
        permission: "catalog.publish",
        call: (url) => http(url, "POST", `/admin/products/${SOME_ID}/publish`),
        allowedStatus: 404,
      },
      {
        name: "POST /admin/products/:id/archive (lifecycle override)",
        permission: "catalog.publish",
        call: (url) => http(url, "POST", `/admin/products/${SOME_ID}/archive`),
        allowedStatus: 404,
      },
    ];

    it.each(cases)("$name needs $permission", async ({ permission, call, allowedStatus, name }) => {
      for (const [role, running] of Object.entries(apps())) {
        const result = await call(running.baseUrl);
        const holds = permissionsOf(role).includes(permission);
        if (holds) {
          expect(result.status, `${role}: ${name}`).not.toBe(403);
          expect(result.status, `${role}: ${name}`).not.toBe(401);
          if (allowedStatus !== undefined) {
            expect(result.status, `${role}: ${name}`).toBe(allowedStatus);
          }
        } else {
          expect(result.status, `${role}: ${name}`).toBe(403);
          expect(result.body, `${role}: ${name}`).toMatchObject({ code: "forbidden" });
        }
      }
    });

    it("@AuthenticatedAdminRoute: logout is open to every signed-in role, even to a viewer on a POST", async () => {
      for (const [role, running] of Object.entries(apps())) {
        const result = await http(running.baseUrl, "POST", "/admin/auth/logout");
        expect(result.status, role).toBe(204);
      }
    });

    it("manager may publish, viewer may not, PATCH is forbidden for viewer (the lifecycle override is not the default)", async () => {
      const publishAs = (running: RunningApp) =>
        http<ProblemBody>(running.baseUrl, "POST", `/admin/products/${SOME_ID}/publish`);
      expect((await publishAs(viewer)).status).toBe(403);
      expect((await publishAs(manager)).status).toBe(404);
      expect((await publishAs(owner)).status).toBe(404);
      const patch = await http<ProblemBody>(viewer.baseUrl, "PATCH", `/admin/products/${SOME_ID}`, {
        body: {},
      });
      expect(patch.status).toBe(403);
    });

    it("users.manage: only the owner passes a route that declares it", async () => {
      const ask = async (role: AdminRole): Promise<number> => {
        probeRole = role;
        return (await http<ProblemBody>(probe.baseUrl, "GET", "/admin/probe-users")).status;
      };
      expect(await ask("owner")).toBe(200);
      expect(await ask("manager")).toBe(403);
      expect(await ask("viewer")).toBe(403);
      probeRole = undefined;
      expect((await http(probe.baseUrl, "GET", "/admin/probe-users")).status).toBe(401);
    });

    it("a @PublicAdminRoute needs no sign-in, but still the CSRF header", async () => {
      probeRole = undefined;
      const open = await http<{ ok: true }>(probe.baseUrl, "POST", "/admin/probe-users/open");
      expect(open.status).toBe(201);
      const withoutHeader = await http<ProblemBody>(
        probe.baseUrl,
        "POST",
        "/admin/probe-users/open",
        {
          csrf: false,
        },
      );
      expect(withoutHeader.status).toBe(403);
    });

    it("a 403 tells which permission is missing and leaks nothing else", async () => {
      const result = await http<ProblemBody>(
        viewer.baseUrl,
        "POST",
        `/admin/products/${SOME_ID}/publish`,
      );
      expect(result.status).toBe(403);
      expect(result.headers.get("content-type")).toContain("application/problem+json");
      expect(result.body).toMatchObject({
        type: "about:blank",
        status: 403,
        code: "forbidden",
        title: "Forbidden",
      });
      expect(result.body.detail).toContain("catalog.publish");
    });
  });
});
