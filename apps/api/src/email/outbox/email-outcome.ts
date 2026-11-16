import {
  decideEmailTransition,
  EMAIL_CODE_PATTERN,
  isPastEmailDeadline,
  emailRetryDeadline,
  type EmailProviderCapabilities,
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
  | { readonly to: "failed" | "unknown"; readonly lastErrorCode: string };

/**
 * A due row the claim locked: a `pending` row is claimed (`sending`), and so is a `sending` row whose lease expired (the
 * explicit `sending -> sending` transition: attempts + 1, the same idempotency key). At or past its deadline nothing is
 * sent: a `pending` row fails (`deadline_passed`); a `sending` row becomes `unknown`, because the attempt that crashed
 * under the expired lease may have reached the provider.
 */
export function decideEmailClaim(input: {
  readonly status: EmailMessageStatus;
  readonly pinnedAt?: Date | null;
  readonly capabilities?: EmailProviderCapabilities;
  readonly deadlineAt: Date;
  readonly now: Date;
}): EmailClaimDecision {
  const { status } = input;
  if (status !== "pending" && status !== "sending") {
    throw new RangeError(`A ${status} mail is never claimed`);
  }
  if (isPastEmailDeadline(input.now, input.deadlineAt)) {
    const to = status === "pending" && input.pinnedAt == null ? "failed" : "unknown";
    assertAllowed(status, to);
    return { to, lastErrorCode: DEADLINE_PASSED_CODE };
  }
  if (input.pinnedAt != null) {
    const code =
      input.capabilities?.idempotencyKeys === false
        ? "idempotency_unprotected"
        : isPastEmailDeadline(
              input.now,
              emailRetryDeadline(input.deadlineAt, input.pinnedAt, input.capabilities),
            )
          ? "idempotency_window_expired"
          : null;
    if (code !== null) {
      assertAllowed(status, "unknown");
      return { to: "unknown", lastErrorCode: code };
    }
  }
  assertAllowed(status, "sending");
  return { to: "sending" };
}

/** How one attempt ended, from the sender's side. */
export type EmailAttemptOutcome =
  | { readonly kind: "sent"; readonly providerMessageId: string }
  /** Shared recipient block; this attempt never reaches a provider. Earlier acceptance still takes precedence. */
  | { readonly kind: "suppressed" }
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
  readonly pinnedAt?: Date | null;
  readonly capabilities?: EmailProviderCapabilities;
}): EmailRecordDecision {
  const { outcome } = input;
  switch (outcome.kind) {
    case "suppressed": {
      const status = input.pinnedAt == null ? "failed" : "unknown";
      assertAllowed("sending", status);
      return { status, lastErrorCode: "suppressed" };
    }
    case "sent":
      assertAllowed("sending", "sent");
      return {
        status: "sent",
        providerMessageId: outcome.providerMessageId,
        sentAt: input.now,
        lastErrorCode: null,
      };
    case "not_renderable": {
      const status = input.pinnedAt == null ? "failed" : "unknown";
      assertAllowed("sending", status);
      return { status, lastErrorCode: outcome.code };
    }
    case "provider_failed": {
      const next = nextEmailAttempt({
        attempts: input.attempts,
        failure: outcome.failure,
        now: input.now,
        deadlineAt: input.deadlineAt,
        pinnedAt: input.pinnedAt,
        capabilities: input.capabilities,
      });
      assertAllowed("sending", next.status);
      const code = failureCode(outcome.failure);
      if (next.status === "pending") {
        return { status: "pending", nextAttemptAt: next.nextAttemptAt, lastErrorCode: code };
      }
      if (
        next.cause === "deadline_passed" ||
        next.cause === "idempotency_window_expired" ||
        next.cause === "idempotency_unprotected"
      ) {
        return { status: next.status, lastErrorCode: next.cause };
      }
      return { status: next.status, lastErrorCode: code };
    }
  }
}
