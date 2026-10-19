import { InvalidResponseError, NetworkError, type StoreFailure } from "@fluxkit/api-client";
import type { Translator } from "@fluxkit/ui";
import {
  fieldErrorMessageKey,
  problemMessageKey,
  transportErrorMessageKey,
} from "./problem-messages";

/**
 * What the shopper is told when a store request did not work, as DATA: message KEYS only (the API's English `detail` and
 * `message` never travel further than `problem-messages.ts`), the wait of a `429`, and the field errors of a form. The
 * views translate; nothing here holds text.
 */

export interface FieldFailure {
  /** Dotted path of the field in the request body, for example `password`. */
  path: string;
  /** The API's code for it (`too_short`), kept so a form can special-case one (`conflict` on `email`). */
  code: string;
  messageKey: string;
}

export interface Failure {
  messageKey: string;
  /** HTTP status, `null` for a failure before an answer arrived (network) or in the client. */
  status: number | null;
  code: string | null;
  /** Whole seconds from `Retry-After`, `null` when absent or not usable. */
  retryAfterSeconds: number | null;
  fieldErrors: FieldFailure[];
}

/** Longest wait shown: a day. A larger header is a mistake or an attack, not a number to display. */
const MAX_RETRY_AFTER_SECONDS = 86_400;

/**
 * `Retry-After` of the store API is a whole number of seconds (`docs/api/customers.md`). An HTTP date, a fraction, zero or
 * junk gives `null`: no wait is shown rather than a wrong one.
 */
export function retryAfterSeconds(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const seconds = Number(text);
  if (seconds < 1) return null;
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
}

export function failureFromResult(result: StoreFailure): Failure {
  const { problem } = result;
  const fieldErrors: FieldFailure[] = (problem.errors ?? []).map((error) => ({
    path: error.path,
    code: error.code,
    messageKey: fieldErrorMessageKey(error.code),
  }));
  if (problem.code === "conflict" && problem.field !== undefined) {
    fieldErrors.push({
      path: problem.field,
      code: "conflict",
      messageKey: problemMessageKey(problem),
    });
  }
  return {
    messageKey: problemMessageKey(problem),
    status: result.status,
    code: problem.code,
    retryAfterSeconds: retryAfterSeconds(result.retryAfter),
    fieldErrors,
  };
}

/**
 * A request that threw. A network failure and an unreadable answer are failures the shopper can retry; an abort and every
 * other error (a bug, `InvalidRequestError`) are rethrown, loud, never shown as a friendly message.
 */
export function failureFromThrown(error: unknown): Failure {
  if (error instanceof NetworkError && !error.aborted) {
    return {
      messageKey: transportErrorMessageKey("network"),
      status: null,
      code: null,
      retryAfterSeconds: null,
      fieldErrors: [],
    };
  }
  if (error instanceof InvalidResponseError) {
    return {
      messageKey: transportErrorMessageKey("invalidResponse"),
      status: error.status,
      code: null,
      retryAfterSeconds: null,
      fieldErrors: [],
    };
  }
  throw error;
}

/** A failure made on the client before a request (a blank required field, a quantity out of range). */
export function clientFailure(messageKey: string, fieldErrors: FieldFailure[] = []): Failure {
  return { messageKey, status: null, code: null, retryAfterSeconds: null, fieldErrors };
}

export type FocusTarget = { kind: "field"; path: string } | { kind: "summary" };

/**
 * Where keyboard focus goes after a failed submit: the first invalid field in PAGE order (`fieldOrder`, not the order of
 * the API's answer), else the error summary (a wrong password, a 429, a network failure).
 */
export function focusTarget(failure: Failure, fieldOrder: readonly string[]): FocusTarget {
  const invalid = new Set(failure.fieldErrors.map((error) => error.path));
  const path = fieldOrder.find((candidate) => invalid.has(candidate));
  return path === undefined ? { kind: "summary" } : { kind: "field", path };
}

/**
 * Blank required fields as a failure, so the form reports them like the server would, without a request. Text fields are
 * trimmed; a password is not (spaces are part of it), it only has to have a character.
 */
export function missingRequired(
  values: Readonly<Record<string, string>>,
  required: readonly string[],
): Failure | null {
  const fieldErrors: FieldFailure[] = [];
  for (const path of required) {
    const value = values[path] ?? "";
    const blank = /password/i.test(path) ? value === "" : value.trim() === "";
    if (blank) {
      fieldErrors.push({ path, code: "required", messageKey: fieldErrorMessageKey("required") });
    }
  }
  return fieldErrors.length === 0 ? null : clientFailure("errors.validation_failed", fieldErrors);
}

/** The message of a failure, with the wait of a 429 when the API gave one (`errors.retryAfter`, plural seconds). */
export function failureText(t: Translator, failure: Failure): string {
  const message = t(failure.messageKey);
  return failure.retryAfterSeconds === null
    ? message
    : `${message} ${t.plural("errors.retryAfter", failure.retryAfterSeconds)}`;
}

/** The slice of `document` that `focusAfterFailure` needs, so a test can pass a fake. */
export interface FocusDocument {
  getElementById(id: string): { focus(): void } | null;
}

/**
 * Moves keyboard focus after a failed submit: to the first invalid field when there is one (the field's own error is read
 * through `aria-describedby`), else to the error summary. Returns what it focused, `null` when the element is missing.
 */
export function focusAfterFailure(
  failure: Failure,
  fieldOrder: readonly string[],
  fieldIds: Readonly<Record<string, string>>,
  summary: { focus(): void } | null,
  doc: FocusDocument,
): FocusTarget | null {
  const target = focusTarget(failure, fieldOrder);
  if (target.kind === "field") {
    const element = doc.getElementById(fieldIds[target.path] ?? "");
    if (element !== null) {
      element.focus();
      return target;
    }
  }
  if (summary === null) return null;
  summary.focus();
  return { kind: "summary" };
}
