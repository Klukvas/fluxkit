import type {
  AdminPrivacyRequest,
  CreatePrivacyRequestBody,
  ExportPrivacyRequestBody,
  OrderStatus,
  PersonalDataExport,
  PrivacyRequestKind,
  PrivacyRequestStatus,
} from "@fluxkit/api-client";
import type { StatusTone } from "@fluxkit/ui";

/** Pure rules of the Privacy screens: what to offer, how to word an outcome, the file of an export. No I/O. */

export const REQUEST_STATUSES = [
  "received",
  "in_progress",
  "completed",
  "rejected",
] as const satisfies readonly PrivacyRequestStatus[];

export const REQUEST_STATUS_TONES: Record<PrivacyRequestStatus, StatusTone> = {
  received: "warning",
  in_progress: "warning",
  completed: "success",
  rejected: "neutral",
};

export function statusLabelKey(status: PrivacyRequestStatus): string {
  return `personal.status.${status}`;
}

export function kindLabelKey(kind: PrivacyRequestKind): string {
  return `personal.kind.${kind}`;
}

/** The badge of an order status in the lookup's list of guest orders (the same tones as the orders area). */
export const ORDER_STATUS_TONES: Record<OrderStatus, StatusTone> = {
  awaiting_payment: "warning",
  paid: "success",
  fulfilled: "neutral",
  cancelled: "danger",
  expired: "neutral",
};

/** The message of an order status (the orders file, loaded with this area): the lookup lists the guest orders. */
export function orderStatusKey(status: string): string {
  return `order.status.${status}`;
}

export function isOpen(request: Pick<AdminPrivacyRequest, "status">): boolean {
  return request.status === "received" || request.status === "in_progress";
}

export type RequestAction = "export" | "erase" | "reject";

/**
 * Which buttons the request detail offers: only to an admin who may manage privacy, only for an open request, and erase only
 * for an erasure request. The API checks again (`request_closed`, `not_an_erasure_request`).
 */
export function offeredRequestActions(
  request: Pick<AdminPrivacyRequest, "status" | "kind">,
  canManage: boolean,
): RequestAction[] {
  if (!canManage || !isOpen(request)) return [];
  return request.kind === "erasure" ? ["export", "erase", "reject"] : ["export", "reject"];
}

export type ErasureOutcome =
  | { kind: "erased"; orders: number | null; mail: number | null; accountDeleted: boolean | null }
  | { kind: "not_completed" };

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * What an erase answer allows the screen to say. Only a request the API reports as `completed` is "erased"; the numbers
 * come from its stored result and are left out (`null`) when they are not there, never guessed.
 */
export function erasureOutcome(request: AdminPrivacyRequest): ErasureOutcome {
  if (request.status !== "completed") return { kind: "not_completed" };
  const result = request.result;
  const deleted = result?.["customerDeleted"];
  return {
    kind: "erased",
    orders: count(result?.["ordersAnonymised"]),
    mail: count(result?.["mailDeleted"]),
    accountDeleted: typeof deleted === "boolean" ? deleted : null,
  };
}

export type ResultValue = string | number | boolean | string[];

export interface ResultRow {
  id: string;
  labelKey: string;
  value: ResultValue;
}

/** The members of a request's stored `result` the screen shows, in a fixed order (counts, flags, order numbers). */
const RESULT_MEMBERS = [
  "orders",
  "mail",
  "sessions",
  "ordersAnonymised",
  "mailDeleted",
  "customerDeleted",
  "orderNumbers",
  "rejectReason",
] as const;

export function resultRows(result: AdminPrivacyRequest["result"]): ResultRow[] {
  if (result === null) return [];
  const rows: ResultRow[] = [];
  for (const id of RESULT_MEMBERS) {
    const value = result[id];
    if (value !== undefined) rows.push({ id, labelKey: `personal.result.${id}`, value });
  }
  return rows;
}

/** The typed word of the erase dialog: equal to the shown word, ignoring case and surrounding spaces. */
export function confirmationMatches(typed: string, expected: string): boolean {
  const word = expected.trim().normalize("NFC").toLocaleLowerCase();
  if (word === "") return false;
  return typed.trim().normalize("NFC").toLocaleLowerCase() === word;
}

const EMAIL_MAX_LENGTH = 254;

/** A shape check only (the API decides); it keeps an obvious slip from costing a request. */
function looksLikeEmail(text: string): boolean {
  return text.length <= EMAIL_MAX_LENGTH && /^[^\s@]+@[^\s@]+$/.test(text);
}

export type BodyIssue = "email_required" | "email_invalid";

