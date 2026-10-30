import type {
  AdminAuditAction,
  AdminAuditEvent,
  AdminAuditEventList,
  AdminAuditTargetKind,
  AdminListAuditEventsOptions,
} from "@fluxkit/api-client";
import { isCalendarDay, placedRange, type DayRangeFailure } from "../../lib/date-range";
import { MAX_OFFSET, readEnum, writeQuery } from "../../router/query";

/**
 * Pure model of the audit log screen (`docs/api/audit.md`): the filters in the URL, the options of one API page, and the
 * list that grows by "load more". The API pages by `offset` (no cursor), so the feed asks for the next offset and skips an
 * event it already holds: new events are added at the top while the owner reads, which shifts later pages by one.
 */

/**
 * The action codes of `docs/api/audit.md`, written as area and verbs so that no quoted `area.verb` literal in the source looks
 * like a message key (the messages spec reads literals of that shape as keys). The type check below fails to compile when this
 * table and the client's `AdminAuditAction` differ in either direction.
 */
const ACTION_VERBS = {
  customer: ["deactivated", "activated", "unlocked"],
  admin_user: ["created", "role_changed", "deactivated", "activated", "password_reset"],
  privacy: ["lookup", "exported", "erased", "request_changed"],
} as const;

type DerivedAction = {
  [Area in keyof typeof ACTION_VERBS]: `${Area}.${(typeof ACTION_VERBS)[Area][number]}`;
}[keyof typeof ACTION_VERBS];
type SameType<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const actionsMatchTheClient: SameType<DerivedAction, AdminAuditAction> = true;
void actionsMatchTheClient;

export const AUDIT_ACTIONS: readonly AdminAuditAction[] = Object.entries(ACTION_VERBS).flatMap(
  ([area, verbs]) => verbs.map((verb) => `${area}.${verb}` as AdminAuditAction),
);

export const AUDIT_TARGET_KINDS = [
  "customer",
  "order",
  "admin_user",
  "privacy_request",
] as const satisfies readonly AdminAuditTargetKind[];

/** Events per request ("load more" asks for another page of this size). */
export const AUDIT_PAGE_SIZE = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function actionLabelKey(action: string): string {
  return (AUDIT_ACTIONS as readonly string[]).includes(action)
    ? `audit.action.${action}`
    : "audit.action.unknown";
}

export function targetKindLabelKey(kind: string): string {
  return (AUDIT_TARGET_KINDS as readonly string[]).includes(kind)
    ? `audit.target.${kind}`
    : "audit.target.unknown";
}

export interface AuditQuery {
  action?: AdminAuditAction;
  targetKind?: AdminAuditTargetKind;
  /** A uuid or `""`. */
  adminUserId: string;
  /** A uuid or `""`. */
  targetId: string;
  /** First day (`YYYY-MM-DD`, included) or `""`. */
  from: string;
  /** Last day (`YYYY-MM-DD`, included) or `""`. */
  to: string;
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function readUuid(params: URLSearchParams, key: string): string {
  const value = (params.get(key) ?? "").trim();
  return isUuid(value) ? value : "";
}

function readDay(params: URLSearchParams, key: string): string {
  const value = params.get(key) ?? "";
  return isCalendarDay(value) ? value : "";
}

export function readAuditQuery(params: URLSearchParams): AuditQuery {
  const action = readEnum(params, "action", AUDIT_ACTIONS);
  const targetKind = readEnum(params, "targetKind", AUDIT_TARGET_KINDS);
  return {
    ...(action === undefined ? {} : { action }),
    ...(targetKind === undefined ? {} : { targetKind }),
    adminUserId: readUuid(params, "adminUserId"),
    targetId: readUuid(params, "targetId"),
    from: readDay(params, "from"),
    to: readDay(params, "to"),
  };
}

/** `?action=…&targetKind=…&adminUserId=…&targetId=…&from=…&to=…` with only the set filters, or `""`. */
export function writeAuditQuery(query: AuditQuery): string {
  return writeQuery({
    action: query.action,
    targetKind: query.targetKind,
    adminUserId: query.adminUserId,
    targetId: query.targetId,
    from: query.from,
    to: query.to,
  });
}

export function hasAuditFilters(query: AuditQuery): boolean {
  return writeAuditQuery(query) !== "";
}

export type AuditRequest =
  | { ok: true; options: AdminListAuditEventsOptions }
  | { ok: false; field: "from" | "to"; reason: DayRangeFailure };

/**
 * The options of `listAuditEvents` for the filters in `timeZone` at `offset`: the days become instants (`from` inclusive,
 * `to` exclusive at the start of the day after the last day), or the reason nothing is sent.
 */
export function auditRequest(query: AuditQuery, timeZone: string, offset: number): AuditRequest {
  const range = placedRange(query.from, query.to, timeZone);
  if (!range.ok) return range;
  return {
    ok: true,
    options: {
      ...(query.action === undefined ? {} : { action: query.action }),
      ...(query.targetKind === undefined ? {} : { targetKind: query.targetKind }),
      ...(query.adminUserId === "" ? {} : { adminUserId: query.adminUserId }),
      ...(query.targetId === "" ? {} : { targetId: query.targetId }),
      ...(range.placedFrom === undefined ? {} : { from: range.placedFrom }),
      ...(range.placedTo === undefined ? {} : { to: range.placedTo }),
      limit: AUDIT_PAGE_SIZE,
      offset,
    },
  };
}

export interface AuditFeed {
  events: AdminAuditEvent[];
  /** The offset of the next page: events received so far (including the ones skipped as duplicates). */
  nextOffset: number;
  total: number;
}

export function emptyFeed(): AuditFeed {
  return { events: [], nextOffset: 0, total: 0 };
}

export function appendPage(feed: AuditFeed, page: AdminAuditEventList): AuditFeed {
  const seen = new Set(feed.events.map((entry) => entry.id));
  const added = page.items.filter((entry) => !seen.has(entry.id));
  return {
    events: [...feed.events, ...added],
    nextOffset: page.offset + page.items.length,
    total: page.total,
  };
}

/** `more`: another page can be asked for; `end`: everything is shown; `offset_limit`: the API will not page further. */
export function canLoadMore(feed: AuditFeed): "more" | "end" | "offset_limit" {
  if (feed.nextOffset >= feed.total) return "end";
  return feed.nextOffset > MAX_OFFSET ? "offset_limit" : "more";
}

/** The detail of an event as `key: value` pairs in key order (codes, counts, flags and lists of codes only). */
export function detailText(detail: AdminAuditEvent["detail"]): string {
  return Object.keys(detail)
    .sort()
    .map((key) => {
      const value = detail[key];
      return `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`;
    })
    .join("; ");
}
