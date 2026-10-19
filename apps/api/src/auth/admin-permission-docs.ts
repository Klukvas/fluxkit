import type { INestApplication, Type } from "@nestjs/common";
import { ModulesContainer, Reflector } from "@nestjs/core";
import type { OpenAPIObject } from "@nestjs/swagger";
import { resolveRouteAccess } from "./route-access.js";

/** The vendor extension `docs/contracts/api.md` documents on every `/admin` operation. */
export const PERMISSION_EXTENSION = "x-fluxkit-permission";

/**
 * What the extension says besides a permission name: `authenticated` (any signed-in admin, no permission),
 * `public` (no sign-in, only the login) and `denied` (the route declares nothing, so the guard refuses everybody: a
 * plain `@Controller("admin/...")` of a feature).
 */
export type PermissionMarker = "authenticated" | "public" | "denied";

interface Handler {
  readonly controller: Type<unknown>;
  readonly handler: (...args: never[]) => unknown;
}

/** `ControllerName_methodName` is the operation id Swagger gives every route, so it names the handler exactly. */
function handlersByOperationId(app: INestApplication): Map<string, Handler> {
  const found = new Map<string, Handler>();
  for (const nestModule of app.get(ModulesContainer).values()) {
    for (const wrapper of nestModule.controllers.values()) {
      const controller = wrapper.metatype as Type<unknown> | null;
      if (controller === null) {
        continue;
      }
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = (controller.prototype as Record<string, unknown>)[name];
        if (typeof handler !== "function") {
          continue;
        }
        const key = `${controller.name}_${name}`;
        const existing = found.get(key);
        if (existing !== undefined && existing.controller !== controller) {
          throw new Error(
            `Two controllers are named ${controller.name}; operation ids would collide.`,
          );
        }
        found.set(key, { controller, handler: handler as Handler["handler"] });
      }
    }
  }
  return found;
}

/**
 * Adds `x-fluxkit-permission` to every `/admin` operation, read from the same declarations the guard enforces
 * (`resolveRouteAccess`: `@RequirePermission`, `@AuthenticatedAdminRoute`, `@PublicAdminRoute`, the controller's
 * default pair), never from a table written by hand. A client (the admin UI) can therefore test its own permission table
 * against the API. Documentation only.
 */
export function documentAdminPermissions(
  app: INestApplication,
  document: OpenAPIObject,
): OpenAPIObject {
  const handlers = handlersByOperationId(app);
  const reflector = new Reflector();
  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.startsWith("/admin/")) {
      continue;
    }
    for (const [method, operation] of Object.entries(item)) {
      if (typeof operation !== "object" || operation === null || !("operationId" in operation)) {
        continue;
      }
      const operationId = String(operation["operationId"]);
      const route = handlers.get(operationId);
      if (route === undefined) {
        throw new Error(
          `The operation ${method.toUpperCase()} ${path} (${operationId}) has no controller method: keep Swagger's default operation ids on admin routes.`,
        );
      }
      const access = resolveRouteAccess(reflector, route.handler, route.controller, method);
      const value: string =
        access.kind === "permission"
          ? access.permission
          : access.kind === "undeclared"
            ? "denied"
            : access.kind;
      (operation as Record<string, unknown>)[PERMISSION_EXTENSION] = value;
    }
  }
  return document;
}
