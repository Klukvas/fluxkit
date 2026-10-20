import { InvalidResponseError, NetworkError, type ProblemDetails } from "@fluxkit/api-client";
import { isTimeout } from "./request-timeout";

/**
 * Why a request did not succeed, in the terms a screen needs: a problem the API answered on purpose (with its status
 * and `Retry-After`), or a thrown client error. The problem's English `detail` travels along but is never shown.
 */
export type Failure =
  | { kind: "problem"; status: number; problem: ProblemDetails; retryAfter: string | null }
  | { kind: "network" }
  | { kind: "timeout" }
  | { kind: "invalidResponse" };

/**
 * The failure a thrown error stands for, or `null` for the caller's own abort (nothing to show: the screen went away).
 * Anything else, including `InvalidRequestError` (a request the client refused to build), is a bug and is thrown
 * again, never turned into a message.
 */
export function failureFromError(error: unknown): Failure | null {
  if (error instanceof NetworkError) {
    if (isTimeout(error)) return { kind: "timeout" };
    if (error.aborted) return null;
    return { kind: "network" };
  }
  if (error instanceof InvalidResponseError) return { kind: "invalidResponse" };
  throw error;
}
