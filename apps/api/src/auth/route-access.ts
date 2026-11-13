import type { Type } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { AdminPermission } from "@fluxkit/core";
import { RequirePermission, type DefaultPermissions } from "@fluxkit/api-kit";
import {
  AUTHENTICATED_KEY,
  AuthenticatedAdminRoute,
  CATALOG_DEFAULT_PERMISSIONS,
  DEFAULTS_KEY,
  PERMISSION_KEY,
  PUBLIC_KEY,
  PublicAdminRoute,
  UseDefaultPermissionByMethod,
} from "@fluxkit/api-kit/internal";

/*
 * The decorators and their metadata keys live in `@fluxkit/api-kit` (ADR 0049), so a feature package declares admin
 * permissions with the same metadata this file reads. They are re-exported here unchanged, so no import of this file
 * changes; how a route's access is resolved stays with the API.
 */
export {
  AuthenticatedAdminRoute,
  CATALOG_DEFAULT_PERMISSIONS,
  PublicAdminRoute,
  RequirePermission,
  UseDefaultPermissionByMethod,
  type DefaultPermissions,
};

const READ_METHODS = new Set(["GET", "HEAD"]);

/**
 * `defaults.read` for GET and HEAD, `defaults.write` for everything else (including `@All` routes and OPTIONS
 * handlers). Without a pair: `catalog.read` and `catalog.write`.
 */
export function defaultPermissionForMethod(
  httpMethod: string,
  defaults: DefaultPermissions = CATALOG_DEFAULT_PERMISSIONS,
): AdminPermission {
  return READ_METHODS.has(httpMethod.toUpperCase()) ? defaults.read : defaults.write;
}

export type RouteAccess =
  | { kind: "public" }
  | { kind: "authenticated" }
  | { kind: "permission"; permission: AdminPermission; source: "route" | "controller" | "default" }
  | { kind: "undeclared" };

type Target = Parameters<Reflector["get"]>[1];

/**
 * What a route under `/admin` requires. The route's own declaration wins over the controller's; without any
 * declaration only a controller made with `@AdminController` gets the default by HTTP method, any other controller
 * is `undeclared` and the guard denies it. A single level declaring both `@PublicAdminRoute` and `@RequirePermission`
 * is a programming error and throws, so it can never silently end up public.
 */
export function resolveRouteAccess(
  reflector: Reflector,
  handler: Target,
  controller: Type<unknown>,
  httpMethod: string,
): RouteAccess {
  for (const target of [handler, controller]) {
    const isPublic = reflector.get<boolean | undefined>(PUBLIC_KEY, target) === true;
    const isAuthenticated = reflector.get<boolean | undefined>(AUTHENTICATED_KEY, target) === true;
    const permission = reflector.get<AdminPermission | undefined>(PERMISSION_KEY, target);
    if (isPublic && permission !== undefined) {
      throw new Error(
        `A route cannot be both @PublicAdminRoute and @RequirePermission("${permission}")`,
      );
    }
    if (isAuthenticated && (isPublic || permission !== undefined)) {
      throw new Error(
        "A route cannot be both @AuthenticatedAdminRoute and @PublicAdminRoute or @RequirePermission",
      );
    }
    if (isPublic) {
      return { kind: "public" };
    }
    if (isAuthenticated) {
      return { kind: "authenticated" };
    }
    if (permission !== undefined) {
      return {
        kind: "permission",
        permission,
        source: target === handler ? "route" : "controller",
      };
    }
  }
  const defaults = reflector.get<DefaultPermissions | undefined>(DEFAULTS_KEY, controller);
  if (defaults !== undefined) {
    return {
      kind: "permission",
      permission: defaultPermissionForMethod(httpMethod, defaults),
      source: "default",
    };
  }
  return { kind: "undeclared" };
}
