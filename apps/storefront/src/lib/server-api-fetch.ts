import type { FetchLike } from "@fluxkit/api-client";

const CONNECTION_ERRORS = new Set(["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "UND_ERR_SOCKET"]);

function isConnectionFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  let connectionFailure = false;
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const { name, code, message, cause } = current as {
      name?: unknown;
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    // A nested connection error must not turn a caller abort or a timeout into another request.
    if (
      name === "AbortError" ||
      name === "TimeoutError" ||
      (typeof code === "string" && /TIMEOUT|TIMEDOUT|ABORT/.test(code))
    )
      return false;
    if (
      (typeof code === "string" && CONNECTION_ERRORS.has(code)) ||
      message === "other side closed"
    )
      connectionFailure = true;
    current = cause;
  }
  return connectionFailure;
}

/** Server reads can meet an API replica that is draining but still in Docker DNS. Never replay a write or an answer. */
export function withConnectionRetry(fetchImpl: FetchLike): FetchLike {
  return async (url, init) => {
    try {
      return await fetchImpl(url, init);
    } catch (error) {
      const method = (init.method ?? "GET").toUpperCase();
      if (
        (method !== "GET" && method !== "HEAD") ||
        init.signal?.aborted === true ||
        !isConnectionFailure(error)
      )
        throw error;
      return fetchImpl(url, init);
    }
  };
}

// Resolve fetch at call time: Next installs its cache-aware fetch after modules load.
export const serverApiFetch: FetchLike = withConnectionRetry((url, init) =>
  globalThis.fetch(url, init),
);
