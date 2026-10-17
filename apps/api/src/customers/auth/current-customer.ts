import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { CustomerPrincipal } from "./customer-authenticator.js";

/**
 * The principal the guard authenticated for a request. A WeakMap instead of a property on `Request`: nothing else
 * (middleware, a body field) can set or spoof it, and the request type needs no augmentation.
 */
const principals = new WeakMap<object, CustomerPrincipal>();

export function setCurrentCustomer(request: object, principal: CustomerPrincipal): void {
  principals.set(request, principal);
}

export function getCurrentCustomer(request: object): CustomerPrincipal | undefined {
  return principals.get(request);
}

/**
 * The signed-in customer of this request. Throws (HTTP 500, logged) on a route that is not marked
 * `@CustomerAuthenticated()`: asking for the current customer there is a programming error. A route must never
 * guess the customer from a body, query or header.
 */
export const CurrentCustomer = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const principal = getCurrentCustomer(context.switchToHttp().getRequest<object>());
  if (principal === undefined) {
    throw new Error("@CurrentCustomer() used on a route that is not customer-authenticated");
  }
  return principal;
});
