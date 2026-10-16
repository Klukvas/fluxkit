import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { isAdminPermission, isAdminRole } from "@fluxkit/core";
import type { Request } from "express";
import { isAdminPath } from "../common/admin-path.js";
import { forbidden, unauthorized } from "../common/problem.js";
import {
  ADMIN_AUTHENTICATOR,
  type AdminAuthenticator,
  type AdminPrincipal,
} from "./admin-authenticator.js";
import { assertCsrfSafe } from "./csrf.js";
import { setCurrentAdmin } from "./current-admin.js";
import { resolveRouteAccess } from "./route-access.js";

/** Requests that passed every check, so the global guard and `@AdminController` run them only once. */
const passedRequests = new WeakSet<object>();

function isPrincipal(value: unknown): value is AdminPrincipal {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof AdminPrincipal, unknown>>;
  return (
    typeof candidate.userId === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.sessionId === "string" &&
    isAdminRole(candidate.role) &&
    Array.isArray(candidate.permissions) &&
    candidate.permissions.every(isAdminPermission)
  );
}

/**
 * Default deny for the admin API. Order of checks (ADR 0009, plan step 3):
 * 1. CSRF header for state-changing methods (before authentication, also for anonymous callers),
 * 2. `@PublicAdminRoute` routes end here,
 * 3. authentication: no principal -> 401,
 * 4. permission: a route needs its `@RequirePermission` (or the `@AdminController` default); a route without any
 *    declaration, or with a permission the role lacks -> 403. `@AuthenticatedAdminRoute` routes need no permission.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(ADMIN_AUTHENTICATOR) private readonly authenticator: AdminAuthenticator,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (passedRequests.has(request)) {
      return true;
    }
    assertCsrfSafe(request);
    const access = resolveRouteAccess(
      this.reflector,
      context.getHandler(),
      context.getClass(),
      request.method,
    );
    if (access.kind === "public") {
      passedRequests.add(request);
      return true;
    }
    const principal = await this.authenticator.authenticate(request);
    if (principal === undefined || principal === null) {
      throw unauthorized();
    }
    if (!isPrincipal(principal)) {
      // A broken authenticator must end as a logged server error, never as access (or as a silent 401).
      throw new TypeError(
        "The admin authenticator returned something that is not an AdminPrincipal",
      );
    }
    if (access.kind === "undeclared") {
      throw forbidden("This admin route does not declare the permission it requires.");
    }
    if (access.kind === "permission" && !principal.permissions.includes(access.permission)) {
      throw forbidden(`Your role does not have the permission ${access.permission}.`);
    }
    setCurrentAdmin(request, principal);
    passedRequests.add(request);
    return true;
  }
}

/**
 * Registered globally (`APP_GUARD`): every route under `/admin` is guarded, also a controller that forgot
 * `@AdminController` and every route of a feature module (features cannot import this API's decorator).
 */
@Injectable()
export class AdminPathGuard implements CanActivate {
  constructor(private readonly adminGuard: AdminGuard) {}

  canActivate(context: ExecutionContext): Promise<boolean> | boolean {
    if (context.getType() !== "http") {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    return isAdminPath(request.path) ? this.adminGuard.canActivate(context) : true;
  }
}
