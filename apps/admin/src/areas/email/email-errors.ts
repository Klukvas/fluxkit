import type { ProblemDetails } from "@fluxkit/api-client";
import { describeProblem, type MessageDescriptor } from "../../lib/problem-messages";
import { retryAfterMinutes } from "../../lib/retry-after";

/**
 * How the Email screens explain what the API answered (`docs/api/email.md`). The API's English `detail` is never shown.
 * The refusals below are specific to email, so their messages live in this area's lazy file (`mail.refusal.*`); every
 * other answer goes through the shell's problem map.
 */

/** The `rule` of a `409 rule_violation` (or `invalid_transition`) of the test, resend and cancel routes. */
export const EMAIL_REFUSAL_RULES = [
  // test send and resend
  "email_not_configured",
  "address_undeliverable",
  // resend
  "message_open",
  "not_resendable",
  "template_unavailable",
  "variables_invalid",
  // cancel
  "not_pending",
] as const;

export function describeEmailProblem(
  status: number,
  problem: ProblemDetails,
  retryAfter: string | null,
): MessageDescriptor {
  if (status === 429 || problem.code === "too_many_requests") {
    const minutes = retryAfterMinutes(retryAfter);
    return minutes === null
      ? { key: "mail.refusal.rateLimited" }
      : { key: "mail.refusal.rateLimitedWait", values: { minutes } };
  }
  if (
    (problem.code === "rule_violation" || problem.code === "invalid_transition") &&
    problem.rule !== undefined &&
    (EMAIL_REFUSAL_RULES as readonly string[]).includes(problem.rule)
  ) {
    return { key: `mail.refusal.${problem.rule}` };
  }
  return describeProblem(status, problem);
}
