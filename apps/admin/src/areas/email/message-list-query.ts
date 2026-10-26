import type { AdminEmailMessageStatus, AdminListEmailMessagesOptions } from "@fluxkit/api-client";
import { isCalendarDay, placedRange, type DayRangeFailure } from "../../lib/date-range";
import { readEnum, readPaging, readText, writeQuery } from "../../router/query";
import { MESSAGE_STATUSES } from "./email-view";

/**
 * The message list's state in the URL (filters and paging, so a list can be shared and reloaded). Pure. Readers never
 * throw: a hand-edited bad value means "no filter"; the API validates whatever is sent anyway. The dates are calendar days
 * of the browser's time zone, turned into instants by `lib/date-range.ts` (`createdFrom` inclusive, `createdTo` exclusive
 * at the start of the day after the last day, like the order list's placed range).
 */

/** The API's default page size of `GET /admin/email/messages` (`docs/api/email.md`). */
export const MESSAGE_LIST_LIMIT = 50;
/** `recipient` of the route: at most 254 characters (an address's maximum). */
export const RECIPIENT_MAX_LENGTH = 254;
/** The longest template key the route accepts (core `EMAIL_TEMPLATE_KEY_MAX_LENGTH`). */
export const TEMPLATE_KEY_MAX_LENGTH = 64;
/** A template key such as order.placed (core `EMAIL_TEMPLATE_KEY_PATTERN`). */
const TEMPLATE_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export interface MessageListQuery {
  status?: AdminEmailMessageStatus;
  /** An exact template key or `""`. */
  template: string;
  /** Trimmed substring of the address or `""`. */
  recipient: string;
  /** First day (`YYYY-MM-DD`, included) or `""`. */
  from: string;
  /** Last day (`YYYY-MM-DD`, included) or `""`. */
  to: string;
  limit: number;
  offset: number;
}

/** A template key the routes accept (for example order.placed). */
export function isTemplateKey(value: string): boolean {
  return value.length <= TEMPLATE_KEY_MAX_LENGTH && TEMPLATE_KEY_PATTERN.test(value);
}

export function readTemplateKey(value: string | null): string {
  return value !== null && isTemplateKey(value) ? value : "";
}

function readDay(params: URLSearchParams, key: string): string {
  const value = params.get(key) ?? "";
  return isCalendarDay(value) ? value : "";
}

export function readMessageListQuery(params: URLSearchParams): MessageListQuery {
  const status = readEnum(params, "status", MESSAGE_STATUSES);
  return {
    ...(status === undefined ? {} : { status }),
    template: readTemplateKey(params.get("template")),
    recipient: readText(params, "recipient", { maxLength: RECIPIENT_MAX_LENGTH }),
    from: readDay(params, "from"),
    to: readDay(params, "to"),
    ...readPaging(params, { defaultLimit: MESSAGE_LIST_LIMIT }),
  };
}

/** `?status=…&template=…&recipient=…&from=…&to=…&limit=…&offset=…`, or `""` for the unfiltered first page. */
export function writeMessageListQuery(query: MessageListQuery): string {
  return writeQuery(
    {
      status: query.status,
      template: query.template,
      recipient: query.recipient,
      from: query.from,
      to: query.to,
      limit: query.limit,
      offset: query.offset,
    },
    { limit: MESSAGE_LIST_LIMIT, offset: 0 },
  );
}

export type MessageFilters = Pick<
  MessageListQuery,
  "status" | "template" | "recipient" | "from" | "to"
>;

/** A changed filter set starts at the first page again; the page size stays. An absent `status` removes that filter. */
export function withFilters(query: MessageListQuery, filters: MessageFilters): MessageListQuery {
  return {
    ...(filters.status === undefined ? {} : { status: filters.status }),
    template: filters.template,
    recipient: filters.recipient.trim(),
    from: filters.from,
    to: filters.to,
    limit: query.limit,
    offset: 0,
  };
}

export function hasFilters(query: MessageListQuery): boolean {
  return (
    query.status !== undefined ||
    query.template !== "" ||
    query.recipient !== "" ||
    query.from !== "" ||
    query.to !== ""
  );
}

export type MessageRecipientCheck = { ok: true; value: string } | { ok: false; reason: "too_long" };

/** The recipient text as the API will take it (trimmed), or why it would be refused. Empty means "no filter". */
export function checkRecipient(text: string): MessageRecipientCheck {
  const value = text.trim();
  return value.length > RECIPIENT_MAX_LENGTH
    ? { ok: false, reason: "too_long" }
    : { ok: true, value };
}

export type MessageListRequest =
  | { ok: true; options: AdminListEmailMessagesOptions }
  | { ok: false; field: "from" | "to"; reason: DayRangeFailure };

/** The options of `listEmailMessages` for this query in `timeZone` (only the filters that are set), or why nothing is sent. */
export function listRequest(query: MessageListQuery, timeZone: string): MessageListRequest {
  const range = placedRange(query.from, query.to, timeZone);
  if (!range.ok) return range;
  return {
    ok: true,
    options: {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.template === "" ? {} : { template: query.template }),
      ...(query.recipient === "" ? {} : { recipient: query.recipient }),
      ...(range.placedFrom === undefined ? {} : { createdFrom: range.placedFrom }),
      ...(range.placedTo === undefined ? {} : { createdTo: range.placedTo }),
      limit: query.limit,
      offset: query.offset,
    },
  };
}
