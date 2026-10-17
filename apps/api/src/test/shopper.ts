import { http, type HttpOptions, type HttpResult } from "./http.js";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * TEST ONLY. A browser for the store specs: it keeps the cookies the API sets (and drops the ones it clears), so a spec
 * reads like a shopper's session. Two `Shopper`s never share cookies, which is how the ownership specs swap carts.
 */
export class Shopper {
  private readonly jar = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  /** The value of a cookie the API set, or `undefined`. */
  cookie(name: string): string | undefined {
    return this.jar.get(name);
  }

  setCookie(name: string, value: string): void {
    this.jar.set(name, value);
  }

  dropCookie(name: string): void {
    this.jar.delete(name);
  }

  /** The `Cookie` request header, or `undefined` when the jar is empty. */
  header(): string | undefined {
    return this.jar.size === 0
      ? undefined
      : [...this.jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  async request<TBody = unknown>(
    method: Method,
    path: string,
    options: HttpOptions = {},
  ): Promise<HttpResult<TBody>> {
    const cookie = this.header();
    const result = await http<TBody>(this.baseUrl, method, path, {
      ...options,
      headers: { ...(cookie === undefined ? {} : { cookie }), ...options.headers },
    });
    this.absorb(result);
    return result;
  }

  private absorb(result: HttpResult): void {
    for (const header of result.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split("; ");
      const separator = pair?.indexOf("=") ?? -1;
      if (pair === undefined || separator === -1) continue;
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const expired =
        attributes.includes("Max-Age=0") ||
        attributes.some((attribute) => attribute === "Expires=Thu, 01 Jan 1970 00:00:00 GMT");
      if (expired || value === "") {
        this.jar.delete(name);
      } else {
        this.jar.set(name, value);
      }
    }
  }

  get<TBody = unknown>(path: string): Promise<HttpResult<TBody>> {
    return this.request<TBody>("GET", path);
  }

  post<TBody = unknown>(path: string, body?: unknown): Promise<HttpResult<TBody>> {
    return this.request<TBody>("POST", path, { body });
  }

  patch<TBody = unknown>(path: string, body?: unknown): Promise<HttpResult<TBody>> {
    return this.request<TBody>("PATCH", path, { body });
  }

  delete<TBody = unknown>(path: string): Promise<HttpResult<TBody>> {
    return this.request<TBody>("DELETE", path);
  }
}

/** The raw `Set-Cookie` header of one cookie in a response, or `undefined`. */
export function setCookieOf(result: HttpResult, name: string): string | undefined {
  return result.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
}
