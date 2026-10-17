import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request, Response } from "express";
import { unauthorized } from "../../common/problem.js";
import {
  CUSTOMER_AUTHENTICATOR,
  type CustomerAuthenticator,
  type CustomerPrincipal,
} from "./customer-authenticator.js";
import { setCurrentCustomer } from "./current-customer.js";

/** Requests that passed, so a guard declared on both the controller and a route runs the authenticator once. */
const passedRequests = new WeakSet<object>();

function isPrincipal(value: unknown): value is CustomerPrincipal {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof CustomerPrincipal, unknown>>;
  return (
    typeof candidate.customerId === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.sessionId === "string"
  );
}

/**
 * Authentication of the routes marked `@CustomerAuthenticated()` (the store is public by default). No principal ->
 * the same `401` for every reason (missing, malformed, unknown, expired, revoked or inactive); there is no
 * permission check because a customer only ever reaches its own data (the service filters by the principal).
 * Every response of such a route, errors included, is `Cache-Control: no-store`.
 */
@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(
    @Inject(CUSTOMER_AUTHENTICATOR) private readonly authenticator: CustomerAuthenticator,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    if (passedRequests.has(request)) {
      return true;
    }
    http.getResponse<Response>().setHeader("Cache-Control", "no-store");
    const principal = await this.authenticator.authenticate(request);
    if (principal === undefined || principal === null) {
      throw unauthorized();
    }
    if (!isPrincipal(principal)) {
      // A broken authenticator must end as a logged server error, never as access (or as a silent 401).
      throw new TypeError(
        "The customer authenticator returned something that is not a CustomerPrincipal",
      );
    }
    setCurrentCustomer(request, principal);
    passedRequests.add(request);
    return true;
  }
}
