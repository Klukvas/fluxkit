import {
  decideEmailTransition,
  EMAIL_CODE_PATTERN,
  isPastEmailDeadline,
  nextEmailAttempt,
  type EmailMessageStatus,
  type EmailProviderFailure,
} from "@fluxkit/core";

/*
 * The decisions of the outbox writer (ADR 0031 decisions 6 and 7), pure so they are tested without a database: what a
 * claim does with a due row, and what the record step writes after an attempt. Every status they answer is checked
 * against core `decideEmailTransition` (actor `system`); a pair the table refuses is a bug and throws.
 */

/** `last_error_code` of a mail that reached or passed its deadline without being sent. */
export const DEADLINE_PASSED_CODE = "deadline_passed";

/** Why a claimed mail could not be handed to the provider (`last_error_code`, the mail is `failed`). */
export type NotRenderableCode =
  /** No registered template for the key, or a newer version after an earlier attempt (the body would change). */
  | "template_unavailable"
  /** The stored variables no longer pass the template's schema. */
  | "variables_invalid"
  /** The template threw or its output broke the render checks (blank subject, text or HTML). */
  | "render_failed"
  /** The rendered mail failed `validateOutgoingEmail` (for example an address the configuration let through). */
  | "message_invalid";

function assertAllowed(from: EmailMessageStatus, to: EmailMessageStatus): void {
  const decision = decideEmailTransition(from, to, "system");
  if (!decision.ok) {
    throw new RangeError(
      `The outbox may not move a mail from ${from} to ${to}: ${decision.reason}`,
    );
  }
}

export type EmailClaimDecision =
  | { readonly to: "sending" }
  | { readonly to: "failed" | "unknown"; readonly lastErrorCode: typeof DEADLINE_PASSED_CODE };

/**
 * A due row the claim locked: a `pending` row is claimed (`sending`), and so is a `sending` row whose lease expired (the
 * explicit `sending -> sending` transition: attempts + 1, the same idempotency key). At or past its deadline nothing is
 * sent: a `pending` row fails (`deadline_passed`); a `sending` row becomes `unknown`, because the attempt that crashed
 * under the expired lease may have reached the provider.
 */
export function decideEmailClaim(input: {
  readonly status: EmailMessageStatus;
  readonly deadlineAt: Date;
  readonly now: Date;
}): EmailClaimDecision {
  const { status } = input;
  if (status !== "pending" && status !== "sending") {
    throw new RangeError(`A ${status} mail is never claimed`);
  }
  if (isPastEmailDeadline(input.now, input.deadlineAt)) {
    const to = status === "pending" ? "failed" : "unknown";
    assertAllowed(status, to);
    return { to, lastErrorCode: DEADLINE_PASSED_CODE };
  }
  assertAllowed(status, "sending");
  return { to: "sending" };
}

/** How one attempt ended, from the sender's side. */
export type EmailAttemptOutcome =
  | { readonly kind: "sent"; readonly providerMessageId: string }
  /** A typed failure, or a timeout or thrown error mapped to `unavailable` (it may have sent). */
  | { readonly kind: "provider_failed"; readonly failure: EmailProviderFailure }
  | { readonly kind: "not_renderable"; readonly code: NotRenderableCode };

export type EmailRecordDecision =
  | {
      readonly status: "sent";
      readonly providerMessageId: string;
      readonly sentAt: Date;
      readonly lastErrorCode: null;
    }
  | { readonly status: "pending"; readonly nextAttemptAt: Date; readonly lastErrorCode: string }
  | { readonly status: "failed" | "unknown"; readonly lastErrorCode: string };

/**
 * `last_error_code` of a provider failure: the reason, followed by `:` and the first provider code when the pair still
 * matches `EMAIL_CODE_PATTERN` (`rejected:validation_error`). Codes only: never a message text.
 */
export function failureCode(failure: EmailProviderFailure): string {
  const first = failure.providerCodes[0];
  const withCode = first === undefined ? failure.reason : `${failure.reason}:${first}`;
  return EMAIL_CODE_PATTERN.test(withCode) ? withCode : failure.reason;
}

/**
 * What the record step writes for the claimed attempt number `attempts` (ADR 0031 decision 6, the reasons-to-status
 * table): `sent` with the provider id; a provider failure through core `nextEmailAttempt` (retry schedule,
 * `retry-after`, quotas, the deadline cut, `rejected` failed at once, an idempotency conflict `unknown` and never
 * retried); a mail that could not be rendered `failed` at once.
 */
export function decideEmailRecord(input: {
  readonly attempts: number;
  readonly deadlineAt: Date;
  readonly now: Date;
  readonly outcome: EmailAttemptOutcome;
}): EmailRecordDecision {
  const { outcome } = input;
  switch (outcome.kind) {
    case "sent":
      assertAllowed("sending", "sent");
      return {
        status: "sent",
        providerMessageId: outcome.providerMessageId,
        sentAt: input.now,
        lastErrorCode: null,
      };
    case "not_renderable":
      assertAllowed("sending", "failed");
      return { status: "failed", lastErrorCode: outcome.code };
    case "provider_failed": {
      const next = nextEmailAttempt({
        attempts: input.attempts,
        failure: outcome.failure,
        now: input.now,
        deadlineAt: input.deadlineAt,
      });
      assertAllowed("sending", next.status);
      const code = failureCode(outcome.failure);
      if (next.status === "pending") {
        return { status: "pending", nextAttemptAt: next.nextAttemptAt, lastErrorCode: code };
      }
      if (next.status === "failed" && next.cause === "deadline_passed") {
        return { status: "failed", lastErrorCode: DEADLINE_PASSED_CODE };
      }
      return { status: next.status, lastErrorCode: code };
    }
  }
}
