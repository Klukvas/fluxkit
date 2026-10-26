/*
 * The status machine of an outbox mail (`email_message.status`, ADR 0031 decisions 5 to 8). The transition table is
 * data, like `ORDER_TRANSITIONS` and `SHIPMENT_TRANSITIONS`; `decideEmailTransition` is the only way a status changes.
 * `sent` means accepted by the provider, not delivered. An unknown status or actor is corrupt data or a bug (RangeError).
 */

export const EMAIL_MESSAGE_STATUSES = Object.freeze([
  /** Waiting for its next attempt (`next_attempt_at`). */
  "pending",
  /** Claimed by a sender under a lease (`lease_until`); a crashed sender's row is claimed again after the lease. */
  "sending",
  /** Accepted by the provider (`provider_message_id`). */
  "sent",
  /** Refused by the provider, past its deadline, or not renderable (`last_error_code`). */
  "failed",
  /** The provider may or may not have sent it (an idempotency conflict): never retried automatically. */
  "unknown",
  /** Cancelled by an admin while pending. */
  "cancelled",
] as const);

export type EmailMessageStatus = (typeof EMAIL_MESSAGE_STATUSES)[number];

/** `system` is a handler, an auth flow, the sender or job 9; `admin` acts through an admin route (resend, test, cancel). */
export const EMAIL_MESSAGE_ACTORS = Object.freeze(["system", "admin"] as const);

export type EmailMessageActor = (typeof EMAIL_MESSAGE_ACTORS)[number];

export interface EmailTransitionRule {
  /** `null` is the creation of the row. */
  readonly from: EmailMessageStatus | null;
  readonly to: EmailMessageStatus;
  readonly actors: readonly EmailMessageActor[];
}

function rule(
  from: EmailMessageStatus | null,
  to: EmailMessageStatus,
  actors: readonly EmailMessageActor[],
): EmailTransitionRule {
  return Object.freeze({ from, to, actors: Object.freeze([...actors]) });
}

/**
 * Every allowed transition; everything else is refused. A mail is created `pending` (by the system, or by an admin's
 * resend or test send). The claim moves `pending` to `sending`, and `sending` to `sending` again when the previous
 * claim's lease expired (attempts + 1, the same idempotency key). The record moves `sending` to `sent`, back to
 * `pending` (retry), to `failed` or to `unknown`. A claim that finds a `pending` row past its deadline fails it. An admin
 * cancels only a `pending` mail. `sent`, `failed`, `unknown` and `cancelled` have no way out: a resend is a new row.
 */
export const EMAIL_MESSAGE_TRANSITIONS: readonly EmailTransitionRule[] = Object.freeze([
  rule(null, "pending", ["system", "admin"]),
  rule("pending", "sending", ["system"]),
  rule("sending", "sending", ["system"]),
  rule("sending", "sent", ["system"]),
  rule("sending", "pending", ["system"]),
  rule("sending", "failed", ["system"]),
  rule("sending", "unknown", ["system"]),
  rule("pending", "failed", ["system"]),
  rule("pending", "cancelled", ["admin"]),
]);

export type EmailTransitionDecision =
  | { readonly ok: true; readonly from: EmailMessageStatus | null; readonly to: EmailMessageStatus }
  | { readonly ok: false; readonly reason: "invalid_transition" | "not_allowed_for_actor" };

function assertStatus(value: unknown): asserts value is EmailMessageStatus {
  if (!EMAIL_MESSAGE_STATUSES.includes(value as EmailMessageStatus)) {
    throw new RangeError(`Unknown email message status: ${String(value)}`);
  }
}

function assertActor(value: unknown): asserts value is EmailMessageActor {
  if (!EMAIL_MESSAGE_ACTORS.includes(value as EmailMessageActor)) {
    throw new RangeError(`Unknown email message actor: ${String(value)}`);
  }
}

/** `from` is `null` for the creation of the row. A pair outside the table is `invalid_transition`, whoever asks. */
export function decideEmailTransition(
  from: EmailMessageStatus | null,
  to: EmailMessageStatus,
  actor: EmailMessageActor,
): EmailTransitionDecision {
  if (from !== null) {
    assertStatus(from);
  }
  assertStatus(to);
  assertActor(actor);
  const found = EMAIL_MESSAGE_TRANSITIONS.find((entry) => entry.from === from && entry.to === to);
  if (found === undefined) {
    return Object.freeze({ ok: false as const, reason: "invalid_transition" as const });
  }
  if (!found.actors.includes(actor)) {
    return Object.freeze({ ok: false as const, reason: "not_allowed_for_actor" as const });
  }
  return Object.freeze({ ok: true as const, from, to });
}

/** No transition leaves a final status. */
export function isFinalEmailStatus(status: EmailMessageStatus): boolean {
  assertStatus(status);
  return !EMAIL_MESSAGE_TRANSITIONS.some((entry) => entry.from === status);
}

/**
 * Days a final mail is kept after its last change before job 10 deletes it (ADR 0031 decision 8): 30 days, `failed`
 * and `unknown` 90 days for the operator.
 */
export const EMAIL_RETENTION_DAYS = Object.freeze({
  sent: 30,
  cancelled: 30,
  failed: 90,
  unknown: 90,
} as const satisfies Partial<Record<EmailMessageStatus, number>>);

/** The retention of a final status; `null` for an open one (`pending`, `sending`), which is never purged. */
export function emailRetentionDays(status: EmailMessageStatus): number | null {
  assertStatus(status);
  return Object.hasOwn(EMAIL_RETENTION_DAYS, status)
    ? EMAIL_RETENTION_DAYS[status as keyof typeof EMAIL_RETENTION_DAYS]
    : null;
}
