import { Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import type { DbExecutor, Transaction } from "../../common/transaction.js";
import { emailMessage } from "../../database/schema/index.js";

export type EmailMessageRow = typeof emailMessage.$inferSelect;
export type NewEmailMessageRow = typeof emailMessage.$inferInsert;

/** The columns the outbox writer changes (status, attempts, times, codes). */
export type EmailMessageUpdate = Partial<
  Pick<
    EmailMessageRow,
    | "status"
    | "attempts"
    | "nextAttemptAt"
    | "leaseUntil"
    | "providerCode"
    | "providerMessageId"
    | "lastErrorCode"
    | "sentAt"
    | "updatedAt"
  >
>;

/** Where the previous page of due mails ended: `next_attempt_at` as UTC text with microseconds, then the id. */
export interface EmailDueCursor {
  readonly time: string;
  readonly id: string;
}

export interface DueEmail {
  readonly id: string;
  readonly cursor: EmailDueCursor;
}

/** One retention rule of job 10: rows in these final statuses whose last change is strictly before `cutoff`. */
export interface EmailPurgeGroup {
  readonly statuses: readonly string[];
  readonly cutoff: Date;
}

/** The due condition shared by the page query and the claim: a pending row whose time came, or an expired lease. */
function dueCondition(now: Date) {
  return sql`${emailMessage.status} in ('pending', 'sending') and ${emailMessage.nextAttemptAt} <= ${now} and (${emailMessage.status} = 'pending' or ${emailMessage.leaseUntil} < ${now})`;
}

/**
 * The queries of the mail outbox (`email_message`, ADR 0031 decisions 5 to 8), parameterized. Knows tables and locks,
 * not rules: every status a row gets is decided by `EmailMessageChanges` (core `decideEmailTransition`). Every time is
 * a parameter: nothing reads the database clock, so a test with a fake clock decides.
 *
 * A claimed row's `next_attempt_at` is its lease end, so one partial index (`email_message_next_attempt_at_idx`, open
 * statuses) finds both due pending rows and expired leases, oldest first.
 */
@Injectable()
export class EmailOutboxRepository {
  /** Inserts a mail; `undefined` when a row with the same `dedupe_key` exists (`ON CONFLICT DO NOTHING`). */
  async insert(tx: DbExecutor, values: NewEmailMessageRow): Promise<string | undefined> {
    const rows = await tx
      .insert(emailMessage)
      .values(values)
      .onConflictDoNothing({ target: emailMessage.dedupeKey })
      .returning({ id: emailMessage.id });
    return rows[0]?.id;
  }

  /**
   * Up to `limit` due mails, oldest due first, strictly after `after`. A snapshot without locks: the claim checks again
   * under the row lock. Continued by the cursor, so a row that could not be claimed is not read again in the same run.
   */
  async listDue(
    db: DbExecutor,
    now: Date,
    after: EmailDueCursor | undefined,
    limit: number,
  ): Promise<DueEmail[]> {
    const rows = await db
      .select({
        id: emailMessage.id,
        time: sql<string>`to_char(${emailMessage.nextAttemptAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(emailMessage)
      .where(
        and(
          dueCondition(now),
          after === undefined
            ? undefined
            : sql`(${emailMessage.nextAttemptAt}, ${emailMessage.id}) > (${after.time}::timestamptz, ${after.id}::uuid)`,
        ),
      )
      .orderBy(asc(emailMessage.nextAttemptAt), asc(emailMessage.id))
      .limit(limit);
    return rows.map((row) => ({ id: row.id, cursor: { time: row.time, id: row.id } }));
  }

  /**
   * The row, locked, when it is due (`dueCondition`); `undefined` when it is not due, gone, or locked by another
   * transaction right now (`SKIP LOCKED`: two senders never wait for each other, and only one of them gets the row).
   */
  async lockClaimable(
    tx: Transaction,
    id: string,
    now: Date,
  ): Promise<EmailMessageRow | undefined> {
    const rows = await tx
      .select()
      .from(emailMessage)
      .where(and(eq(emailMessage.id, id), dueCondition(now)))
      .for("update", { skipLocked: true });
    return rows[0];
  }

  /** The row, locked (waiting within the transaction's `lock_timeout`). */
  async lock(tx: Transaction, id: string): Promise<EmailMessageRow | undefined> {
    const rows = await tx.select().from(emailMessage).where(eq(emailMessage.id, id)).for("update");
    return rows[0];
  }

  async update(tx: Transaction, id: string, values: EmailMessageUpdate): Promise<EmailMessageRow> {
    const rows = await tx
      .update(emailMessage)
      .set(values)
      .where(eq(emailMessage.id, id))
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error("A locked email_message row disappeared");
    }
    return row;
  }

  /** Open mails (`pending` or `sending`): job 9 warns when they wait while no provider is loaded. */
  async countOpen(db: DbExecutor): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(emailMessage)
      .where(sql`${emailMessage.status} in ('pending', 'sending')`);
    return rows[0]?.count ?? 0;
  }

  /**
   * Deletes up to `limit` rows of the purge groups (final statuses only, last change strictly before the group's cutoff),
   * oldest first, skipping rows another transaction holds. The status condition is repeated in the DELETE, so the
   * statement can never remove an open mail whatever the groups say. Returns the number deleted.
   */
  async deleteFinal(
    db: DbExecutor,
    groups: readonly EmailPurgeGroup[],
    finalStatuses: readonly string[],
    limit: number,
  ): Promise<number> {
    if (groups.length === 0) {
      return 0;
    }
    const matches = sql.join(
      groups.map(
        (group) =>
          sql`(status in (${sql.join(
            group.statuses.map((status) => sql`${status}`),
            sql`, `,
          )}) and updated_at < ${group.cutoff})`,
      ),
      sql` or `,
    );
    const finals = sql.join(
      finalStatuses.map((status) => sql`${status}`),
      sql`, `,
    );
    const result = await db.execute(sql`
      with doomed as materialized (
        select id from email_message where ${matches}
        order by updated_at limit ${limit} for update skip locked
      )
      delete from email_message
      where id in (select id from doomed) and status in (${finals})
      returning id
    `);
    return result.rows.length;
  }

  /**
   * Deletes up to `limit` customer auth tokens that expired strictly before `cutoff` (used or not: an expired token can
   * never be used). No index has `expires_at` first, so this scans the table; it holds one row per reset or verification
   * request of the retention window.
   */
  async deleteExpiredAuthTokens(db: DbExecutor, cutoff: Date, limit: number): Promise<number> {
    const result = await db.execute(sql`
      with doomed as materialized (
        select id from customer_auth_token where expires_at < ${cutoff}
        order by expires_at limit ${limit} for update skip locked
      )
      delete from customer_auth_token where id in (select id from doomed) and expires_at < ${cutoff}
      returning id
    `);
    return result.rows.length;
  }
}
