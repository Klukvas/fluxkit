/*
 * The admin audit event (ADR 0033 decision 9): what an admin did to personal data or to an account, never the data
 * itself. The action list is closed; the target is a kind and a uuid; the detail holds codes, counts and flags only, so an
 * audit row can survive the erasure of the person it is about. Reads of customer or order details are not logged in v1.
 */

export const ADMIN_AUDIT_ACTIONS = Object.freeze([
  "customer.deactivated",
  "customer.activated",
  "customer.unlocked",
  "admin_user.created",
  "admin_user.role_changed",
  "admin_user.deactivated",
  "admin_user.password_reset",
  "privacy.lookup",
  "privacy.exported",
  "privacy.erased",
  "privacy.request_changed",
] as const);

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

export const ADMIN_AUDIT_TARGET_KINDS = Object.freeze([
  "customer",
  "order",
  "admin_user",
  "privacy_request",
] as const);

export type AdminAuditTargetKind = (typeof ADMIN_AUDIT_TARGET_KINDS)[number];

/** The detail, serialized as JSON, is at most this many bytes (it is ASCII by construction). */
export const ADMIN_AUDIT_DETAIL_MAX_BYTES = 2048;

/** A detail value that is a word-like code: lower case, digits and `_ . : -`, 1 to 64 characters. No space, no `@`, no capitals. */
const CODE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;
const KEY = /^[a-z][A-Za-z0-9]{0,31}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AuditDetailValue = number | boolean | string | readonly string[];
export type AuditDetail = Readonly<Record<string, AuditDetailValue>>;

export interface AdminAuditEvent {
  readonly action: AdminAuditAction;
  readonly targetKind: AdminAuditTargetKind;
  readonly targetId: string;
  readonly detail: AuditDetail;
}

export function isAdminAuditAction(value: unknown): value is AdminAuditAction {
  return typeof value === "string" && (ADMIN_AUDIT_ACTIONS as readonly string[]).includes(value);
}

function checkValue(key: string, value: unknown): AuditDetailValue {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) return value;
    throw new RangeError(`Audit detail "${key}" must be a non-negative safe integer`);
  }
  if (typeof value === "string") {
    if (CODE.test(value)) return value;
    throw new RangeError(`Audit detail "${key}" must be a lower-case code, never free text`);
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((entry) => {
        if (typeof entry === "string" && CODE.test(entry)) return entry;
        throw new RangeError(`Audit detail "${key}" must list lower-case codes only`);
      }),
    );
  }
  throw new RangeError(`Audit detail "${key}" must be a code, a count, a flag or a list of codes`);
}

/**
 * Validates and freezes an audit event. Anything that could carry personal data (an email, a name, a phone number, a
 * sentence, a nested object) is a RangeError: the caller has a bug, and the message names the key, never the value.
 */
export function buildAdminAuditEvent(input: {
  readonly action: AdminAuditAction;
  readonly targetKind: AdminAuditTargetKind;
  readonly targetId: string;
  readonly detail?: AuditDetail;
}): AdminAuditEvent {
  if (!isAdminAuditAction(input.action)) {
    throw new RangeError("Unknown admin audit action");
  }
  if (!ADMIN_AUDIT_TARGET_KINDS.includes(input.targetKind)) {
    throw new RangeError("Unknown admin audit target kind");
  }
  if (typeof input.targetId !== "string" || !UUID.test(input.targetId)) {
    throw new RangeError("An admin audit target is identified by a uuid");
  }
  const detail: Record<string, AuditDetailValue> = {};
  for (const [key, value] of Object.entries(input.detail ?? {})) {
    if (!KEY.test(key)) {
      throw new RangeError("An audit detail key is a short camelCase word");
    }
    detail[key] = checkValue(key, value);
  }
  if (JSON.stringify(detail).length > ADMIN_AUDIT_DETAIL_MAX_BYTES) {
    throw new RangeError(
      `An audit detail is at most ${String(ADMIN_AUDIT_DETAIL_MAX_BYTES)} bytes`,
    );
  }
  return Object.freeze({
    action: input.action,
    targetKind: input.targetKind,
    targetId: input.targetId,
    detail: Object.freeze(detail),
  });
}
