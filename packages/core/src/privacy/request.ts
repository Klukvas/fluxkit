/*
 * Privacy request statuses, transitions and due dates (ADR 0033 decision 9). Pure. The 30-day answer period and the
 * extension limit are engineering readings of GDPR Art. 12(3) (one month, extendable by two further months for complex or
 * numerous requests); the owner confirms them with a lawyer.
 * TODO(fluxkit): legal review of REQUEST_RESPONSE_DAYS and REQUEST_MAX_TOTAL_DAYS.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const PRIVACY_REQUEST_KINDS = Object.freeze(["export", "erasure"] as const);
export type PrivacyRequestKind = (typeof PRIVACY_REQUEST_KINDS)[number];

export const PRIVACY_REQUEST_SUBJECT_KINDS = Object.freeze(["customer", "email"] as const);
export type PrivacyRequestSubjectKind = (typeof PRIVACY_REQUEST_SUBJECT_KINDS)[number];

export const PRIVACY_REQUEST_CHANNELS = Object.freeze(["self_service", "admin"] as const);
export type PrivacyRequestChannel = (typeof PRIVACY_REQUEST_CHANNELS)[number];

export const PRIVACY_REQUEST_STATUSES = Object.freeze([
  "received",
  "in_progress",
  "completed",
  "rejected",
] as const);
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];

/** The due date of a request: this many days after it was received. */
export const REQUEST_RESPONSE_DAYS = 30;

/** The latest due date of a request, counted from when it was received, after any extensions. */
export const REQUEST_MAX_TOTAL_DAYS = 90;

const NOTE_MAX = 500;

function validDate(value: Date, what: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new RangeError(`The ${what} is not a valid date`);
  }
}

export function requestDueAt(receivedAt: Date): Date {
  validDate(receivedAt, "received time");
  return new Date(receivedAt.getTime() + REQUEST_RESPONSE_DAYS * DAY_MS);
}

export type ExtendDueDateInput = {
  readonly receivedAt: Date;
  readonly dueAt: Date;
  readonly extraDays: number;
  readonly reason: string;
};

export type ExtendDueDateResult =
  | { readonly ok: true; readonly dueAt: Date; readonly reason: string }
  | {
      readonly ok: false;
      readonly reason: "invalid_reason" | "invalid_days" | "extension_too_long";
    };

/** The owner may move the due date with a reason (1 to 500 characters, stored trimmed), never past `REQUEST_MAX_TOTAL_DAYS`. */
export function extendRequestDueAt(input: ExtendDueDateInput): ExtendDueDateResult {
  validDate(input.receivedAt, "received time");
  validDate(input.dueAt, "due time");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 1 || reason.length > NOTE_MAX) return { ok: false, reason: "invalid_reason" };
  if (!Number.isInteger(input.extraDays) || input.extraDays < 1)
    return { ok: false, reason: "invalid_days" };
  const dueAt = new Date(input.dueAt.getTime() + input.extraDays * DAY_MS);
  const limit = input.receivedAt.getTime() + REQUEST_MAX_TOTAL_DAYS * DAY_MS;
  if (dueAt.getTime() > limit) return { ok: false, reason: "extension_too_long" };
  return { ok: true, dueAt, reason };
}

const OPEN_TO: Readonly<Record<PrivacyRequestStatus, readonly PrivacyRequestStatus[]>> = {
  received: ["in_progress", "completed", "rejected"],
  in_progress: ["completed", "rejected"],
  completed: [],
  rejected: [],
};

export type RequestTransitionDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "request_closed" | "invalid_transition" };

function requireStatus(status: PrivacyRequestStatus): void {
  if (!PRIVACY_REQUEST_STATUSES.includes(status)) {
    throw new RangeError(`Unknown privacy request status: ${String(status)}`);
  }
}

/** A closed request (`completed`, `rejected`) answers `request_closed`; any other refused move is `invalid_transition`. */
export function decideRequestTransition(
  from: PrivacyRequestStatus,
  to: PrivacyRequestStatus,
): RequestTransitionDecision {
  requireStatus(from);
  requireStatus(to);
  if (OPEN_TO[from].length === 0) return { ok: false, reason: "request_closed" };
  return OPEN_TO[from].includes(to) ? { ok: true } : { ok: false, reason: "invalid_transition" };
}

/** An open request is overdue once `now` is past its due time (the due time itself is still in time). */
export function isRequestOverdue(
  request: { readonly status: PrivacyRequestStatus; readonly dueAt: Date },
  now: Date,
): boolean {
  requireStatus(request.status);
  return (
    (request.status === "received" || request.status === "in_progress") &&
    now.getTime() > request.dueAt.getTime()
  );
}
