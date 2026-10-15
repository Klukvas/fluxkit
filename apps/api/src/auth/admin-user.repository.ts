import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import type { PaginationQuery } from "../common/pagination.js";
import type { DbExecutor } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { adminUser } from "../database/schema/index.js";

export type AdminUserRow = typeof adminUser.$inferSelect;
type NewAdminUser = Pick<typeof adminUser.$inferInsert, "email" | "passwordHash" | "role">;

/**
 * Key of the transaction-level advisory lock that serializes every change that can reduce the number of active
 * owners (role or activity changes). `decideUserChange` reads the owner list and the update follows; without one
 * lock for all of them two requests could each see "another owner remains" and demote each other.
 * Any 64-bit constant works as long as it is unique among this application's advisory locks (the test helper uses
 * 7_426_001 for the schema).
 */
export const OWNER_CHANGE_LOCK_KEY = 7_426_002;

/**
 * Queries on `admin_user` (Drizzle, parameterized). Knows tables, not rules: lockout, password policy and the
 * last-owner rule live in `@fluxkit/core` and the services. Every method takes an optional executor so a service
 * can run several of them in one transaction.
 */
@Injectable()
export class AdminUserRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findByEmail(
    email: string,
    executor: DbExecutor = this.db,
  ): Promise<AdminUserRow | undefined> {
    const [row] = await executor.select().from(adminUser).where(eq(adminUser.email, email));
    return row;
  }

  async findById(id: string, executor: DbExecutor = this.db): Promise<AdminUserRow | undefined> {
    const [row] = await executor.select().from(adminUser).where(eq(adminUser.id, id));
    return row;
  }

  /** Locks the row until the transaction ends, so read-modify-write on lockout state or the hash cannot interleave. */
  async findByIdForUpdate(id: string, transaction: DbExecutor): Promise<AdminUserRow | undefined> {
    const [row] = await transaction
      .select()
      .from(adminUser)
      .where(eq(adminUser.id, id))
      .for("update");
    return row;
  }

  /** Stable order: email, then id. */
  async list(page: PaginationQuery): Promise<{ rows: AdminUserRow[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(adminUser)
        .orderBy(asc(adminUser.email), asc(adminUser.id))
        .limit(page.limit)
        .offset(page.offset),
      this.db.$count(adminUser),
    ]);
    return { rows, total };
  }

  async insert(values: NewAdminUser, executor: DbExecutor = this.db): Promise<AdminUserRow> {
    const [row] = await executor.insert(adminUser).values(values).returning();
    return required(row);
  }

  async update(
    id: string,
    changes: Partial<
      Pick<
        AdminUserRow,
        | "role"
        | "isActive"
        | "passwordHash"
        | "passwordChangedAt"
        | "failedLoginCount"
        | "lockedUntil"
        | "lastLoginAt"
      >
    >,
    executor: DbExecutor = this.db,
  ): Promise<AdminUserRow | undefined> {
    // `updated_at` is refreshed by the column's $onUpdate, which only the query builder applies.
    const [row] = await executor
      .update(adminUser)
      .set(changes)
      .where(eq(adminUser.id, id))
      .returning();
    return row;
  }

  /** Ids of all active owners. Call it inside the transaction that holds `lockOwnerChanges`. */
  async activeOwnerIds(executor: DbExecutor): Promise<string[]> {
    const rows = await executor
      .select({ id: adminUser.id })
      .from(adminUser)
      .where(and(eq(adminUser.role, "owner"), eq(adminUser.isActive, true)));
    return rows.map((row) => row.id);
  }

  /** Waits for, then holds until the end of the transaction, the lock that serializes all owner changes. */
  async lockOwnerChanges(transaction: DbExecutor): Promise<void> {
    await transaction.execute(sql`select pg_advisory_xact_lock(${OWNER_CHANGE_LOCK_KEY})`);
  }
}

function required<T>(row: T | undefined): T {
  if (row === undefined) {
    throw new Error("The database returned no row for a statement that must return one.");
  }
  return row;
}
