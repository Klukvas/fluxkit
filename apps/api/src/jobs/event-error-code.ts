import { errorCode, innermostCause } from "../common/error-summary.js";

const MAX_LENGTH = 64;

/** Thrown by the dispatcher when a handler does not answer in time. */
export class HandlerTimeoutError extends Error {
  constructor() {
    super("A domain event handler did not finish in time");
    this.name = "HandlerTimeoutError";
  }
}

/**
 * The value stored in `domain_event.last_error_code`: the class name of the error, plus the `code` of its innermost cause
 * when it has one (`Error:ECONNRESET`, `DrizzleQueryError:23505`). NEVER the message: a handler's error text can embed
 * personal data. Characters outside the column's CHECK are replaced and the result is at most 64 characters, so the
 * UPDATE that stores it cannot fail on the code itself.
 */
export function eventErrorCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return "NonError";
  }
  if (error instanceof HandlerTimeoutError) {
    return "HandlerTimeout";
  }
  const code = errorCode(innermostCause(error));
  const label = code === undefined ? error.constructor.name : `${error.constructor.name}:${code}`;
  const safe = label.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, MAX_LENGTH);
  return safe === "" ? "UnknownError" : safe;
}
