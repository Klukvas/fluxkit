import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { AdminController, RequirePermission } from "@fluxkit/api-kit";
import type { AdminPermission } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { AdminBlogController } from "./admin-blog.controller.js";
import { StoreBlogController } from "./store-blog.controller.js";

/*
 * Plan section 7 (owner's answer 7 (a)): catalog.read to read, catalog.write to create, edit and delete, catalog.publish to
 * publish and unpublish. The API's global guard enforces what a route declares (default deny; proven by the core specs
 * with the fixture feature). This spec reads what each blog route declares through the kit's own decorators: the metadata
 * keys are found by applying the decorators to probes, so the feature never imports the kit's internal entry.
 */

/** Nest's route metadata keys (`@nestjs/common` constants `PATH_METADATA` and `METHOD_METADATA`). */
const PATH_KEY = "path";
const METHOD_KEY = "method";

class PermissionProbe {
  @RequirePermission("catalog.publish")
  handler(): void {
    return undefined;
  }
}

@AdminController("probe")
class DefaultsProbe {}

/** The metadata keys a decorator wrote, without the TypeScript design types the compiler may add. */
function decoratorKeys(target: object): unknown[] {
  return Reflect.getMetadataKeys(target).filter(
    (key) => !(typeof key === "string" && key.startsWith("design:")),
  );
}

const PERMISSION_KEYS = decoratorKeys(PermissionProbe.prototype.handler);
const PERMISSION_KEY = PERMISSION_KEYS[0];
const DEFAULTS_KEY = Reflect.getMetadataKeys(DefaultsProbe).find((key) => {
  const value: unknown = Reflect.getMetadata(key, DefaultsProbe);
  return typeof value === "object" && value !== null && "read" in value && "write" in value;
});

interface Defaults {
  read: AdminPermission;
  write: AdminPermission;
}

/** `METHOD /path` -> the permission the API's guard requires: the route's own, else the controller's default by method. */
function declaredPermissions(
  controller: abstract new (...args: never[]) => object,
): Record<string, string> {
  const prefix: unknown = Reflect.getMetadata(PATH_KEY, controller);
  const defaults = Reflect.getMetadata(DEFAULTS_KEY, controller) as Defaults | undefined;
  const table: Record<string, string> = {};
  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    const handler: unknown = (controller.prototype as Record<string, unknown>)[name];
    if (name === "constructor" || typeof handler !== "function") continue;
    const method = Reflect.getMetadata(METHOD_KEY, handler) as RequestMethod | undefined;
    if (method === undefined) continue;
    const path: unknown = Reflect.getMetadata(PATH_KEY, handler);
    const route = `${RequestMethod[method]} /${String(prefix)}${path === "/" ? "" : `/${String(path)}`}`;
    const own = Reflect.getMetadata(PERMISSION_KEY, handler) as string | undefined;
    const byMethod = method === RequestMethod.GET ? defaults?.read : defaults?.write;
    table[route] = own ?? byMethod ?? "none";
  }
  return table;
}

describe("the permission each blog route declares (plan section 7)", () => {
  it("finds the kit's metadata keys through probes", () => {
    expect(PERMISSION_KEYS).toHaveLength(1);
    expect(Reflect.getMetadata(PERMISSION_KEY, PermissionProbe.prototype.handler)).toBe(
      "catalog.publish",
    );
    expect(DEFAULTS_KEY).toBeDefined();
    expect(Reflect.getMetadata(DEFAULTS_KEY, DefaultsProbe)).toEqual({
      read: "catalog.read",
      write: "catalog.write",
    });
  });

  it("splits the admin routes into read, write and publish like products", () => {
    expect(declaredPermissions(AdminBlogController)).toEqual({
      "GET /admin/blog/posts": "catalog.read",
      "GET /admin/blog/posts/:id": "catalog.read",
      "POST /admin/blog/posts": "catalog.write",
      "PATCH /admin/blog/posts/:id": "catalog.write",
      "POST /admin/blog/posts/:id/publish": "catalog.publish",
      "POST /admin/blog/posts/:id/unpublish": "catalog.publish",
      "DELETE /admin/blog/posts/:id": "catalog.write",
    });
  });

  it("keeps the store routes public, read-only and outside /admin", () => {
    expect(declaredPermissions(StoreBlogController)).toEqual({
      "GET /store/blog/posts": "none",
      "GET /store/blog/posts/:slug": "none",
      "GET /store/blog/sitemap": "none",
    });
  });
});
