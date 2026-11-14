import { SetMetadata } from "@nestjs/common";
import { isAdminPermission, type AdminPermission } from "@fluxkit/core";

/*
 * The admin route metadata (ADR 0009). Moved unchanged from `apps/api/src/auth/route-access.ts` (ADR 0049): the key
 * strings are part of what the global admin guard reads, so they never change (pinned by `route-access.spec.ts`).
 */
export const PERMISSION_KEY = "fluxkit:admin:permission";
export const PUBLIC_KEY = "fluxkit:admin:public";
export const AUTHENTICATED_KEY = "fluxkit:admin:authenticated";
export const DEFAULTS_KEY = "fluxkit:admin:default-permission-by-method";

/** The permission a role must hold to call this route (or every route of the controller, unless a route overrides it). */
export const RequirePermission = (permission: AdminPermission): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSION_KEY, permission);

/** The route skips authentication and the permission check (login). CSRF protection still applies to it. */
export const PublicAdminRoute = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_KEY, true);

/**
 * Any signed-in admin may call the route, whatever the role: no particular permission (logout, "who am I", change
 * own password). Anonymous callers still get 401. Use it only for self-service on the caller's own account.
 */
export const AuthenticatedAdminRoute = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTHENTICATED_KEY, true);

/** The permission a controller's routes get by default: `read` for GET and HEAD, `write` for every other method. */
export interface DefaultPermissions {
  readonly read: AdminPermission;
  readonly write: AdminPermission;
}

/** The default of every controller that does not name its own pair: the catalog permissions. */
export const CATALOG_DEFAULT_PERMISSIONS: DefaultPermissions = Object.freeze({
  read: "catalog.read",
  write: "catalog.write",
});

/**
 * Set by `@AdminController`: routes without their own `@RequirePermission` get the default of their HTTP method
 * (the catalog pair unless the controller names another, for example `customers.read` and `customers.write`).
 */
export const UseDefaultPermissionByMethod = (
  defaults: DefaultPermissions = CATALOG_DEFAULT_PERMISSIONS,
): ClassDecorator => {
  if (!isAdminPermission(defaults.read) || !isAdminPermission(defaults.write)) {
    // A typo must fail at startup, not become a route nobody can call (or one anybody can).
    throw new Error("The default permissions of an admin controller must be existing permissions");
  }
  return SetMetadata(DEFAULTS_KEY, { read: defaults.read, write: defaults.write });
};
