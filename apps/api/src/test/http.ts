export interface HttpResult<TBody = unknown> {
  status: number;
  headers: Headers;
  /** Parsed JSON, or `undefined` for an empty body (204). */
  body: TBody;
}

/** Minimal JSON client for HTTP specs. `body` is serialized as JSON; pass `rawBody` to send arbitrary text. */
export async function http<TBody = unknown>(
  baseUrl: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: { body?: unknown; rawBody?: string } = {},
): Promise<HttpResult<TBody>> {
  const payload =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: payload === undefined ? {} : { "content-type": "application/json" },
    body: payload,
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: (text === "" ? undefined : JSON.parse(text)) as TBody,
  };
}
