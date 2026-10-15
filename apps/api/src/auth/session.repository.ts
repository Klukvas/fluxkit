import { Inject, Injectable } from "@nestjs/common";
import { and, eq, ne } from "drizzle-orm";
import type { DbExecutor } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { adminSession, adminUser } from "../database/schema/index.js";

export interface NewSessionRow {
  userId: string;
  tokenHash: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface SessionWithUser {
  sessionId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  user: { id: string; email: string; role: string; isActive: boolean };
}

/** Database access of admin sessions. Knows tables, not rules: expiry and activity decisions live in `SessionService`. */
@Injectable()
export class SessionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insert(row: NewSessionRow): Promise<string> {
    const [inserted] = await this.db
      .insert(adminSession)
      .values(row)
      .returning({ id: adminSession.id });
    if (inserted === undefined) {
      throw new Error("Inserting an admin session returned no row");
    }
    return inserted.id;
  }

  async findWithUserByTokenHash(tokenHash: string): Promise<SessionWithUser | undefined> {
    const [row] = await this.db
      .select({
        sessionId: adminSession.id,
        createdAt: adminSession.createdAt,
        lastSeenAt: adminSession.lastSeenAt,
        expiresAt: adminSession.expiresAt,
        userId: adminUser.id,
        email: adminUser.email,
        role: adminUser.role,
        isActive: adminUser.isActive,
      })
      .from(adminSession)
      .innerJoin(adminUser, eq(adminUser.id, adminSession.userId))
      .where(eq(adminSession.tokenHash, tokenHash))
      .limit(1);
    if (row === undefined) {
      return undefined;
    }
    return {
      sessionId: row.sessionId,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      expiresAt: row.expiresAt,
      user: { id: row.userId, email: row.email, role: row.role, isActive: row.isActive },
    };
  }

  async touch(sessionId: string, lastSeenAt: Date): Promise<void> {
    await this.db.update(adminSession).set({ lastSeenAt }).where(eq(adminSession.id, sessionId));
  }

  async deleteById(sessionId: string): Promise<void> {
    await this.db.delete(adminSession).where(eq(adminSession.id, sessionId));
  }

  /** Number of deleted rows (0 or 1: the hash is unique). */
  async deleteByTokenHash(tokenHash: string): Promise<number> {
    const deleted = await this.db
      .delete(adminSession)
      .where(eq(adminSession.tokenHash, tokenHash))
      .returning({ id: adminSession.id });
    return deleted.length;
  }

  async deleteForUser(
    userId: string,
    exceptSessionId?: string,
    executor: DbExecutor = this.db,
  ): Promise<number> {
    const deleted = await executor
      .delete(adminSession)
      .where(
        exceptSessionId === undefined
          ? eq(adminSession.userId, userId)
          : and(eq(adminSession.userId, userId), ne(adminSession.id, exceptSessionId)),
      )
      .returning({ id: adminSession.id });
    return deleted.length;
  }
}
