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
import { AdminUserRepository } from "../admin-user.repository.js";
import { CLOCK, type Clock } from "../clock.js";
import { PasswordHasher } from "../password-hasher.js";
import { passwordPolicyErrors } from "../password-policy-errors.js";
import { SessionService } from "../session.service.js";
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

/**
 * Admin user management (owner only, `users.manage`). Rules come from `@fluxkit/core`: email format, password
 * policy and the last-owner rule. This class adds the database, scrypt and session revocation. There is no delete:
 * deactivating keeps the account and ends its sessions.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AdminUserRepository) private readonly users: AdminUserRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(CLOCK) private readonly clock: Clock,
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

  async create(body: CreateUserBody): Promise<UserResponse> {
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
    const passwordHash = await this.hasher.hash(body.password);
    try {
      const row = await this.users.insert({ email: email.email, passwordHash, role: body.role });
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
  async update(id: string, body: UpdateUserBody): Promise<UserResponse> {
    if (body.role === undefined && body.isActive === undefined) {
      return this.get(id);
    }
    const updated = await withTransaction(this.db, async (transaction) => {
      await this.users.lockOwnerChanges(transaction);
      const target = await this.users.findByIdForUpdate(id, transaction);
      if (target === undefined) {
        throw notFound("User");
      }
      const decision = decideUserChange({
        target: { id: target.id, role: target.role, isActive: target.isActive },
        change: {
          ...(body.role === undefined ? {} : { role: body.role }),
          ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
        },
        activeOwnerIds: await this.users.activeOwnerIds(transaction),
      });
      if (!decision.allowed) {
        throw ruleViolation(RULE_DETAILS[decision.reason], decision.reason);
      }
      const row = await this.users.update(
        id,
        {
          ...(body.role === undefined ? {} : { role: body.role }),
          ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
        },
        transaction,
      );
      if (row === undefined) {
        throw notFound("User");
      }
      if (body.isActive === false) {
        await this.sessions.revokeAllForUser(id, undefined, transaction);
      }
      return row;
    });
    return toUserResponse(updated);
  }

  /** New password for another (or the own) account: clears the lockout and ends all sessions of that user. */
  async resetPassword(id: string, body: ResetPasswordBody): Promise<void> {
    const target = await this.users.findById(id);
    if (target === undefined) {
      throw notFound("User");
    }
    const errors = passwordPolicyErrors("newPassword", body.newPassword, target.email);
    if (errors.length > 0) {
      throw validationFailed(errors);
    }
    const passwordHash = await this.hasher.hash(body.newPassword);
    await withTransaction(this.db, async (transaction) => {
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
    });
  }
}
