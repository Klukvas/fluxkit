const MAX_CAUSE_DEPTH = 10;

/** The innermost error of the cause chain: its name and `code` identify a network or pool failure without its text. */
export function innermostCause(error: Error): Error {
  let current = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current.cause instanceof Error; depth += 1) {
    current = current.cause;
  }
  return current;
}

/** `code` of an error when it is a string or a number (SQLSTATE, `ECONNRESET`, ...). */
export function errorCode(error: Error): string | undefined {
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? String(code) : undefined;
}

/**
 * What is safe to log about a failure whose message may embed SQL text or bound parameters: class name, the
 * innermost cause's name and its code. Never the message.
 */
export function summarizeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return `non-error value (${typeof error})`;
  }
  const innermost = innermostCause(error);
  const code = errorCode(innermost);
  return `${error.constructor.name} cause=${innermost.name}${code === undefined ? "" : ` code=${code}`}`;
}
