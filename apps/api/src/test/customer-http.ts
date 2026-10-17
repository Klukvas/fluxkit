import { CUSTOMER_SESSION_COOKIE_NAME } from "../customers/auth/customer-session-cookie.js";
import { http, type HttpResult } from "./http.js";

/** TEST ONLY. The full `Set-Cookie` header of the customer session cookie, or `undefined` when none was set. */
export function customerSetCookieOf(result: HttpResult): string | undefined {
  return result.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${CUSTOMER_SESSION_COOKIE_NAME}=`));
}

/** TEST ONLY. The `name=value` pair of the customer session cookie in a response, or `undefined`. */
export function customerCookieOf(result: HttpResult): string | undefined {
  return customerSetCookieOf(result)?.split(";")[0];
}

export function customerLogin<TBody = Record<string, unknown>>(
  baseUrl: string,
  email: string,
  password: string,
  cookie?: string,
): Promise<HttpResult<TBody>> {
  return http<TBody>(baseUrl, "POST", "/store/account/login", {
    body: { email, password },
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });
}

/** Signs in and returns the cookie; fails loudly when the login did not succeed (test setup bug). */
export async function customerLoginCookie(
  baseUrl: string,
  email: string,
  password: string,
): Promise<string> {
  const result = await customerLogin(baseUrl, email, password);
  const cookie = customerCookieOf(result);
  if (result.status !== 200 || cookie === undefined) {
    throw new Error(`Test setup bug: customer login answered ${result.status}`);
  }
  return cookie;
}
