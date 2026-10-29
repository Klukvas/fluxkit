import type { ErasureReason, ProblemDetails } from "@fluxkit/api-client";
import { describeProblem, type MessageDescriptor } from "../../lib/problem-messages";
import { retryAfterMinutes } from "../../lib/retry-after";

/**
 * How the Privacy screens explain what the API answered (`docs/api/privacy.md`). The API's English `detail` is never shown.
 * The refusals below belong to this area, so their messages live in its lazy file (`personal.refusal.*`, `personal.blocker.*`);
 * every other answer goes through the shell's problem map.
 */

/** The `rule` of a `409 rule_violation` of the privacy routes that gets its own explanation. */
export const PRIVACY_REFUSAL_RULES = [
  "erasure_blocked",
  "request_closed",
  "export_too_large",
  "subject_not_found",
  "not_an_erasure_request",
  // Shipment create and refresh on an order whose contact was erased (shown by the order detail, same wording rules).
  "contact_erased",
] as const;

/** The reasons of an erasure blocker, in the order the screens list them. */
export const ERASURE_REASONS = [
  "open_order",
  "payment_in_progress",
  "refund_in_progress",
  "active_shipment",
  "mail_sending",
] as const satisfies readonly ErasureReason[];

function isKnownReason(value: string): value is (typeof ERASURE_REASONS)[number] {
  return (ERASURE_REASONS as readonly string[]).includes(value);
}

/** The message of one blocker reason; a reason this build does not know is shown as such, never guessed. */
export function blockerReasonKey(reason: string): string {
  return isKnownReason(reason) ? `personal.blocker.${reason}` : "personal.blocker.unknown";
}

/**
 * The `reasons` member of an `erasure_blocked` answer. The typed client does not declare it (the problem type is shared by
 * every route), so it is read defensively: strings only, known reasons first in the documented order, unknown ones after
 * them (so a new reason is visible), no duplicates.
 */
export function readErasureReasons(problem: ProblemDetails): string[] {
  const raw = (problem as unknown as { reasons?: unknown }).reasons;
  if (!Array.isArray(raw)) return [];
  const strings = raw.filter((entry): entry is string => typeof entry === "string");
  const known = ERASURE_REASONS.filter((reason) => strings.includes(reason));
  const unknown = [...new Set(strings.filter((entry) => !isKnownReason(entry)))];
  return [...known, ...unknown];
}

export function describePrivacyProblem(
  status: number,
  problem: ProblemDetails,
  retryAfter: string | null,
): MessageDescriptor {
  if (status === 429 || problem.code === "too_many_requests") {
    const minutes = retryAfterMinutes(retryAfter);
    return minutes === null
      ? { key: "personal.refusal.rateLimited" }
      : { key: "personal.refusal.rateLimitedWait", values: { minutes } };
  }
  if (
    problem.code === "rule_violation" &&
    problem.rule !== undefined &&
    (PRIVACY_REFUSAL_RULES as readonly string[]).includes(problem.rule)
  ) {
    return { key: `personal.refusal.${problem.rule}` };
  }
  if (
    problem.code === "validation_failed" &&
    (problem.errors ?? []).some(
      (error) => error.path === "email" && error.code === "subject_mismatch",
    )
  ) {
    return { key: "personal.refusal.subject_mismatch" };
  }
  return describeProblem(status, problem);
}
