import type { FetchLike } from "@fluxkit/api-client";
import { API_PATH_PATTERN } from "../router/base-path";

/**
 * What a response says about the session, seen in one place for every admin request (plan, "Session expiry"):
 * `unauthorized` (a 401: the session ended, open the re-sign-in dialog) or `forbidden` (a 403: the role may have
 * changed, read the permissions again). The sign-in and sign-out requests are excluded: their 401 is the answer itself.
 */
export type SessionSignal = "unauthorized" | "forbidden";

const EXCLUDED = new Set(["POST /admin/auth/login", "POST /admin/auth/logout"]);

export function classifySessionSignal(
  method: string,
  url: string,
  status: number,
): SessionSignal | null {
  if (status !== 401 && status !== 403) return null;
  const path = url.split("?")[0] as string;
  if (!API_PATH_PATTERN.test(path)) return null;
  if (EXCLUDED.has(`${method.toUpperCase()} ${path}`)) return null;
  return status === 401 ? "unauthorized" : "forbidden";
}

export interface SignalHub {
  emit(signal: SessionSignal): void;
  subscribe(listener: (signal: SessionSignal) => void): () => void;
}

export function createSignalHub(): SignalHub {
  const listeners = new Set<(signal: SessionSignal) => void>();
  return {
    emit(signal) {
      for (const listener of [...listeners]) listener(signal);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Wraps a `fetch`: the response is returned unchanged, and a 401 or 403 is reported to the hub. One call, no retry. */
export function withSessionSignals(fetchImpl: FetchLike, hub: SignalHub): FetchLike {
  return async (url, init) => {
    const response = await fetchImpl(url, init);
    const signal = classifySessionSignal(init.method ?? "GET", url, response.status);
    if (signal !== null) hub.emit(signal);
    return response;
  };
}
