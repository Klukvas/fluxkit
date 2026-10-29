import { Inject, Injectable, Logger } from "@nestjs/common";
import { isLocked, registerFailedLogin, requestDueAt } from "@fluxkit/core";
import { CLOCK, type Clock } from "../../auth/clock.js";
import { PasswordHasher } from "../../auth/password-hasher.js";
import {
  tooManyRequests,
  unauthorized,
  validationFailed,
  type ProblemException,
} from "../../common/problem.js";
import { withTransaction } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { privacyRequest } from "../../database/schema/index.js";
import { PrivacyErasureService } from "../../privacy/erasure/privacy-erasure.service.js";
import {
  PRIVACY_CONFIG,
  subjectEmailHash,
  type PrivacyConfig,
} from "../../privacy/privacy-config.js";
import { RateLimiter } from "../../rate-limit/rate-limiter.js";
import { CustomerRepository } from "../customer.repository.js";

function wrongPassword(): ProblemException {
  return validationFailed([
    { path: "password", code: "incorrect", message: "The password is not correct." },
  ]);
}

/**
 * Self-service account deletion (ADR 0033 decisions 1, 6 and 13; `POST /store/account/delete`). The password is checked
 * outside any transaction (scrypt, with the dummy check while the account is locked, like change-password); a wrong
 * password counts as a failed sign-in (decision of privacy plan step 7: a stolen session must not try passwords for
 * free). Then one transaction: the customer row is locked first and re-checked (active, not locked, the same password
 * hash), the privacy erasure runs under it, and a completed self-service erasure request is recorded without contact
 * data. Immediate and irreversible; refused with every blocker while something is in progress.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CustomerRepository) private readonly customers: CustomerRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(PrivacyErasureService) private readonly erasure: PrivacyErasureService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PRIVACY_CONFIG) private readonly config: PrivacyConfig,
  ) {}

  async deleteAccount(customerId: string, password: string): Promise<void> {
    const limit = this.limiter.attempt("accountDelete", `customer:${customerId}`);
    if (!limit.allowed) {
      throw tooManyRequests("Too many attempts. Try again later.", limit.retryAfterSeconds);
    }
    const now = this.clock.now();
    const row = await this.customers.findById(customerId);
    if (row === undefined || !row.isActive) {
      throw unauthorized();
    }
    const correct = isLocked(row, now)
      ? await this.hasher.verifyDummy(password)
      : await this.hasher.verify(password, row.passwordHash);
    if (!correct) {
      await withTransaction(this.db, async (tx) => {
        const locked = await this.customers.findByIdForUpdate(customerId, tx);
        if (locked !== undefined) {
          await this.customers.update(customerId, registerFailedLogin(locked, now), tx);
        }
      });
      throw wrongPassword();
    }
    const result = await withTransaction(this.db, async (tx) => {
      const locked = await this.erasure.lockCustomer(tx, customerId);
      if (locked === undefined) {
        // A parallel deletion of the same account won.
        throw unauthorized();
      }
      if (!locked.isActive || isLocked(locked, now) || locked.passwordHash !== row.passwordHash) {
        throw wrongPassword();
      }
      const erased = await this.erasure.erase(
        tx,
        { kind: "customer", customer: locked, email: locked.email },
        now,
      );
      await tx.insert(privacyRequest).values({
        kind: "erasure",
        subjectKind: "customer",
        subjectCustomerId: customerId,
        subjectEmailHash: subjectEmailHash(this.config, locked.email),
        channel: "self_service",
        status: "completed",
        receivedAt: now,
        dueAt: requestDueAt(now),
        completedAt: now,
        result: { ...erased, orderNumbers: [...erased.orderNumbers] },
      });
      return erased;
    });
    this.logger.log(
      `Customer ${customerId} deleted the account (orders anonymised ${String(result.ordersAnonymised)}, mail deleted ${String(result.mailDeleted)})`,
    );
  }
}
