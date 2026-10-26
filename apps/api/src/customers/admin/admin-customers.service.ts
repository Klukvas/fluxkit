import { Inject, Injectable } from "@nestjs/common";
import { isLocked, normalizeEmail } from "@fluxkit/core";
import { CLOCK, type Clock } from "../../auth/clock.js";
import { toPage, type Page } from "../../common/pagination.js";
import { notFound } from "../../common/problem.js";
import { withTransaction } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { CustomerAuthTokens } from "../../email/auth/index.js";
import { CustomerSessionService } from "../auth/customer-session.service.js";
import { CustomerRepository, type CustomerRow } from "../customer.repository.js";
import type {
  CustomerDetail,
  CustomerSummary,
  ListCustomersQuery,
  UpdateCustomerBody,
} from "./admin-customers.schemas.js";

/** Row -> list item. An allow list: the hash and the lockout columns can never be added by accident. */
function toSummary(row: CustomerRow): CustomerSummary {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt === null ? null : row.lastLoginAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Customer management for admins (`customers.read` and `customers.write`, ADR 0016, ADR 0017). An admin can see,
 * deactivate and unlock a customer; there is no way to set a password, change the email or delete a customer.
 */
@Injectable()
export class AdminCustomersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CustomerRepository) private readonly customers: CustomerRepository,
    @Inject(CustomerSessionService) private readonly sessions: CustomerSessionService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CustomerAuthTokens) private readonly authTokens: CustomerAuthTokens,
  ) {}

  async list(query: ListCustomersQuery): Promise<Page<CustomerSummary>> {
    const prefix = query.q === undefined ? "" : normalizeEmail(query.q);
    const { rows, total } = await this.customers.list(query, prefix === "" ? undefined : prefix);
    return toPage(rows.map(toSummary), total, query);
  }

  get(id: string): Promise<CustomerDetail> {
    return this.detail(id);
  }

  /**
   * Activity. Deactivating deletes every session of the customer in the same transaction that clears the flag. The
   * row lock is the one a login takes before it creates a session, so a login either finished first (and its
   * session is deleted here) or waits and then sees the customer inactive: no session can outlive the deactivation.
   * Deactivating also ends the reset and verification links still out (ADR 0031 decision 9), so activating the
   * customer again does not revive them.
   */
  async update(id: string, body: UpdateCustomerBody): Promise<CustomerDetail> {
    await withTransaction(this.db, async (transaction) => {
      const target = await this.customers.findByIdForUpdate(id, transaction);
      if (target === undefined) {
        throw notFound("Customer");
      }
      await this.customers.update(id, { isActive: body.isActive }, transaction);
      if (!body.isActive) {
        await this.sessions.revokeAllForCustomer(id, undefined, transaction);
        await this.authTokens.invalidate(transaction, id, undefined, this.clock.now());
      }
    });
    return this.detail(id);
  }

  /** Clears the lockout (counter and lock time). Sessions are untouched: a lock never ended them. */
  async unlock(id: string): Promise<void> {
    await withTransaction(this.db, async (transaction) => {
      const target = await this.customers.findByIdForUpdate(id, transaction);
      if (target === undefined) {
        throw notFound("Customer");
      }
      await this.customers.update(id, { failedLoginCount: 0, lockedUntil: null }, transaction);
    });
  }

  private async detail(id: string): Promise<CustomerDetail> {
    const row = await this.customers.findById(id);
    if (row === undefined) {
      throw notFound("Customer");
    }
    return {
      ...toSummary(row),
      phone: row.phone,
      isLocked: isLocked(row, this.clock.now()),
      orderCount: await this.customers.countOrders(id),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
