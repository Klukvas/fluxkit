export interface HttpResult<TBody = unknown> {
  status: number;
  headers: Headers;
  /** Parsed JSON, or `undefined` for an empty body (204). */
  body: TBody;
}

export interface HttpOptions {
  body?: unknown;
  /** Arbitrary text body, sent as is. */
  rawBody?: string;
  /** Extra request headers (for example `cookie`). They win over the defaults below. */
  headers?: Record<string, string>;
  /**
   * Admin CSRF defaults. By default the helper sends `X-Fluxkit-CSRF: 1` and, with a body, `Content-Type:
   * application/json`, so ordinary specs need no ceremony. `csrf: false` sends no CSRF header (CSRF specs);
   * `contentType` overrides the content type (`null` sends none).
   */
  csrf?: boolean;
  contentType?: string | null;
}

/** Minimal JSON client for HTTP specs. `body` is serialized as JSON; pass `rawBody` to send arbitrary text. */
export async function http<TBody = unknown>(
  baseUrl: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: HttpOptions = {},
): Promise<HttpResult<TBody>> {
  const payload =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  const headers: Record<string, string> = {};
  if (options.csrf !== false) {
    headers["x-fluxkit-csrf"] = "1";
  }
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (payload !== undefined && contentType !== null) {
    headers["content-type"] = contentType;
  }
  Object.assign(headers, options.headers);
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: (text === "" ? undefined : JSON.parse(text)) as TBody,
  };
}
