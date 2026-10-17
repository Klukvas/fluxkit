import { Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { CustomerAuthenticator, CustomerPrincipal } from "./customer-authenticator.js";
import { readCustomerSessionCookie } from "./customer-session-cookie.js";
import { CustomerSessionService } from "./customer-session.service.js";

/**
 * The production authenticator: customer session cookie -> session service -> principal. It reads ONLY the cookie
 * `fluxkit_customer_session`: never an Authorization header, a query parameter, a body field or the admin cookie.
 * Anything that goes wrong inside (database down, bug) is rethrown and ends as a logged 500; it is never turned into
 * "allowed" or into a silent 401.
 */
@Injectable()
export class SessionCustomerAuthenticator implements CustomerAuthenticator {
  constructor(@Inject(CustomerSessionService) private readonly sessions: CustomerSessionService) {}

  async authenticate(request: Request): Promise<CustomerPrincipal | undefined> {
    const token = readCustomerSessionCookie(request.headers.cookie);
    if (token === undefined) {
      return undefined;
    }
    const resolved = await this.sessions.resolve(token);
    if (resolved === undefined) {
      return undefined;
    }
    return {
      customerId: resolved.customer.id,
      email: resolved.customer.email,
      sessionId: resolved.sessionId,
    };
  }
}
