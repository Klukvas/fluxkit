import type { AdminSearchRebuild, ProblemDetails } from "@fluxkit/api-client";
import {
  describeFieldError,
  describeProblem,
  type MessageDescriptor,
  type ProblemLike,
} from "../../lib/problem-messages";
import type { WriteOutcome } from "../../lib/run-write";

/**
 * How the Search screens word what the API answered (`docs/api/search.md`, "Admin"). Pure. The API's English `detail` is
 * never shown; every text is a message of the shell's problem map or of the `search` file. The screens never repeat a
 * write by themselves: a lost answer is said as it is, and the admin looks at the status or the list again.
 */

/** A refusal of a search route: every code goes through the shell's map (`search_unavailable` is in it). */
export function describeSearchProblem(status: number, problem: ProblemLike): MessageDescriptor {
  return describeProblem(status, problem);
}

/** What the status screen says after the rebuild action. */
export type RebuildNotice =
  | { kind: "idle" }
  /** `202`: recorded for every locale; job 14 builds, nothing is rebuilt yet. */
  | { kind: "requested"; requestedAt: string; locales: string[] }
  | { kind: "off" }
  | { kind: "forbidden" }
  | { kind: "refused"; descriptor: MessageDescriptor }
  /** No answer: the request may or may not be recorded (it is idempotent, but this screen sends it once). */
  | { kind: "unknown" };

export function rebuildNotice(outcome: WriteOutcome<AdminSearchRebuild>): RebuildNotice {
  switch (outcome.kind) {
    case "ok":
      return {
        kind: "requested",
        requestedAt: outcome.data.requestedAt,
        locales: outcome.data.locales,
      };
    case "problem":
      if (outcome.status === 404) return { kind: "off" };
      if (outcome.status === 403) return { kind: "forbidden" };
      return {
        kind: "refused",
        descriptor: describeSearchProblem(outcome.status, outcome.problem),
      };
    case "unknown":
      return { kind: "unknown" };
    case "aborted":
      return { kind: "idle" };
  }
}

/**
 * Field error codes of the synonym routes (`terms`: `not_a_list`, `too_few_terms`, `too_many_terms`, `invalid_term`,
 * `duplicate_terms`) that get a message of their own; the rest (`invalid_value` on `locale`, `required`, ...) go through the
 * shell's map.
 */
export const SYNONYM_FIELD_CODES = [
  "not_a_list",
  "too_few_terms",
  "too_many_terms",
  "invalid_term",
  "duplicate_terms",
] as const;

export function describeSynonymFieldCode(code: string): MessageDescriptor {
  return (SYNONYM_FIELD_CODES as readonly string[]).includes(code)
    ? { key: `search.synonyms.error.${code}` }
    : describeFieldError(code);
}

export interface SynonymFieldErrors {
  terms?: MessageDescriptor;
  locale?: MessageDescriptor;
  /** What has no field of the form. */
  other: MessageDescriptor[];
}

/** A `400` of the synonym routes on the form's fields; nothing is dropped. */
export function synonymFieldErrors(problem: ProblemDetails, status: number): SynonymFieldErrors {
  const found: SynonymFieldErrors = { other: [] };
  if (problem.errors === undefined || problem.errors.length === 0) {
    found.other.push(describeSearchProblem(status, problem));
    return found;
  }
  for (const error of problem.errors) {
    const descriptor = describeSynonymFieldCode(error.code);
    if (error.path === "terms") found.terms ??= descriptor;
    else if (error.path === "locale") found.locale ??= descriptor;
    else found.other.push(descriptor);
  }
  return found;
}

export type SynonymAction = "create" | "update" | "delete";

export type SynonymOutcome =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "fields"; errors: SynonymFieldErrors }
  /** `404` of an update or delete: the group does not exist (any more). The list is read again. */
  | { kind: "gone" }
  /** `404` of the create route: search is switched off. */
  | { kind: "off" }
  | { kind: "forbidden" }
  | { kind: "refused"; descriptor: MessageDescriptor }
  | { kind: "unknown" };

export function synonymOutcome(
  action: SynonymAction,
  outcome: WriteOutcome<unknown>,
): SynonymOutcome {
  switch (outcome.kind) {
    case "ok":
      return { kind: "saved" };
    case "problem":
      if (outcome.status === 400) {
        return { kind: "fields", errors: synonymFieldErrors(outcome.problem, outcome.status) };
      }
      if (outcome.status === 404) return action === "create" ? { kind: "off" } : { kind: "gone" };
      if (outcome.status === 403) return { kind: "forbidden" };
      return {
        kind: "refused",
        descriptor: describeSearchProblem(outcome.status, outcome.problem),
      };
    case "unknown":
      return { kind: "unknown" };
    case "aborted":
      return { kind: "idle" };
  }
}
