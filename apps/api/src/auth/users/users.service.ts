import { Inject, Injectable } from "@nestjs/common";
import { decideUserChange, validateEmail, type UserChangeDecision } from "@fluxkit/core";
import { toPage, type Page, type PaginationQuery } from "../../common/pagination.js";
import { translatePostgresError } from "../../common/postgres-errors.js";
import {
  notFound,
  ruleViolation,
  validationFailed,
  type FieldError,
} from "../../common/problem.js";
import { withTransaction } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { AdminAuditWriter } from "../../privacy/audit/admin-audit.writer.js";
import type { AdminPrincipal } from "../admin-authenticator.js";
import { AdminUserRepository } from "../admin-user.repository.js";
import { CLOCK, type Clock } from "../clock.js";
import { PasswordHasher } from "../password-hasher.js";
import { passwordPolicyErrors } from "../password-policy-errors.js";
import { SessionService } from "../session.service.js";
import { AdminStepUpService, type VerifiedStepUp } from "../step-up/admin-step-up.service.js";
import {
  createNeedsStepUp,
  OWNER_STEP_UP_OPERATIONS,
  OWNER_STEP_UP_REQUIRED_RULE,
  resetNeedsStepUp,
  updateNeedsStepUp,
} from "./owner-step-up.js";
import { toUserResponse } from "./users.mapper.js";
import type {
  CreateUserBody,
  ResetPasswordBody,
  UpdateUserBody,
  UserResponse,
} from "./users.schemas.js";

type RefusedChange = Extract<UserChangeDecision, { allowed: false }>;

const RULE_DETAILS: Readonly<Record<RefusedChange["reason"], string>> = {
  last_owner_cannot_be_demoted: "The last active owner cannot be demoted.",
  last_owner_cannot_be_deactivated: "The last active owner cannot be deactivated.",
  unknown_role: "The role is not one of the fixed roles.",
};

const PERMISSION = "users.manage";

/** Who asks and from where; the address is only counted by the step-up limits. */
export interface UserActor {
  readonly principal: AdminPrincipal;
  readonly clientAddress: string;
}

