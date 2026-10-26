import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import type { AuthTokenPurpose } from "@fluxkit/core";
import type { DbExecutor } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { customer, customerAuthToken } from "../../database/schema/index.js";

export interface NewAuthTokenRow {
  readonly id: string;
  readonly customerId: string;
  readonly purpose: AuthTokenPurpose;
  readonly tokenHash: string;
  readonly email: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/** A token row found by its hash, with the facts of its customer that the rules need. */
export interface FoundAuthToken {
  readonly id: string;
  readonly customerId: string;
  readonly purpose: AuthTokenPurpose;
  readonly tokenHash: string;
  readonly email: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly customer: {
    readonly email: string;
    readonly isActive: boolean;
    readonly emailVerifiedAt: Date | null;
  };
}

/**
 * Queries on `customer_auth_token` (ADR 0031 decision 9). Knows the table, not the rules: expiry, purpose, single use and
 * the email match are core `evaluateAuthToken`, run by `CustomerAuthTokens`. Every write takes the caller's transaction.
 */
@Injectable()
export class CustomerAuthTokenRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insert(row: NewAuthTokenRow, executor: DbExecutor): Promise<void> {
    await executor.insert(customerAuthToken).values({ ...row });
  }

  /**
   * Marks every unused token of the customer used (`purpose` limits it to one purpose): a newer token, a password change
   * and a deactivation invalidate the older ones. Answers how many were marked.
   */
  async invalidateUnused(
    customerId: string,
    purpose: AuthTokenPurpose | undefined,
    now: Date,
    executor: DbExecutor,
  ): Promise<number> {
    const rows = await executor
      .update(customerAuthToken)
      .set({ usedAt: now })
      .where(
        and(
          eq(customerAuthToken.customerId, customerId),
          isNull(customerAuthToken.usedAt),
          purpose === undefined ? undefined : eq(customerAuthToken.purpose, purpose),
        ),
      )
      .returning({ id: customerAuthToken.id });
    return rows.length;
  }

  /** Tokens of one purpose the customer was given strictly after `since` (the per-address database limit). */
  async countCreatedSince(
    customerId: string,
    purpose: AuthTokenPurpose,
    since: Date,
    executor: DbExecutor,
  ): Promise<number> {
    const [row] = await executor
      .select({ value: count() })
      .from(customerAuthToken)
      .where(
        and(
          eq(customerAuthToken.customerId, customerId),
          eq(customerAuthToken.purpose, purpose),
          gt(customerAuthToken.createdAt, since),
        ),
      );
    return row?.value ?? 0;
  }

  /** The row whose `token_hash` is `tokenHash` (the unique index), joined with its customer; `undefined` when none. */
  async findByHash(
    tokenHash: string,
    executor: DbExecutor = this.db,
  ): Promise<FoundAuthToken | undefined> {
    const [row] = await executor
      .select({
        id: customerAuthToken.id,
        customerId: customerAuthToken.customerId,
        purpose: customerAuthToken.purpose,
        tokenHash: customerAuthToken.tokenHash,
        email: customerAuthToken.email,
        expiresAt: customerAuthToken.expiresAt,
        usedAt: customerAuthToken.usedAt,
        customerEmail: customer.email,
        customerIsActive: customer.isActive,
        customerEmailVerifiedAt: customer.emailVerifiedAt,
      })
      .from(customerAuthToken)
      .innerJoin(customer, eq(customer.id, customerAuthToken.customerId))
      .where(eq(customerAuthToken.tokenHash, tokenHash));
    if (row === undefined) {
      return undefined;
    }
    return {
      id: row.id,
      customerId: row.customerId,
      // The CHECK of the column allows only the core purposes.
      purpose: row.purpose as AuthTokenPurpose,
      tokenHash: row.tokenHash,
      email: row.email,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      customer: {
        email: row.customerEmail,
        isActive: row.customerIsActive,
        emailVerifiedAt: row.customerEmailVerifiedAt,
      },
    };
  }

  /**
   * Single use: marks the token used if, and only if, it is still unused and still carries `tokenHash`, in ONE statement
   * (`UPDATE ... WHERE used_at IS NULL ... RETURNING`). Of two concurrent calls exactly one answers true.
   */
  async consume(id: string, tokenHash: string, now: Date, executor: DbExecutor): Promise<boolean> {
    const rows = await executor
      .update(customerAuthToken)
      .set({ usedAt: now })
      .where(
        and(
          eq(customerAuthToken.id, id),
          eq(customerAuthToken.tokenHash, tokenHash),
          isNull(customerAuthToken.usedAt),
        ),
      )
      .returning({ id: customerAuthToken.id });
    return rows.length === 1;
  }
}