/** The address as the routes will take it (trimmed), or why it is not sent. */
export function checkEmail(
  text: string,
): { ok: true; email: string } | { ok: false; reason: BodyIssue } {
  const email = text.trim();
  if (email === "") return { ok: false, reason: "email_required" };
  if (!looksLikeEmail(email)) return { ok: false, reason: "email_invalid" };
  return { ok: true, email };
}

/**
 * The body of the export, preview and erase calls. An email subject stores only a hash, so the address is typed again and
 * sent in the body (never in a URL); a customer subject sends nothing.
 */
export function exportBody(
  request: Pick<AdminPrivacyRequest, "subjectKind">,
  typedEmail: string,
): { ok: true; body: ExportPrivacyRequestBody } | { ok: false; reason: BodyIssue } {
  if (request.subjectKind === "customer") return { ok: true, body: {} };
  const email = typedEmail.trim();
  if (email === "") return { ok: false, reason: "email_required" };
  if (!looksLikeEmail(email)) return { ok: false, reason: "email_invalid" };
  return { ok: true, body: { email } };
}

/** Longest note the API takes (`privacy_request.note`). */
export const NOTE_MAX_LENGTH = 500;

export interface CreateRequestForm {
  kind: PrivacyRequestKind;
  subject: "account" | "address";
  /** The id of the account the lookup found, or `null`. */
  customerId: string | null;
  email: string;
  note: string;
}

export type CreateRequestIssue =
  "account_missing" | "email_required" | "email_invalid" | "note_too_long";

export function createRequestBody(
  form: CreateRequestForm,
): { ok: true; body: CreatePrivacyRequestBody } | { ok: false; reason: CreateRequestIssue } {
  const note = form.note.trim();
  if (note.length > NOTE_MAX_LENGTH) return { ok: false, reason: "note_too_long" };
  const noteMember = note === "" ? {} : { note };
  if (form.subject === "account") {
    if (form.customerId === null) return { ok: false, reason: "account_missing" };
    return {
      ok: true,
      body: { kind: form.kind, subject: { customerId: form.customerId }, ...noteMember },
    };
  }
  const email = form.email.trim();
  if (email === "") return { ok: false, reason: "email_required" };
  if (!looksLikeEmail(email)) return { ok: false, reason: "email_invalid" };
  return { ok: true, body: { kind: form.kind, subject: { email }, ...noteMember } };
}

/** The media type of the downloaded file: the export is JSON (`docs/contracts/personal-data-export.md`). */
export const EXPORT_CONTENT_TYPE = "application/json";

/** `personal-data-<UTC date>.json`, like the API's own `Content-Disposition` of the self-service export. */
export function exportFileName(document: Pick<PersonalDataExport, "generatedAt">): string {
  const day = /^(\d{4}-\d{2}-\d{2})T/.exec(document.generatedAt)?.[1];
  return day === undefined ? "personal-data.json" : `personal-data-${day}.json`;
}

export function exportBlob(document: PersonalDataExport): Blob {
  return new Blob([`${JSON.stringify(document, null, 2)}\n`], { type: EXPORT_CONTENT_TYPE });
}

/** What the status line of the request detail says after an action. */
export type RequestNotice =
  | { kind: "exported"; file: string; orders: number; mail: number; sessions: number }
  | { kind: "erased"; orders: number | null; mail: number | null; accountDeleted: boolean | null }
  /** The erase call was answered, but the request is not `completed`: nothing is claimed. */
  | { kind: "erase_unconfirmed" }
  | { kind: "rejected" }
  /** No answer: the write may or may not have happened. The request is read again; nothing is sent again. */
  | { kind: "lost"; action: RequestAction };

export function exportNotice(document: PersonalDataExport): RequestNotice {
  return {
    kind: "exported",
    file: exportFileName(document),
    orders: document.orders.length,
    mail: document.mail.length,
    sessions: document.sessions.length,
  };
}

/** The notice after an erase answer: only a request the API reports as completed is "erased". */
export function eraseNotice(request: AdminPrivacyRequest): RequestNotice {
  const outcome = erasureOutcome(request);
  return outcome.kind === "erased"
    ? {
        kind: "erased",
        orders: outcome.orders,
        mail: outcome.mail,
        accountDeleted: outcome.accountDeleted,
      }
    : { kind: "erase_unconfirmed" };
}

/** The reasons the reject dialog offers (a lower-case code each; the API takes any such code). */
export const REJECT_REASONS = [
  "identity_not_confirmed",
  "duplicate_request",
  "not_applicable",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];
