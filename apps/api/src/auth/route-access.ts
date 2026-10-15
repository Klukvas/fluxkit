import { SetMetadata, type Type } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { AdminPermission } from "@fluxkit/core";

const PERMISSION_KEY = "fluxkit:admin:permission";
const PUBLIC_KEY = "fluxkit:admin:public";
const DEFAULTS_KEY = "fluxkit:admin:default-permission-by-method";

/** The permission a role must hold to call this route (or every route of the controller, unless a route overrides it). */
export const RequirePermission = (permission: AdminPermission): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSION_KEY, permission);

/** The route skips authentication and the permission check (login). CSRF protection still applies to it. */
export const PublicAdminRoute = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_KEY, true);

/** Set by `@AdminController`: routes without their own `@RequirePermission` get the default of their HTTP method. */
export const UseDefaultPermissionByMethod = (): ClassDecorator => SetMetadata(DEFAULTS_KEY, true);

const READ_METHODS = new Set(["GET", "HEAD"]);

/** `catalog.read` for GET and HEAD, `catalog.write` for everything else (including `@All` routes and OPTIONS handlers). */
export function defaultPermissionForMethod(httpMethod: string): AdminPermission {
  return READ_METHODS.has(httpMethod.toUpperCase()) ? "catalog.read" : "catalog.write";
}

export type RouteAccess =
  | { kind: "public" }
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
    const permission = reflector.get<AdminPermission | undefined>(PERMISSION_KEY, target);
    if (isPublic && permission !== undefined) {
      throw new Error(
        `A route cannot be both @PublicAdminRoute and @RequirePermission("${permission}")`,
      );
    }
    if (isPublic) {
      return { kind: "public" };
    }
    if (permission !== undefined) {
      return {
        kind: "permission",
        permission,
        source: target === handler ? "route" : "controller",
      };
    }
  }
  if (reflector.get<boolean | undefined>(DEFAULTS_KEY, controller) === true) {
    return {
      kind: "permission",
      permission: defaultPermissionForMethod(httpMethod),
      source: "default",
    };
  }
  return { kind: "undeclared" };
}
