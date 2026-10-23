import { readFile } from "node:fs/promises";
import { Controller, Get, Module, Post } from "@nestjs/common";
import { PERMISSIONS, permissionsOf, type AdminPermission } from "@fluxkit/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../app.factory.js";
import type { ProblemBody } from "../common/problem.filter.js";
import { startApp, type RunningApp } from "../test/app.js";
import { testPrincipal } from "../test/allow-all-admin-authenticator.js";
import { http, type HttpOptions } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import { SOME_ID, sweepRequest } from "../test/routes.js";
import type { AdminPrincipal } from "./admin-authenticator.js";
import { RequirePermission } from "./route-access.js";

interface Operation {
  parameters?: {
    name: string;
    in: string;
    required?: boolean;
    schema?: unknown;
    format?: string;
  }[];
  responses: Record<string, { description?: string; content?: Record<string, unknown> }>;
  "x-fluxkit-permission"?: unknown;
}
type Paths = Record<string, Record<string, Operation>>;

const WRITE_METHODS = ["post", "put", "patch", "delete"] as const;
const READ_METHODS = ["get", "head", "options"] as const;
const MARKERS = ["authenticated", "public", "denied"] as const;

async function committedPaths(): Promise<Paths> {
  const document = JSON.parse(
    await readFile(new URL("../../../../docs/api/openapi.json", import.meta.url), "utf8"),
  ) as { paths: Paths };
  return document.paths;
}

/** Every `/admin` operation of a document as `{label, method, path, operation}`. */
function adminOperations(paths: Paths) {
  return Object.entries(paths).flatMap(([path, methods]) =>
    path.startsWith("/admin/")
      ? Object.entries(methods).map(([method, operation]) => ({
          label: `${method.toUpperCase()} ${path}`,
          method,
          path,
          operation,
        }))
      : [],
  );
}

