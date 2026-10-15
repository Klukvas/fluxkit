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

function expectedPermission(method: string, pattern: string): AdminPermission {
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
        expect(["permission", "public"], `${route.method} ${route.pattern}`).toContain(
          route.access.kind,
        );
      }
    });

    it("has no public admin route yet (the login route of the next step is the only one that may appear)", () => {
      const publicRoutes = declaredAdminRoutes(manager.app)
        .filter(({ access }) => access.kind === "public")
        .map(({ method, pattern }) => `${method} ${pattern}`);
      expect(publicRoutes).toEqual([]);
    });

    it("resolves each route to the documented permission: publish for the four lifecycle routes, read for GET, write otherwise", () => {
      const routes = declaredAdminRoutes(manager.app);
      for (const { method, pattern, access } of routes) {
        // Public routes (login, from the next step) have no permission to resolve.
        if (access.kind === "public") continue;
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

    it("every permission the routes need is held by the manager role except none, and users.manage by no route yet", () => {
      const needed = new Set(
        declaredAdminRoutes(manager.app).flatMap(({ access }) =>
          access.kind === "permission" ? [access.permission] : [],
        ),
      );
      expect([...needed].sort()).toEqual(["catalog.publish", "catalog.read", "catalog.write"]);
      for (const permission of needed) {
        expect(permissionsOf("manager")).toContain(permission);
      }
    });
  });

  describe("a viewer over HTTP, on every registered route", () => {
    it("is forbidden on every non-GET route and allowed through on every GET route", async () => {
      const routes = adminRoutes(viewer.app);
      let writes = 0;
      let reads = 0;
      for (const { method, path } of routes) {
        const result = await http<ProblemBody>(
          viewer.baseUrl,
          method as "GET",
          path,
          method === "GET" ? {} : { body: {} },
        );
        if (method === "GET") {
          reads += 1;
          expect(result.status, `${method} ${path}`).not.toBe(403);
          expect(result.status, `${method} ${path}`).not.toBe(401);
        } else {
          writes += 1;
          expect(result.status, `${method} ${path}`).toBe(403);
          expect(result.body, `${method} ${path}`).toMatchObject({ code: "forbidden" });
        }
      }
      expect(reads).toBeGreaterThan(10);
      expect(writes).toBeGreaterThan(30);
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
