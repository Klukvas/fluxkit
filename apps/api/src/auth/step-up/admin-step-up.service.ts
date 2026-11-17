import { Inject, Injectable, Logger } from "@nestjs/common";
import { hasPermission, isLocked, registerFailedLogin, type AdminPermission } from "@fluxkit/core";
import { ProblemException, tooManyRequests, unauthorized } from "../../common/problem.js";
import { withTransaction, type DbExecutor } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { AdminAuditWriter } from "../../privacy/audit/admin-audit.writer.js";
import {
  STRICT_WINDOWS,
  type StrictWindow,
  type StrictWindows,
} from "../../rate-limit/strict-windows.js";
import type { AdminPrincipal } from "../admin-authenticator.js";
import { AdminUserRepository } from "../admin-user.repository.js";
import { CLOCK, type Clock } from "../clock.js";
import { PasswordHasher } from "../password-hasher.js";
import { SessionRepository } from "../session.repository.js";

/** Shared by every action that asks for the current password again (plan section 8): per admin and per address. */
export const STEP_UP_LIMITS = Object.freeze({
  admin: Object.freeze({ maxAttempts: 5, windowMinutes: 15 }),
  address: Object.freeze({ maxAttempts: 20, windowMinutes: 15 }),
});

/** The `rule` of the 403 a wrong or no longer valid current password answers. */
export const STEP_UP_FAILED_RULE = "current_password_incorrect";
export const STEP_UP_UNAVAILABLE_RULE = "step_up_unavailable";
const STEP_UP_UNAVAILABLE_RETRY_SECONDS = 5;

export interface StepUpRequest {
  readonly principal: AdminPrincipal;
  readonly currentPassword: string;
  /** `request.ip` as Express resolved it (`TRUST_PROXY`). */
  readonly clientAddress: string;
  /** A code for the audit record of a refused attempt, e.g. `integration.secret_changed`. Never free text. */
  readonly operation: string;
}

/** Proof that the password matched, to be re-checked under the row lock by `assertStillValid`. */
export interface VerifiedStepUp {
  readonly userId: string;
  readonly passwordHash: string;
  readonly sessionId: string;
}

/**
 * Password re-entry for sensitive admin actions (ADR 0058). The order is fixed: the shared strict limits are consumed
 * first (a refused or unavailable limit means no scrypt work at all), then the password is checked (a locked account
 * gets the dummy check, as at login), then the caller runs its change and calls `assertStillValid` inside its
 * transaction. A wrong password counts toward the account lockout and leaves an audit record in its own transaction, so
 * the record survives the refused change.
 */
@Injectable()
export class AdminStepUpService {
  private readonly logger = new Logger(AdminStepUpService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AdminUserRepository) private readonly users: AdminUserRepository,
    @Inject(SessionRepository) private readonly sessions: SessionRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(STRICT_WINDOWS) private readonly windows: StrictWindows,
    @Inject(AdminAuditWriter) private readonly audit: AdminAuditWriter,
  ) {}

  async verify(request: StepUpRequest): Promise<VerifiedStepUp> {
    await this.consumeLimits(request);
    const now = this.clock.now();
    const user = await this.users.findById(request.principal.userId);
    if (user === undefined || !user.isActive) {
      // Still one scrypt, so a deactivated account answers no faster than a live one.
      await this.hasher.verifyDummy(request.currentPassword);
      throw unauthorized();
    }
    const isCorrect = isLocked(user, now)
      ? await this.hasher.verifyDummy(request.currentPassword)
      : await this.hasher.verify(request.currentPassword, user.passwordHash);
    if (!isCorrect) {
      await this.recordFailure(user.id, request.operation, now);
      throw stepUpFailed();
    }
    return {
      userId: user.id,
      passwordHash: user.passwordHash,
      sessionId: request.principal.sessionId,
    };
  }

  /**
   * Inside the caller's transaction, before its writes: the scrypt work took time, so the account may have been
   * deactivated, locked, demoted or given another password meanwhile, or the session signed out ("sign out
   * everywhere" of a stolen session). Locks the admin row, then the session row, until the caller commits.
   */
  async assertStillValid(
    transaction: DbExecutor,
    verified: VerifiedStepUp,
    permission: AdminPermission,
  ): Promise<void> {
    const now = this.clock.now();
    const row = await this.users.findByIdForUpdate(verified.userId, transaction);
    if (
      row === undefined ||
      !row.isActive ||
      isLocked(row, now) ||
      row.passwordHash !== verified.passwordHash ||
      !hasPermission(row.role, permission)
    ) {
      throw stepUpFailed();
    }
    if (!(await this.sessions.isLiveForUpdate(transaction, verified.sessionId, row.id, now))) {
      // The session ended during the check: the same answer as a request without one.
      throw unauthorized();
    }
  }

  private async consumeLimits(request: StepUpRequest): Promise<void> {
    const windows: StrictWindow[] = [
      {
        name: "stepUpAdmin",
        key: `admin-user:${request.principal.userId}`,
        limit: STEP_UP_LIMITS.admin,
      },
      { name: "stepUpAddress", key: request.clientAddress, limit: STEP_UP_LIMITS.address },
    ];
    const decision = await this.windows.attempt(windows);
    if (decision.outcome === "unavailable") {
      this.logger.error("step_up_limits_unavailable");
      throw new ProblemException({
        code: "service_unavailable",
        detail:
          "This action cannot be checked safely right now (the shared limits are unavailable). Try again later.",
        extensions: { rule: STEP_UP_UNAVAILABLE_RULE },
        headers: { "Retry-After": String(STEP_UP_UNAVAILABLE_RETRY_SECONDS) },
      });
    }
    if (decision.outcome === "denied") {
      throw tooManyRequests(
        "Too many attempts with the current password. Try again later.",
        decision.retryAfterSeconds,
      );
    }
  }

  /** Two short transactions: the lockout counter, then the audit record. Neither is rolled back with the refusal. */
  private async recordFailure(userId: string, operation: string, now: Date): Promise<void> {
    await withTransaction(this.db, async (transaction) => {
      const row = await this.users.findByIdForUpdate(userId, transaction);
      if (row === undefined) return;
      await this.users.update(userId, registerFailedLogin(row, now), transaction);
    });
    await withTransaction(this.db, (transaction) =>
      this.audit.record(transaction, userId, {
        action: "admin_user.step_up_failed",
        targetKind: "admin_user",
        targetId: userId,
        detail: { operation },
      }),
    );
  }
}

function stepUpFailed(): ProblemException {
  return new ProblemException({
    code: "forbidden",
    detail: "The current password is not correct.",
    extensions: { rule: STEP_UP_FAILED_RULE },
  });
}
