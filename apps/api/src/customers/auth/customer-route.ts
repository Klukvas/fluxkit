import type { Type } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";

/** Metadata set by `@CustomerAuthenticated()`. */
export const CUSTOMER_ROUTE_KEY = "fluxkit:customer:authenticated";

type Target = Parameters<Reflector["get"]>[1];

/** True when the route (or its controller) is marked `@CustomerAuthenticated()`. */
export function isCustomerRoute(
  reflector: Reflector,
  handler: Target,
  controller: Type<unknown>,
): boolean {
  return (
    reflector.get<boolean | undefined>(CUSTOMER_ROUTE_KEY, handler) === true ||
    reflector.get<boolean | undefined>(CUSTOMER_ROUTE_KEY, controller) === true
  );
}
