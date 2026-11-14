import "reflect-metadata";
import { Get, HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import * as kit from "./index.js";
import * as internal from "./internal.js";
import { AdminController, ProblemException, RequirePermission } from "./index.js";
import {
  AUTHENTICATED_KEY,
  AuthenticatedAdminRoute,
  DEFAULTS_KEY,
  PERMISSION_KEY,
  PUBLIC_KEY,
  PublicAdminRoute,
} from "./internal.js";

// Nest stores route paths and controller prefixes under these keys (`@nestjs/common` constants).
const NEST_PATH_KEY = "path";

describe("admin route metadata keys (ADR 0049: moved, never changed)", () => {
  it("keeps the four key strings the global admin guard reads", () => {
    expect([PERMISSION_KEY, PUBLIC_KEY, AUTHENTICATED_KEY, DEFAULTS_KEY]).toEqual([
      "fluxkit:admin:permission",
      "fluxkit:admin:public",
      "fluxkit:admin:authenticated",
      "fluxkit:admin:default-permission-by-method",
    ]);
  });

  it("writes them through the decorators", () => {
    @AdminController("probe", { read: "customers.read", write: "customers.write" })
    class ProbeController {
      @Get("a")
      @RequirePermission("catalog.publish")
      a(): void {}

      @Get("b")
      @PublicAdminRoute()
      b(): void {}

      @Get("c")
      @AuthenticatedAdminRoute()
      c(): void {}
    }
    const prototype = ProbeController.prototype;
    expect(Reflect.getMetadata(PERMISSION_KEY, prototype.a)).toBe("catalog.publish");
    expect(Reflect.getMetadata(PUBLIC_KEY, prototype.b)).toBe(true);
    expect(Reflect.getMetadata(AUTHENTICATED_KEY, prototype.c)).toBe(true);
    expect(Reflect.getMetadata(DEFAULTS_KEY, ProbeController)).toEqual({
      read: "customers.read",
      write: "customers.write",
    });
    expect(Reflect.getMetadata(NEST_PATH_KEY, ProbeController)).toBe("admin/probe");
  });

  it("defaults a controller to the catalog pair", () => {
    @AdminController("plain")
    class PlainController {}
    expect(Reflect.getMetadata(DEFAULTS_KEY, PlainController)).toEqual({
      read: "catalog.read",
      write: "catalog.write",
    });
  });

  it("refuses a default pair naming a permission that does not exist", () => {
    expect(() =>
      AdminController("typo", {
        read: "catalog.reed" as "catalog.read",
        write: "catalog.write",
      }),
    ).toThrow(/must be existing permissions/);
  });
});

describe("ProblemException (one class for the API and every feature)", () => {
  it("is an HttpException carrying its code, status and field errors", () => {
    const problem = new ProblemException({
      code: "validation_failed",
      detail: "Bad.",
      errors: [{ path: "title.uk", code: "too_long" }],
    });
    expect(problem).toBeInstanceOf(HttpException);
    expect(problem.getStatus()).toBe(400);
    expect(problem.code).toBe("validation_failed");
    expect(problem.errors).toEqual([{ path: "title.uk", code: "too_long" }]);
  });
});

describe("export sets", () => {
  it("the public entry exports only the minimum set of ADR 0049", () => {
    expect(Object.keys(kit).sort()).toEqual([
      "AdminController",
      "FEATURE_DATABASE",
      "LOCALE_CONFIG",
      "MEDIA_PORT",
      "ProblemException",
      "RequirePermission",
    ]);
  });

  it("the internal entry holds the API-only values", () => {
    expect(Object.keys(internal).sort()).toEqual([
      "AUTHENTICATED_KEY",
      "AuthenticatedAdminRoute",
      "CATALOG_DEFAULT_PERMISSIONS",
      "DEFAULTS_KEY",
      "PERMISSION_KEY",
      "PROBLEM_CODES",
      "PROBLEM_STATUS",
      "PROBLEM_TITLE",
      "PUBLIC_KEY",
      "PublicAdminRoute",
      "UseDefaultPermissionByMethod",
    ]);
  });
});
