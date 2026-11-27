import { createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import type { IntegrationKind } from "@fluxkit/core";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { adminUser } from "../database/schema/index.js";
import { LOCALE_CONFIG, type LocaleConfig } from "../common/locale.js";
import { withTransaction, type Transaction } from "../common/transaction.js";
import { EmailOutbox } from "../email/outbox/email-outbox.service.js";

export interface IntegrationAlertEvent {
  readonly auditEventId: string;
  readonly action:
    | "integration.secret_changed"
    | "integration.activated"
    | "integration.disabled"
    | "integration.revoked";
  readonly kind: IntegrationKind;
  readonly providerCode: string;
  readonly generation: number;
  readonly occurredAt: Date;
}
const ALERT_TIMEOUT_MS = 2000;

@Injectable()
export class IntegrationAlerts {
  private readonly logger = new Logger(IntegrationAlerts.name);
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(EmailOutbox) private readonly outbox: EmailOutbox,
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
  ) {}

  /** Only called after the mutation commits. Notification failures cannot change its result. */
  async notify(event: IntegrationAlertEvent): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    const assertLive = () => {
      if (expired) throw new Error("integration_alert_expired");
    };
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error("integration_alert_expired"));
        }, ALERT_TIMEOUT_MS);
      });
      const enqueue = async () => {
        if (!(await this.outbox.enabled())) return;
        assertLive();
        const owners = await withTransaction(this.db, async (tx) => {
          await alertTimeouts(tx);
          return tx
            .select({ id: adminUser.id, email: adminUser.email })
            .from(adminUser)
            .where(and(eq(adminUser.role, "owner"), eq(adminUser.isActive, true)));
        });
        for (const owner of owners) {
          assertLive();
          try {
            await withTransaction(this.db, async (tx) => {
              await alertTimeouts(tx);
              const result = await this.outbox.enqueue(tx, {
                templateKey: "integration.security_alert",
                locale: this.locale.defaultLocale,
                to: owner.email,
                recipientKind: "admin",
                adminUserId: owner.id,
                eventId: alertEventId(event.auditEventId, owner.id),
                variables: {
                  action: event.action,
                  kind: event.kind,
                  providerCode: event.providerCode,
                  generation: event.generation,
                  occurredAt: event.occurredAt.toISOString(),
                },
                now: event.occurredAt,
              });
              if (result.status === "undeliverable") this.logger.error("integration_alert_failed");
              assertLive();
            });
          } catch {
            // One owner's mailbox must not suppress alerts to the others.
            this.logger.error("integration_alert_failed");
          }
        }
      };
      await Promise.race([enqueue(), timeout]);
    } catch {
      this.logger.error("integration_alert_failed");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

/** The outbox dedupe key has one event UUID, so scope that id to both the audit event and the owner. */
function alertEventId(auditEventId: string, ownerId: string): string {
  const hex = createHash("sha256")
    .update(`integration-alert:${auditEventId}:${ownerId}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function alertTimeouts(tx: Transaction): Promise<void> {
  await tx.execute(sql`set local statement_timeout = '1s'`);
  await tx.execute(sql`set local lock_timeout = '1s'`);
  await tx.execute(sql`set local idle_in_transaction_session_timeout = '2s'`);
}
