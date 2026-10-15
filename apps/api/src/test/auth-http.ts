import { SESSION_COOKIE_NAME } from "../auth/session-cookie.js";
import { http, type HttpResult } from "./http.js";

/** TEST ONLY. The `name=value` pair of the session cookie in a response, or `undefined` when none was set. */
export function sessionCookieOf(result: HttpResult): string | undefined {
  const header = result.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  return header?.split(";")[0];
}

export function login(
  baseUrl: string,
  email: string,
  password: string,
): Promise<HttpResult<Record<string, unknown>>> {
  return http(baseUrl, "POST", "/admin/auth/login", { body: { email, password } });
}

/** Logs in and returns the cookie; fails loudly when the login did not succeed (test setup bug). */
export async function loginCookie(
  baseUrl: string,
  email: string,
  password: string,
): Promise<string> {
  const result = await login(baseUrl, email, password);
  const cookie = sessionCookieOf(result);
  if (result.status !== 200 || cookie === undefined) {
    throw new Error(`Test setup bug: login answered ${result.status}`);
  }
  return cookie;
}
