import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";
import type { PaginationQuery } from "../common/pagination.js";
import type { DbExecutor } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { customer, salesOrder } from "../database/schema/index.js";

export type CustomerRow = typeof customer.$inferSelect;
type NewCustomer = Pick<
  typeof customer.$inferInsert,
  "email" | "passwordHash" | "firstName" | "lastName" | "phone"
>;
export type CustomerChanges = Partial<
  Pick<
    CustomerRow,
    | "firstName"
    | "lastName"
    | "phone"
    | "isActive"
    | "passwordHash"
    | "passwordChangedAt"
    | "failedLoginCount"
    | "lockedUntil"
    | "lastLoginAt"
  >
>;

/**
 * Queries on `customer` (Drizzle, parameterized). Knows tables, not rules: lockout, password policy and the sign-in
 * flow live in `@fluxkit/core` and the services. Every method takes an optional executor so a service can run
 * several of them in one transaction. Customer sessions are `CustomerSessionRepository`'s.
 */
@Injectable()
export class CustomerRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** `email` must already be normalized (core `normalizeEmail`); the column holds only that form. */
  async findByEmail(
    email: string,
    executor: DbExecutor = this.db,
  ): Promise<CustomerRow | undefined> {
    const [row] = await executor.select().from(customer).where(eq(customer.email, email));
    return row;
  }

  async findById(id: string, executor: DbExecutor = this.db): Promise<CustomerRow | undefined> {
    const [row] = await executor.select().from(customer).where(eq(customer.id, id));
    return row;
  }

  /** Locks the row until the transaction ends, so read-modify-write on lockout state or the hash cannot interleave. */
  async findByIdForUpdate(id: string, transaction: DbExecutor): Promise<CustomerRow | undefined> {
    const [row] = await transaction
      .select()
      .from(customer)
      .where(eq(customer.id, id))
      .for("update");
    return row;
  }

  /**
   * Stable order: email, then id. `emailPrefix` (already normalized) matches the start of the email literally:
   * `starts_with` instead of `LIKE`, so `%` and `_` in the search text mean nothing special.
   */
  async list(
    page: PaginationQuery,
    emailPrefix: string | undefined,
  ): Promise<{ rows: CustomerRow[]; total: number }> {
    const where =
      emailPrefix === undefined ? undefined : sql`starts_with(${customer.email}, ${emailPrefix})`;
    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(customer)
        .where(where)
        .orderBy(asc(customer.email), asc(customer.id))
        .limit(page.limit)
        .offset(page.offset),
      this.db.$count(customer, where),
    ]);
    return { rows, total };
  }

  async insert(values: NewCustomer, executor: DbExecutor = this.db): Promise<CustomerRow> {
    const [row] = await executor.insert(customer).values(values).returning();
    if (row === undefined) {
      throw new Error("The database returned no row for a statement that must return one.");
    }
    return row;
  }

  async update(
    id: string,
    changes: CustomerChanges,
    executor: DbExecutor = this.db,
  ): Promise<CustomerRow | undefined> {
    // `updated_at` is refreshed by the column's $onUpdate, which only the query builder applies.
    const [row] = await executor
      .update(customer)
      .set(changes)
      .where(eq(customer.id, id))
      .returning();
    return row;
  }

  /** A real count over `sales_order` (0 until orders exist). */
  countOrders(customerId: string): Promise<number> {
    return this.db.$count(salesOrder, eq(salesOrder.customerId, customerId));
  }
}