/**
 * Admin user management (owner only, `users.manage`). Rules come from `@fluxkit/core`: email format, password
 * policy and the last-owner rule. This class adds the database, scrypt and session revocation. There is no delete:
 * deactivating keeps the account and ends its sessions.
 *
 * Three results ask for the actor's own password again (`owner-step-up.ts`): a new owner, a promotion or
 * reactivation of an owner, and the reset of an owner's password. Their order is fixed: the new email and password
 * are validated first (a typo costs no password attempt), then the password re-entry runs outside the write
 * transaction (`AdminStepUpService` owns the hashing, the lockout, the shared limits and the audit of a refusal),
 * then the transaction re-reads the LOCKED row and decides again, so a role change that lands in between cannot
 * smuggle an owner past the re-entry.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AdminUserRepository) private readonly users: AdminUserRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AdminAuditWriter) private readonly audit: AdminAuditWriter,
    @Inject(AdminStepUpService) private readonly stepUp: AdminStepUpService,
  ) {}

  async list(page: PaginationQuery): Promise<Page<UserResponse>> {
    const { rows, total } = await this.users.list(page);
    return toPage(rows.map(toUserResponse), total, page);
  }

  async get(id: string): Promise<UserResponse> {
    const row = await this.users.findById(id);
    if (row === undefined) {
      throw notFound("User");
    }
    return toUserResponse(row);
  }

  async create(body: CreateUserBody, actor: UserActor): Promise<UserResponse> {
    const errors: FieldError[] = [];
    const email = validateEmail(body.email);
    if (!email.ok) {
      errors.push({ path: "email", code: email.reason, message: "Must be a valid email address." });
    }
    errors.push(
      ...passwordPolicyErrors("password", body.password, email.ok ? email.email : body.email),
    );
    if (!email.ok || errors.length > 0) {
      throw validationFailed(errors);
    }
    // A new owner needs the actor's password; the role comes from the body, so no later re-read can change it.
    const verified = createNeedsStepUp(body.role)
      ? await this.verifyStepUp(actor, body.currentPassword, OWNER_STEP_UP_OPERATIONS.created)
      : undefined;
    const passwordHash = await this.hasher.hash(body.password);
    try {
      const row = await withTransaction(this.db, async (transaction) => {
        if (verified !== undefined) {
          await this.stepUp.assertStillValid(transaction, verified, PERMISSION);
        }
        const inserted = await this.users.insert(
          { email: email.email, passwordHash, role: body.role },
          transaction,
        );
        await this.audit.record(transaction, actor.principal.userId, {
          action: "admin_user.created",
          targetKind: "admin_user",
          targetId: inserted.id,
          detail: { role: inserted.role },
        });
        return inserted;
      });
      return toUserResponse(row);
    } catch (error) {
      // `admin_user_email_key` becomes 409 conflict with field `email`.
      throw translatePostgresError(error, { detail: "Another user already has this email." });
    }
  }

  /**
   * Role and activity. The last-owner rule reads the active owners and applies the change INSIDE one transaction
   * that holds the owner-change lock, so two concurrent requests cannot each see "another owner remains" and remove
   * the last two owners between them. Deactivating ends all sessions of the user in the same transaction; a role
   * change needs no revocation because the role is read from the database on every request.
   */
  async update(id: string, body: UpdateUserBody, actor: UserActor): Promise<UserResponse> {
    if (body.role === undefined && body.isActive === undefined) {
      return this.get(id);
    }
    const change = {
      ...(body.role === undefined ? {} : { role: body.role }),
      ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
    };
    // Unknown id before the password: a wrong link costs no attempt. The locked row below decides for real.
    const seen = await this.users.findById(id);
    if (seen === undefined) {
      throw notFound("User");
    }
    const needed = updateNeedsStepUp(seen, change);
    const verified =
      needed === null
        ? undefined
        : await this.verifyStepUp(actor, body.currentPassword, OWNER_STEP_UP_OPERATIONS[needed]);
    const updated = await withTransaction(this.db, async (transaction) => {
      await this.users.lockOwnerChanges(transaction);
      const target = await this.users.findByIdForUpdate(id, transaction);
      if (target === undefined) {
        throw notFound("User");
      }
      // The role or activity may have moved since the unlocked read: the locked row decides whether the result is an
      // owner, so a promotion or reactivation that was not paid for with a password changes nothing.
      if (updateNeedsStepUp(target, change) !== null && verified === undefined) {
        throw ownerStepUpRequired();
      }
      if (verified !== undefined) {
        await this.stepUp.assertStillValid(transaction, verified, PERMISSION);
      }
      const decision = decideUserChange({
        target: { id: target.id, role: target.role, isActive: target.isActive },
        change,
        activeOwnerIds: await this.users.activeOwnerIds(transaction),
      });
      if (!decision.allowed) {
        throw ruleViolation(RULE_DETAILS[decision.reason], decision.reason);
      }
      const row = await this.users.update(id, change, transaction);
      if (row === undefined) {
        throw notFound("User");
      }
      if (body.isActive === false) {
        await this.sessions.revokeAllForUser(id, undefined, transaction);
      }
      // Audit (ADR 0033): one event per real change, none for a value that did not change.
      if (body.role !== undefined && body.role !== target.role) {
        await this.audit.record(transaction, actor.principal.userId, {
          action: "admin_user.role_changed",
          targetKind: "admin_user",
          targetId: id,
          detail: { fromRole: target.role, toRole: body.role },
        });
      }
      if (body.isActive === false && target.isActive) {
        await this.audit.record(transaction, actor.principal.userId, {
          action: "admin_user.deactivated",
          targetKind: "admin_user",
          targetId: id,
        });
      }
      if (body.isActive === true && !target.isActive) {
        await this.audit.record(transaction, actor.principal.userId, {
          action: "admin_user.activated",
          targetKind: "admin_user",
          targetId: id,
        });
      }
      return row;
    });
    return toUserResponse(updated);
  }

  /** New password for another (or the own) account: clears the lockout and ends all sessions of that user. */
  async resetPassword(id: string, body: ResetPasswordBody, actor: UserActor): Promise<void> {
    const target = await this.users.findById(id);
    if (target === undefined) {
      throw notFound("User");
    }
    const errors = passwordPolicyErrors("newPassword", body.newPassword, target.email);
    if (errors.length > 0) {
      throw validationFailed(errors);
    }
    const verified = resetNeedsStepUp(target)
      ? await this.verifyStepUp(actor, body.currentPassword, OWNER_STEP_UP_OPERATIONS.passwordReset)
      : undefined;
    const passwordHash = await this.hasher.hash(body.newPassword);
    await withTransaction(this.db, async (transaction) => {
      // The same lock the role changes take, so the locked role below cannot change while this decides, and two
      // resets of each other's account always take the row locks in the same order.
      await this.users.lockOwnerChanges(transaction);
      const locked = await this.users.findByIdForUpdate(id, transaction);
      if (locked === undefined) {
        throw notFound("User");
      }
      if (resetNeedsStepUp(locked) && verified === undefined) {
        throw ownerStepUpRequired();
      }
      if (verified !== undefined) {
        await this.stepUp.assertStillValid(transaction, verified, PERMISSION);
      }
      const row = await this.users.update(
        id,
        {
          passwordHash,
          passwordChangedAt: this.clock.now(),
          failedLoginCount: 0,
          lockedUntil: null,
        },
        transaction,
      );
      if (row === undefined) {
        throw notFound("User");
      }
      await this.sessions.revokeAllForUser(id, undefined, transaction);
      await this.audit.record(transaction, actor.principal.userId, {
        action: "admin_user.password_reset",
        targetKind: "admin_user",
        targetId: id,
      });
    });
  }

  /**
   * The password re-entry of one operation. A missing field is a structural error (400 on `currentPassword`) and is
   * answered before the shared limits and before any hashing, so a forgetful client neither spends an attempt of the
   * budget nor counts as a failed login.
   */
  private async verifyStepUp(
    actor: UserActor,
    currentPassword: string | undefined,
    operation: string,
  ): Promise<VerifiedStepUp> {
    if (currentPassword === undefined) {
      throw validationFailed([
        {
          path: "currentPassword",
          code: "required",
          message: "Enter your current password to change an owner account.",
        },
      ]);
    }
    return this.stepUp.verify({
      principal: actor.principal,
      currentPassword,
      clientAddress: actor.clientAddress,
      operation,
    });
  }
}

function ownerStepUpRequired(): ReturnType<typeof ruleViolation> {
  return ruleViolation(
    "This change makes an owner account, so it needs your current password. Reload the user and try again.",
    OWNER_STEP_UP_REQUIRED_RULE,
  );
}
