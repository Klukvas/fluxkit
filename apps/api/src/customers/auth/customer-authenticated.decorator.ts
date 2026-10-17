import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";
import { CUSTOMER_ROUTE_KEY } from "./customer-route.js";
import { CustomerGuard } from "./customer.guard.js";

/**
 * Marks a store route (or every route of a controller) as customer-authenticated: anonymous callers get 401. The store
 * is PUBLIC by default; a route that handles a customer's own data must say so with this decorator, and the route-walk
 * test (`customer-routes.spec.ts`) fails when a route under `/store/account` does not. Read the caller with
 * `@CurrentCustomer()`. Runs after the global store CSRF guard.
 */
export const CustomerAuthenticated = (): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(CUSTOMER_ROUTE_KEY, true), UseGuards(CustomerGuard));
