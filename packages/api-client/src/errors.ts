/**
 * Errors the client THROWS. A problem the API answers on purpose (a 4xx with `application/problem+json`) is a returned
 * value, not an error. These mean the request could not be made or the answer cannot be trusted, and callers must show
 * a generic "try again" state. Messages name the operation (method and path template) only: never a request body, a
 * header, a token or a response body.
 */
export class ApiClientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The request was refused before sending (a bad base URL, a missing path parameter, a missing idempotency key). */
export class InvalidRequestError extends ApiClientError {}

/** `fetch` rejected: no connection, DNS, TLS, a reset, or an abort. The request may or may not have reached the API. */
export class NetworkError extends ApiClientError {
  /** True when the caller's `AbortSignal` ended the request. */
  readonly aborted: boolean;

  constructor(message: string, options: { cause: unknown; aborted: boolean }) {
    super(message, { cause: options.cause });
    this.aborted = options.aborted;
  }
}

/** The API answered, but not in a documented way: wrong status or content type, invalid JSON, a malformed problem body. */
export class InvalidResponseError extends ApiClientError {
  readonly status: number;

  constructor(message: string, options: { status: number; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.status = options.status;
  }
}
