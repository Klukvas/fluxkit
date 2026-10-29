import type {
  DeleteAccountBody,
  PersonalDataExport,
  ProblemDetails,
  StoreFailure,
} from "@fluxkit/api-client";
import { failureFromResult, retryAfterSeconds, type Failure } from "./failure";

/**
 * Pure rules of the "Your data" page (privacy plan step 10): how an export or a deletion answer becomes something to show,
 * the file the export is saved as, and the typed word of the deletion form. No I/O and no text: results are message keys and
 * numbers (`account.data.*`, `errors.*`), so the views translate and the API's English `detail` never travels further.
 */

/** A wait for a rate limit: whole minutes up to an hour, else whole hours (rounded up, so the shopper never retries too early). */
export interface WaitParts {
  unit: "minutes" | "hours";
  count: number;
}

export function waitParts(seconds: number | null): WaitParts | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 1) return null;
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 60
    ? { unit: "minutes", count: minutes }
    : { unit: "hours", count: Math.ceil(seconds / 3600) };
}

export type ExportFailure =
  | { kind: "signed_out" }
  | { kind: "rate_limited"; wait: WaitParts | null }
  | { kind: "too_large" }
  | { kind: "other"; failure: Failure };

/** `GET /store/account/data-export` refusals: 401, 429 (5 a day, with `Retry-After`), 409 `export_too_large`. */
export function mapExportFailure(result: StoreFailure): ExportFailure {
  if (result.status === 401) return { kind: "signed_out" };
  if (result.status === 429 || result.problem.code === "too_many_requests") {
    return { kind: "rate_limited", wait: waitParts(retryAfterSeconds(result.retryAfter)) };
  }
  if (result.problem.code === "rule_violation" && result.problem.rule === "export_too_large") {
    return { kind: "too_large" };
  }
  return { kind: "other", failure: failureFromResult(result) };
}

/** The reasons an erasure can be blocked, in the order they are listed (`docs/api/privacy.md`). */
export const BLOCK_REASONS = [
  "open_order",
  "payment_in_progress",
  "refund_in_progress",
  "active_shipment",
  "mail_sending",
] as const;

function isKnownReason(value: string): boolean {
  return (BLOCK_REASONS as readonly string[]).includes(value);
}

export function blockReasonKey(reason: string): string {
  return isKnownReason(reason) ? `account.data.blocked.${reason}` : "account.data.blocked.unknown";
}

/**
 * The `reasons` member of an `erasure_blocked` answer. The typed client does not declare it (the problem type is shared by
 * every route), so it is read defensively: strings only, known reasons first in the documented order, unknown ones last (a
 * new reason stays visible), no duplicates.
 */
export function readBlockReasons(problem: ProblemDetails): string[] {
  const raw = (problem as unknown as { reasons?: unknown }).reasons;
  if (!Array.isArray(raw)) return [];
  const strings = raw.filter((entry): entry is string => typeof entry === "string");
  const known = BLOCK_REASONS.filter((reason) => strings.includes(reason));
  const unknown = [...new Set(strings.filter((entry) => !isKnownReason(entry)))];
  return [...known, ...unknown];
}

export type DeleteFailure =
  | { kind: "signed_out" }
  | { kind: "rate_limited"; wait: WaitParts | null }
  | { kind: "blocked"; reasons: string[] }
  /** Anything else, including a wrong password (a field error on `password`). */
  | { kind: "other"; failure: Failure };

export const WRONG_PASSWORD_KEY = "account.data.delete.wrongPassword";

/** `POST /store/account/delete` refusals: 400 (a wrong password is a field error), 401, 409 `erasure_blocked`, 429. */
export function mapDeleteFailure(result: StoreFailure): DeleteFailure {
  if (result.status === 401) return { kind: "signed_out" };
  if (result.status === 429 || result.problem.code === "too_many_requests") {
    return { kind: "rate_limited", wait: waitParts(retryAfterSeconds(result.retryAfter)) };
  }
  if (result.problem.code === "rule_violation" && result.problem.rule === "erasure_blocked") {
    return { kind: "blocked", reasons: readBlockReasons(result.problem) };
  }
  const failure = failureFromResult(result);
  return {
    kind: "other",
    failure: {
      ...failure,
      fieldErrors: failure.fieldErrors.map((error) =>
        error.path === "password" && error.code === "incorrect"
          ? { ...error, messageKey: WRONG_PASSWORD_KEY }
          : error,
      ),
    },
  };
}

/** The body of the deletion: the password exactly as typed (spaces are part of it) and the explicit confirmation. */
export function deleteBody(password: string): DeleteAccountBody {
  return { password, confirm: true };
}

/** The typed word of the deletion form: equal to the shown word, ignoring case and surrounding spaces. */
export function confirmationMatches(typed: string, expected: string): boolean {
  const word = expected.trim().normalize("NFC").toLocaleLowerCase();
  if (word === "") return false;
  return typed.trim().normalize("NFC").toLocaleLowerCase() === word;
}

/** The media type of the saved file: the export is JSON (`docs/contracts/personal-data-export.md`). */
export const EXPORT_CONTENT_TYPE = "application/json";

/** `personal-data-<UTC date>.json`, like the API's own `Content-Disposition`. */
export function exportFileName(document: Pick<PersonalDataExport, "generatedAt">): string {
  const day = /^(\d{4}-\d{2}-\d{2})T/.exec(document.generatedAt)?.[1];
  return day === undefined ? "personal-data.json" : `personal-data-${day}.json`;
}

export function exportBlob(document: PersonalDataExport): Blob {
  return new Blob([`${JSON.stringify(document, null, 2)}\n`], { type: EXPORT_CONTENT_TYPE });
}
