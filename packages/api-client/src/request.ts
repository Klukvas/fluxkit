import { InvalidRequestError } from "./errors.js";

export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

/** The header every state-changing store request must carry (ADR 0016, CSRF defence). */
export const CSRF_HEADER = "X-Fluxkit-CSRF";
export const CSRF_HEADER_VALUE = "1";

const SAFE_METHODS: readonly HttpMethod[] = ["GET", "HEAD"];

/** The only content type a raw body may declare: the upload route accepts nothing else (ADR 0028). */
export const BINARY_CONTENT_TYPE = "application/octet-stream";

/**
 * A request body that is sent as it is, not as JSON. Used by the media upload only. `fetch` has no upload progress
 * and sets `Content-Length` itself, so neither is modelled here.
 */
export type RawBytes = Blob | ArrayBuffer | Uint8Array<ArrayBuffer>;

export interface RawBody {
  bytes: RawBytes;
  contentType: typeof BINARY_CONTENT_TYPE;
}

export type QueryValue = string | number | undefined;

export interface RequestInput {
  /** `""` (same origin, the browser) or an http(s) origin (the Next server). */
  baseUrl: string;
  method: HttpMethod;
  /** Path template such as `/store/products/{slug}`. */
  path: string;
  pathParams?: Readonly<Record<string, string>>;
  query?: Readonly<Record<string, QueryValue>>;
  /** Serialized as JSON; not allowed on GET and HEAD. */
  body?: unknown;
  /** Sent untouched with its own content type; excludes `body` and is not allowed on GET and HEAD. */
  rawBody?: RawBody;
  /** Extra headers (the idempotency key). They cannot replace the CSRF header, `Content-Type` or `Accept`. */
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  /** Passed to `fetch` first (for example Next's `{ next: { revalidate: 60 } }`); never replaces method, headers, body or credentials. */
  fetchOptions?: Readonly<Record<string, unknown>>;
  /** `pdf`: the operation answers a PDF file on success (`Accept` names it first). Default `json`. */
  responseKind?: "json" | "pdf";
}

export interface BuiltRequest {
  url: string;
  init: RequestInit & { headers: Headers };
}

/** Validates a base URL and returns it without a trailing slash. */
export function normalizeBaseUrl(baseUrl: string): string {
  if (baseUrl === "") return "";
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (cause) {
    throw new InvalidRequestError("baseUrl must be empty or an http(s) origin.", { cause });
  }
  const isOrigin =
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "" &&
    url.username === "" &&
    url.password === "" &&
    !baseUrl.includes("?") &&
    !baseUrl.includes("#");
  if (!isOrigin) {
    throw new InvalidRequestError("baseUrl must be empty or an http(s) origin without a path.");
  }
  return url.origin;
}

function fillPath(template: string, params: Readonly<Record<string, string>>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name: string) => {
    const value = params[name];
    // `.` and `..` would be resolved by the URL parser and leave the intended route.
    if (value === undefined || value === "" || value === "." || value === "..") {
      throw new InvalidRequestError(
        `Path parameter "${name}" is missing or not usable for ${template}.`,
      );
    }
    return encodeURIComponent(value);
  });
}

function buildQuery(query: Readonly<Record<string, QueryValue>>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

/**
 * Builds the URL and the `fetch` init of one store request. Pure, so the rules that protect the API
 * contract are unit tested without a network: `X-Fluxkit-CSRF: 1` on every request that is not GET or HEAD, a JSON
 * content type exactly when there is a JSON body (the upload sends `application/octet-stream` instead), cookies for the same origin only.
 */
export function buildRequest(input: RequestInput): BuiltRequest {
  const isSafe = SAFE_METHODS.includes(input.method);
  if (isSafe && input.body !== undefined) {
    throw new InvalidRequestError(`${input.method} ${input.path} cannot have a body.`);
  }

  if (input.rawBody !== undefined) {
    if (isSafe) throw new InvalidRequestError(`${input.method} ${input.path} cannot have a body.`);
    if (input.body !== undefined) {
      throw new InvalidRequestError(
        `${input.path}: give either a JSON body or a raw body, not both.`,
      );
    }
  }

  const url = `${normalizeBaseUrl(input.baseUrl)}${fillPath(input.path, input.pathParams ?? {})}${buildQuery(input.query ?? {})}`;

  const headers = new Headers();
  for (const [name, value] of Object.entries(input.headers ?? {})) headers.set(name, value);
  headers.set(
    "Accept",
    input.responseKind === "pdf"
      ? "application/pdf, application/problem+json"
      : "application/json, application/problem+json",
  );
  if (!isSafe) headers.set(CSRF_HEADER, CSRF_HEADER_VALUE);
  else headers.delete(CSRF_HEADER);
  if (input.rawBody !== undefined) headers.set("Content-Type", input.rawBody.contentType);
  else if (input.body !== undefined) headers.set("Content-Type", "application/json");
  else headers.delete("Content-Type");
  // fetch computes the length from the body; a caller value could only disagree with it.
  if (input.rawBody !== undefined) headers.delete("Content-Length");

  const init: BuiltRequest["init"] = {
    ...input.fetchOptions,
    method: input.method,
    headers,
    credentials: "same-origin",
    ...(input.rawBody !== undefined
      ? { body: input.rawBody.bytes }
      : input.body === undefined
        ? { body: undefined }
        : { body: JSON.stringify(input.body) }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };
  return { url, init };
}
