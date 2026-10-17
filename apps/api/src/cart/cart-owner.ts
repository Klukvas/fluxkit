import type { Request } from "express";
import type { CustomerAuthenticator } from "../customers/auth/customer-authenticator.js";
import { readCartCookie } from "./cart-cookie.js";
import type { CartOwner } from "./cart.service.js";

export interface Shopper {
  readonly owner: CartOwner;
  /** The email of the signed-in customer's account; `undefined` for a guest. */
  readonly accountEmail: string | undefined;
}

/**
 * Who is shopping: the signed-in customer if the session cookie is valid, else the guest of the cart cookie. The ONE
 * place that decides it, for the cart routes and the checkout. Never a request field: nothing in a path, query, body or
 * header names a cart or a customer.
 */
export async function resolveShopper(
  authenticator: CustomerAuthenticator,
  request: Request,
): Promise<Shopper> {
  const principal = await authenticator.authenticate(request);
  return principal === undefined
    ? {
        owner: { kind: "guest", token: readCartCookie(request.headers.cookie) },
        accountEmail: undefined,
      }
    : {
        owner: { kind: "customer", customerId: principal.customerId },
        accountEmail: principal.email,
      };
}
