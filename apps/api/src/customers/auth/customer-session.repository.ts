import { Inject, Injectable } from "@nestjs/common";
import { and, eq, ne } from "drizzle-orm";
import type { DbExecutor } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { customer, customerSession } from "../../database/schema/index.js";

export interface NewCustomerSessionRow {
  customerId: string;
  tokenHash: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface CustomerSessionWithCustomer {
  sessionId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  customer: { id: string; email: string; isActive: boolean };
}

/** Database access of customer sessions. Knows tables, not rules: expiry and activity decisions live in `CustomerSessionService`. */
@Injectable()
export class CustomerSessionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insert(row: NewCustomerSessionRow, executor: DbExecutor = this.db): Promise<string> {
    const [inserted] = await executor
      .insert(customerSession)
      .values(row)
      .returning({ id: customerSession.id });
    if (inserted === undefined) {
      throw new Error("Inserting a customer session returned no row");
    }
    return inserted.id;
  }

  async findWithCustomerByTokenHash(
    tokenHash: string,
  ): Promise<CustomerSessionWithCustomer | undefined> {
    const [row] = await this.db
      .select({
        sessionId: customerSession.id,
        createdAt: customerSession.createdAt,
        lastSeenAt: customerSession.lastSeenAt,
        expiresAt: customerSession.expiresAt,
        customerId: customer.id,
        email: customer.email,
        isActive: customer.isActive,
      })
      .from(customerSession)
      .innerJoin(customer, eq(customer.id, customerSession.customerId))
      .where(eq(customerSession.tokenHash, tokenHash))
      .limit(1);
    if (row === undefined) {
      return undefined;
    }
    return {
      sessionId: row.sessionId,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      expiresAt: row.expiresAt,
      customer: { id: row.customerId, email: row.email, isActive: row.isActive },
    };
  }

  async touch(sessionId: string, lastSeenAt: Date): Promise<void> {
    await this.db
      .update(customerSession)
      .set({ lastSeenAt })
      .where(eq(customerSession.id, sessionId));
  }

  async deleteById(sessionId: string): Promise<void> {
    await this.db.delete(customerSession).where(eq(customerSession.id, sessionId));
  }

  /** Number of deleted rows (0 or 1: the hash is unique). */
  async deleteByTokenHash(tokenHash: string): Promise<number> {
    const deleted = await this.db
      .delete(customerSession)
      .where(eq(customerSession.tokenHash, tokenHash))
      .returning({ id: customerSession.id });
    return deleted.length;
  }

  async deleteForCustomer(
    customerId: string,
    exceptSessionId?: string,
    executor: DbExecutor = this.db,
  ): Promise<number> {
    const deleted = await executor
      .delete(customerSession)
      .where(
        exceptSessionId === undefined
          ? eq(customerSession.customerId, customerId)
          : and(
              eq(customerSession.customerId, customerId),
              ne(customerSession.id, exceptSessionId),
            ),
      )
      .returning({ id: customerSession.id });
    return deleted.length;
  }
}
