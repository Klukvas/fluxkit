import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AdminPrincipal } from "./admin-authenticator.js";

/**
 * The principal the guard authenticated for a request. A WeakMap instead of a property on `Request`: nothing else
 * (middleware, a body field) can set or spoof it, and the request type needs no augmentation.
 */
const principals = new WeakMap<object, AdminPrincipal>();

export function setCurrentAdmin(request: object, principal: AdminPrincipal): void {
  principals.set(request, principal);
}

export function getCurrentAdmin(request: object): AdminPrincipal | undefined {
  return principals.get(request);
}

/**
 * The signed-in admin of this request. Throws (HTTP 500, logged) on a route without authentication, for example a
 * `@PublicAdminRoute()`: asking for the current admin there is a programming error.
 */
export const CurrentAdmin = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const principal = getCurrentAdmin(context.switchToHttp().getRequest<object>());
  if (principal === undefined) {
    throw new Error("@CurrentAdmin() used on a route that is not authenticated");
  }
  return principal;
});
