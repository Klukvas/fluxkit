import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { EMAIL_MESSAGE_STATUSES } from "@fluxkit/core";
import type { DbExecutor } from "../../common/transaction.js";
import { emailMessage } from "../../database/schema/index.js";
import type { EmailMessageRow } from "../outbox/index.js";

/** The filters of `GET /admin/email/messages`, already validated. */
export interface EmailMessageFilter {
  readonly status?: string;
  readonly templateKey?: string;
  /** A substring of the recipient address; matched case-insensitively, `%`, `_` and `\` are literal. */
  readonly recipient?: string;
  readonly orderId?: string;
  readonly customerId?: string;
  /** Inclusive lower bound of `created_at`. */
  readonly createdFrom?: Date;
  /** Exclusive upper bound of `created_at`. */
  readonly createdTo?: Date;
}

export interface EmailStatusSummary {
  readonly counts: Readonly<Record<string, number>>;
  readonly queueDepth: number;
  readonly oldestPendingAt: Date | null;
  readonly errorCodes: readonly { readonly code: string; readonly count: number }[];
}

/** The most error codes the status lists. */
export const STATUS_ERROR_CODE_LIMIT = 10;

/** Escapes `\`, `%` and `_` for a `LIKE ... ESCAPE '\'` pattern. */
export function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function conditions(filter: EmailMessageFilter): SQL | undefined {
  const parts: (SQL | undefined)[] = [
    filter.status === undefined ? undefined : eq(emailMessage.status, filter.status),
    filter.templateKey === undefined ? undefined : eq(emailMessage.templateKey, filter.templateKey),
    filter.recipient === undefined
      ? undefined
      : sql`${emailMessage.toAddress} ilike ${`%${likeLiteral(filter.recipient)}%`} escape '\\'`,
    filter.orderId === undefined ? undefined : eq(emailMessage.orderId, filter.orderId),
    filter.customerId === undefined ? undefined : eq(emailMessage.customerId, filter.customerId),
    filter.createdFrom === undefined ? undefined : gte(emailMessage.createdAt, filter.createdFrom),
    filter.createdTo === undefined ? undefined : lt(emailMessage.createdAt, filter.createdTo),
  ];
  return and(...parts);
}

/**
 * Read queries of the admin email API (ADR 0031 decision 15), parameterized. No status is ever written here: every change
 * goes through `EmailMessageChanges` (creation, claim, record, cancel). Every time is a parameter.
 */
@Injectable()
export class EmailAdminRepository {
  /** Newest first; rows created in the same instant are ordered by id, so a page never repeats or skips a row. */
  async list(
    db: DbExecutor,
    filter: EmailMessageFilter,
    limit: number,
    offset: number,
  ): Promise<{ rows: EmailMessageRow[]; total: number }> {
    const where = conditions(filter);
    const [rows, totals] = await Promise.all([
      db
        .select()
        .from(emailMessage)
        .where(where)
        .orderBy(desc(emailMessage.createdAt), desc(emailMessage.id))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(emailMessage)
        .where(where),
    ]);
    return { rows, total: totals[0]?.total ?? 0 };
  }

  async find(db: DbExecutor, id: string): Promise<EmailMessageRow | undefined> {
    const rows = await db.select().from(emailMessage).where(eq(emailMessage.id, id));
    return rows[0];
  }

  /**
   * Counts by status of the mails whose last change is at or after `since`, the open queue (all pending and sending mails,
   * whatever their age), the creation time of the oldest pending mail and the most common error codes of the window.
   */
  async summarize(db: DbExecutor, since: Date): Promise<EmailStatusSummary> {
    const [byStatus, open, errors] = await Promise.all([
      db
        .select({ status: emailMessage.status, count: sql<number>`count(*)::int` })
        .from(emailMessage)
        .where(gte(emailMessage.updatedAt, since))
        .groupBy(emailMessage.status),
      db
        .select({
          depth: sql<number>`count(*)::int`,
          oldestPending: sql<Date | null>`min(${emailMessage.createdAt}) filter (where ${emailMessage.status} = 'pending')`,
        })
        .from(emailMessage)
        .where(sql`${emailMessage.status} in ('pending', 'sending')`),
      db
        .select({ code: emailMessage.lastErrorCode, count: sql<number>`count(*)::int` })
        .from(emailMessage)
        .where(
          and(gte(emailMessage.updatedAt, since), sql`${emailMessage.lastErrorCode} is not null`),
        )
        .groupBy(emailMessage.lastErrorCode)
        .orderBy(sql`count(*) desc`, emailMessage.lastErrorCode)
        .limit(STATUS_ERROR_CODE_LIMIT),
    ]);
    const counts = Object.fromEntries(EMAIL_MESSAGE_STATUSES.map((status) => [status, 0]));
    for (const row of byStatus) {
      counts[row.status] = row.count;
    }
    const oldest = open[0]?.oldestPending;
    return {
      counts,
      queueDepth: open[0]?.depth ?? 0,
      oldestPendingAt: oldest === null || oldest === undefined ? null : new Date(oldest),
      errorCodes: errors.flatMap((row) =>
        row.code === null ? [] : [{ code: row.code, count: row.count }],
      ),
    };
  }
}
