import { Inject, Injectable } from "@nestjs/common";
import { count, desc, eq, sql } from "drizzle-orm";
import {
  EMAIL_PROVIDER_CODE_PATTERN,
  validateEmailAddress,
  type EmailSuppressionFact,
} from "@fluxkit/core";
import type { PaginationQuery } from "../../common/pagination.js";
import { notFound } from "../../common/problem.js";
import { withTransaction } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { emailSuppression, emailWebhookReceipt } from "../../database/schema/index.js";
import { AdminAuditWriter } from "../../privacy/audit/admin-audit.writer.js";
import {
  boundEmailSuppressionWaits,
  lockEmailSuppressionAddress,
} from "./email-suppression-lock.js";
import type { EmailSuppressionPageResponse } from "./email-suppression.schemas.js";

/** Shared Postgres gate and transactional, replay-safe provider feedback; never stores vendor prose. */
@Injectable()
export class EmailSuppressionService {
  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(AdminAuditWriter) private readonly audit: AdminAuditWriter,
  ) {}

  async isSuppressed(address: string): Promise<boolean> {
    const normalized = validateEmailAddress(address);
    if (!normalized.ok) throw new RangeError("Invalid suppression lookup recipient");
    const rows = await this.database
      .select({ id: emailSuppression.id })
      .from(emailSuppression)
      .where(eq(emailSuppression.toAddress, normalized.address))
      .limit(1);
    return rows.length > 0;
  }

  /** Every receipt and corresponding change commits together. Sorted locks avoid cross-delivery deadlocks. */
  async ingest(
    providerCode: string,
    facts: readonly EmailSuppressionFact[],
    now: Date,
  ): Promise<void> {
    if (!EMAIL_PROVIDER_CODE_PATTERN.test(providerCode))
      throw new RangeError("Invalid suppression provider");
    await withTransaction(this.database, async (tx) => {
      await boundEmailSuppressionWaits(tx);
      const addresses = [...new Set(facts.map((fact) => fact.recipient))].sort();
      for (const address of addresses) await lockEmailSuppressionAddress(tx, address);
      for (const fact of [...facts].sort(
        (a, b) => a.recipient.localeCompare(b.recipient) || a.eventKey.localeCompare(b.eventKey),
      )) {
        const inserted = await tx
          .insert(emailWebhookReceipt)
          .values({
            providerCode,
            eventKey: fact.eventKey,
            toAddress: fact.recipient,
            eventAt: fact.eventAt,
            receivedAt: now,
          })
          .onConflictDoNothing()
          .returning({ eventKey: emailWebhookReceipt.eventKey });
        if (inserted.length === 0) continue;
        await tx
          .insert(emailSuppression)
          .values({
            toAddress: fact.recipient,
            reason: fact.reason,
            sourceProvider: providerCode,
            firstSeenAt: fact.eventAt,
            lastSeenAt: fact.eventAt,
          })
          .onConflictDoUpdate({
            target: emailSuppression.toAddress,
            set: {
              firstSeenAt: sql`least(${emailSuppression.firstSeenAt}, excluded.first_seen_at)`,
              lastSeenAt: sql`greatest(${emailSuppression.lastSeenAt}, excluded.last_seen_at)`,
              // Equal timestamps preserve the first committed reason/source, so ordering cannot churn on retries.
              reason: sql`case when excluded.last_seen_at > ${emailSuppression.lastSeenAt} then excluded.reason else ${emailSuppression.reason} end`,
              sourceProvider: sql`case when excluded.last_seen_at > ${emailSuppression.lastSeenAt} then excluded.source_provider else ${emailSuppression.sourceProvider} end`,
            },
          });
      }
    });
  }

  async list(query: PaginationQuery): Promise<EmailSuppressionPageResponse> {
    const rows = await this.database
      .select()
      .from(emailSuppression)
      .orderBy(desc(emailSuppression.lastSeenAt), desc(emailSuppression.id))
      .limit(query.limit)
      .offset(query.offset);
    const [total] = await this.database.select({ value: count() }).from(emailSuppression);
    return {
      items: rows.map((row) => ({
        id: row.id,
        toAddress: row.toAddress,
        toAddressMasked: maskSuppressionAddress(row.toAddress),
        reason: row.reason as EmailSuppressionFact["reason"],
        sourceProvider: row.sourceProvider,
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
      })),
      total: total?.value ?? 0,
      limit: query.limit,
      offset: query.offset,
    };
  }

  /** Keep receipts: retrying an already processed event must not recreate a manually removed block. */
  async remove(id: string, actorAdminId: string): Promise<void> {
    await withTransaction(this.database, async (tx) => {
      const deleted = await tx
        .delete(emailSuppression)
        .where(eq(emailSuppression.id, id))
        .returning({ id: emailSuppression.id });
      if (deleted.length === 0) throw notFound("Email suppression");
      await this.audit.record(tx, actorAdminId, {
        action: "email_suppression.removed",
        targetKind: "email_suppression",
        targetId: id,
      });
    });
  }
}

/** Mask both local and domain labels for the default admin display. */
export function maskSuppressionAddress(address: string): string {
  const [local = "", domain = ""] = address.split("@");
  return `${local.slice(0, 1)}***@${domain
    .split(".")
    .map((part) => `${part.slice(0, 1)}***`)
    .join(".")}`;
}
