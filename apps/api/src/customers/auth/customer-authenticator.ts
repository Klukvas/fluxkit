import type { Request } from "express";

export const CUSTOMER_AUTHENTICATOR = Symbol("CUSTOMER_AUTHENTICATOR");

/**
 * Who is calling a customer route, as decided by the authenticator for this request. Controllers read it with
 * `@CurrentCustomer()`. Deliberately has no role or permission: a customer is not an admin (ADR 0016).
 */
export interface CustomerPrincipal {
  customerId: string;
  email: string;
  sessionId: string;
}

/**
 * Identifies the caller of a customer route. `undefined` means "not signed in" (the guard answers 401). An
 * implementation that throws is treated as "not allowed" for the caller (HTTP 500, logged), never as "allowed".
 * There is no test double behind an environment switch: specs create real sessions through the session service.
 */
export interface CustomerAuthenticator {
  authenticate(
    request: Request,
  ): CustomerPrincipal | undefined | Promise<CustomerPrincipal | undefined>;
}
