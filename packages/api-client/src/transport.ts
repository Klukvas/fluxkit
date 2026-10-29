import { InvalidRequestError, NetworkError } from "./errors.js";
import {
  buildRequest,
  normalizeBaseUrl,
  type HttpMethod,
  type QueryValue,
  type RawBody,
} from "./request.js";
import { parseResponse, type StoreResult } from "./response.js";

/** The part of `fetch` the clients use; tests inject a fake. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface TransportOptions {
  /** `""` in the browser (one origin); an http(s) origin on the server. */
  baseUrl: string;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
}

export interface CallOptions {
  signal?: AbortSignal;
  /** Extra `fetch` options such as Next's `{ next: { revalidate: 60 } }`. Cannot change method, headers, body or credentials. */
  fetchOptions?: Readonly<Record<string, unknown>>;
}

/** The part of an operation row the transport needs; the store and the admin tables both satisfy it. */
export interface TransportOperation {
  method: HttpMethod;
  path: string;
  successStatuses: readonly number[];
  query: readonly string[];
  /** The admin table says `binary` for the upload; the store table has no such operation and leaves it out. */
  bodyKind?: "none" | "json" | "binary";
  /** The admin table says `pdf` for the shipment label; every other operation answers JSON. */
  responseKind?: "json" | "pdf";
}

export interface CallParts {
  pathParams?: Record<string, string>;
  body?: unknown;
  /** Raw bytes for an operation whose `bodyKind` is `binary`; never for any other. */
  rawBody?: RawBody;
  headers?: Record<string, string>;
  options?: CallOptions;
}

function isAbort(cause: unknown, signal: AbortSignal | undefined): boolean {
  return (
    signal?.aborted === true ||
    (typeof cause === "object" &&
      cause !== null &&
      (cause as { name?: unknown }).name === "AbortError")
  );
}

/**
 * The one place a request is built, sent and parsed, shared by the store and the admin client. One `fetch` call per
 * request: there is no retry, so a failed write is never replayed. A `fetch` rejection is thrown as `NetworkError`;
 * broken answers are thrown by `parseResponse`.
 */
export function createTransport(options: TransportOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));

  return async function send<T>(
    operation: TransportOperation,
    parts: CallParts,
  ): Promise<StoreResult<T>> {
    const context = `${operation.method} ${operation.path}`;
    const given: Readonly<Record<string, unknown>> = { ...parts.options };
    const query: Record<string, QueryValue> = {};
    for (const key of operation.query) {
      const value = given[key];
      if (typeof value === "string" || typeof value === "number") query[key] = value;
      else if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
        query[key] = value as readonly string[];
      }
    }

    // The binary kind is the one exception to the JSON rules and must never leak to another operation or the reverse.
    if (operation.bodyKind === "binary") {
      if (parts.rawBody === undefined || parts.body !== undefined) {
        throw new InvalidRequestError(`${context}: this operation takes raw bytes only.`);
      }
    } else if (parts.rawBody !== undefined) {
      throw new InvalidRequestError(`${context}: this operation does not take raw bytes.`);
    }

    const request = buildRequest({
      baseUrl,
      method: operation.method,
      path: operation.path,
      ...(parts.pathParams === undefined ? {} : { pathParams: parts.pathParams }),
      query,
      ...(parts.body === undefined ? {} : { body: parts.body }),
      ...(parts.rawBody === undefined ? {} : { rawBody: parts.rawBody }),
      ...(parts.headers === undefined ? {} : { headers: parts.headers }),
      ...(parts.options?.signal === undefined ? {} : { signal: parts.options.signal }),
      ...(parts.options?.fetchOptions === undefined
        ? {}
        : { fetchOptions: parts.options.fetchOptions }),
      ...(operation.responseKind === undefined ? {} : { responseKind: operation.responseKind }),
    });

    let response: Response;
    try {
      response = await fetchImpl(request.url, request.init);
    } catch (cause) {
      throw new NetworkError(`${context}: the request failed before an answer arrived.`, {
        cause,
        aborted: isAbort(cause, parts.options?.signal),
      });
    }
    return parseResponse<T>(
      {
        successStatuses: operation.successStatuses,
        context,
        ...(operation.responseKind === undefined ? {} : { responseKind: operation.responseKind }),
      },
      response,
    );
  };
}
