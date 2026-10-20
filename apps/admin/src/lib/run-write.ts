import type { AdminResult, ProblemDetails } from "@fluxkit/api-client";
import { failureFromError, type Failure } from "./failure";

/**
 * How one write ended, in the terms a form needs (plan, "Writes"). Never optimistic: a form shows the server's answer.
 * - `ok`: the API did it (`data` is the full resource, `undefined` for a 204: the screen reloads);
 * - `problem`: the API refused on purpose (the form shows the mapped message and the field errors);
 * - `unknown`: no answer (lost connection, timeout, unreadable answer): the change may or may not have happened, so the
 *   screen reloads what the server has and tells the admin; it never repeats the write by itself.
 */
export type WriteOutcome<T> =
  | { kind: "ok"; status: number; data: T }
  | { kind: "problem"; status: number; problem: ProblemDetails; retryAfter: string | null }
  | { kind: "unknown"; failure: Failure }
  | { kind: "aborted" };

/**
 * Runs one write exactly once. A bug (a request the client refused to build, any other thrown value) is thrown again,
 * so the route's error boundary shows it: it is never turned into a friendly "try again".
 */
export async function runWrite<T>(write: () => Promise<AdminResult<T>>): Promise<WriteOutcome<T>> {
  try {
    const result = await write();
    if (result.ok) return { kind: "ok", status: result.status, data: result.data };
    return {
      kind: "problem",
      status: result.status,
      problem: result.problem,
      retryAfter: result.retryAfter,
    };
  } catch (error) {
    const failure = failureFromError(error);
    return failure === null ? { kind: "aborted" } : { kind: "unknown", failure };
  }
}