describe("the admin part of docs/api/openapi.json", () => {
  describe("parentId of the categories list", () => {
    it("is documented as an optional uuid query parameter that lists direct children", async () => {
      const operation = (await committedPaths())["/admin/categories"]?.["get"];
      const parameter = operation?.parameters?.find((entry) => entry.name === "parentId");
      expect(parameter).toMatchObject({
        in: "query",
        required: false,
        schema: { type: "string", format: "uuid" },
      });
      expect(String((parameter as { description?: string }).description)).toMatch(
        /direct children/i,
      );
    });
  });

  describe("the X-Fluxkit-CSRF header", () => {
    it("is a required header of exactly `1` on every state-changing admin operation, login included", async () => {
      const writes = adminOperations(await committedPaths()).filter(({ method }) =>
        (WRITE_METHODS as readonly string[]).includes(method),
      );
      // Guards the guard: catalog, pricing, inventory, orders, customers and auth writes are all there.
      expect(writes.length).toBeGreaterThanOrEqual(40);
      expect(writes.map(({ label }) => label)).toContain("POST /admin/auth/login");
      for (const { label, operation } of writes) {
        const headers = (operation.parameters ?? []).filter(
          (parameter) => parameter.name === "X-Fluxkit-CSRF",
        );
        expect(headers, `${label}: header`).toEqual([
          expect.objectContaining({
            in: "header",
            required: true,
            schema: { enum: ["1"], type: "string" },
          }),
        ]);
        expect(
          operation.responses["403"]?.content?.["application/problem+json"],
          `${label}: 403`,
        ).toEqual({ schema: { $ref: "#/components/schemas/ProblemDetailsDoc" } });
        expect(operation.responses["403"]?.description, `${label}: 403 text`).toContain("CSRF");
      }
    });

    it("is not documented on reads", async () => {
      const reads = adminOperations(await committedPaths()).filter(({ method }) =>
        (READ_METHODS as readonly string[]).includes(method),
      );
      expect(reads.length).toBeGreaterThanOrEqual(25);
      for (const { label, operation } of reads) {
        expect(
          (operation.parameters ?? []).some((parameter) => parameter.name === "X-Fluxkit-CSRF"),
          label,
        ).toBe(false);
      }
    });
  });

  describe("x-fluxkit-permission", () => {
    let paths: Paths;
    /** Who the app signs in as, per call: `undefined` is anonymous. */
    let signedIn: AdminPrincipal | undefined;
    let running: RunningApp;

    const probeFeature = (() => {
      @Controller("admin/probe-docs")
      class ProbeController {
        @Get()
        @RequirePermission("users.manage")
        list(): { ok: true } {
          return { ok: true };
        }

        @Post()
        plain(): { ok: true } {
          return { ok: true };
        }
      }
      @Module({ controllers: [ProbeController] })
      class ProbeModule {}
      return [{ name: "probe-docs", module: ProbeModule }];
    })();

    beforeAll(async () => {
      await ensureMigrated();
      paths = await committedPaths();
      running = await startApp({
        extraFeatures: probeFeature,
        adminAuthenticator: { authenticate: () => signedIn },
      });
    });

    afterAll(async () => {
      await running.app.close();
    });

    it("is on EVERY admin operation, as a permission name or one of the markers authenticated, public, denied", () => {
      const operations = adminOperations(paths);
      expect(operations.length).toBeGreaterThan(80);
      for (const { label, operation } of operations) {
        const value = operation["x-fluxkit-permission"];
        expect(typeof value, label).toBe("string");
        expect([...PERMISSIONS, ...MARKERS] as string[], `${label}: ${String(value)}`).toContain(
          value,
        );
      }
      // Never on the store, which has no permissions.
      for (const [path, methods] of Object.entries(paths)) {
        if (path.startsWith("/admin/")) continue;
        for (const [method, operation] of Object.entries(methods)) {
          expect(operation["x-fluxkit-permission"], `${method} ${path}`).toBeUndefined();
        }
      }
    });

    it("says what the generator derives from the route declarations, not a table: a probe route shows its own permission", () => {
      const document = buildOpenApiDocument(running.app) as unknown as { paths: Paths };
      expect(document.paths["/admin/probe-docs"]?.["get"]?.["x-fluxkit-permission"]).toBe(
        "users.manage",
      );
      // A route that declares nothing is denied by the guard to everybody, and the document says so.
      expect(document.paths["/admin/probe-docs"]?.["post"]?.["x-fluxkit-permission"]).toBe(
        "denied",
      );
    });

    /** Fires one documented operation with the given identity; the body is empty on purpose (validation answers 400). */
    async function fire(method: string, path: string, who: AdminPrincipal | undefined) {
      signedIn = who;
      const concrete = path.replace(/\{[A-Za-z]+\}/g, SOME_ID);
      return http<ProblemBody>(
        running.baseUrl,
        method.toUpperCase() as "GET",
        concrete,
        method === "get" ? {} : (sweepRequest(method, concrete) as HttpOptions),
      );
    }

    const withPermissions = (permissions: AdminPermission[]): AdminPrincipal => ({
      ...testPrincipal("viewer"),
      permissions,
    });

    it("equals what the guard enforces: a principal holding ONLY that permission is let in, one holding every OTHER permission is forbidden", async () => {
      const operations = adminOperations(paths).filter(({ operation }) =>
        (PERMISSIONS as readonly string[]).includes(String(operation["x-fluxkit-permission"])),
      );
      expect(operations.length).toBeGreaterThan(70);
      for (const { label, method, path, operation } of operations) {
        const permission = operation["x-fluxkit-permission"] as AdminPermission;
        const only = await fire(method, path, withPermissions([permission]));
        expect(only.status, `${label} with only ${permission}`).not.toBe(403);
        expect(only.status, `${label} with only ${permission}`).not.toBe(401);
        const others = await fire(
          method,
          path,
          withPermissions(PERMISSIONS.filter((candidate) => candidate !== permission)),
        );
        expect(others.status, `${label} without ${permission}`).toBe(403);
        expect(others.body, label).toMatchObject({ code: "forbidden" });
        expect((await fire(method, path, undefined)).status, `${label} anonymous`).toBe(401);
      }
    });

    it("marks any-signed-in routes `authenticated` (no permission needed, anonymous is 401) and the one open route `public`", async () => {
      const authenticated = adminOperations(paths).filter(
        ({ operation }) => operation["x-fluxkit-permission"] === "authenticated",
      );
      expect(authenticated.map(({ label }) => label).sort()).toEqual(
        [
          "GET /admin/auth/me",
          "GET /admin/config",
          "POST /admin/auth/change-password",
          "POST /admin/auth/logout",
        ].sort(),
      );
      for (const { label, method, path } of authenticated) {
        const nothing = await fire(method, path, withPermissions([]));
        expect(nothing.status, `${label} with no permission`).not.toBe(403);
        // (`me` and `change-password` may answer 401 here: the test principal is no admin_user row. Not 403 is the point.)
        expect((await fire(method, path, undefined)).status, `${label} anonymous`).toBe(401);
      }
      const open = adminOperations(paths).filter(
        ({ operation }) => operation["x-fluxkit-permission"] === "public",
      );
      expect(open.map(({ label }) => label)).toEqual(["POST /admin/auth/login"]);
      const login = await fire("post", "/admin/auth/login", undefined);
      expect(login.status).toBe(400);
    });

    it("has no `denied` operation among the real routes (the marker exists for undeclared feature routes only)", () => {
      expect(
        adminOperations(paths)
          .filter(({ operation }) => operation["x-fluxkit-permission"] === "denied")
          .map(({ label }) => label),
      ).toEqual([]);
    });

    it("covers every permission name the code knows through some route, owner holds them all", () => {
      const used = new Set(
        adminOperations(paths).map(({ operation }) => operation["x-fluxkit-permission"]),
      );
      for (const permission of PERMISSIONS) {
        expect(used.has(permission), permission).toBe(true);
        expect(permissionsOf("owner")).toContain(permission);
      }
    });
  });
});
