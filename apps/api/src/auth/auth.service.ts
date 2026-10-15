import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  isLocked,
  normalizeEmail,
  permissionsOf,
  registerFailedLogin,
  registerSuccessfulLogin,
} from "@fluxkit/core";
import { withTransaction } from "../common/transaction.js";
import {
  tooManyRequests,
  unauthorized,
  validationFailed,
  type ProblemException,
} from "../common/problem.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import type { AdminPrincipal } from "./admin-authenticator.js";
import { AdminUserRepository, type AdminUserRow } from "./admin-user.repository.js";
import { toAuthUser } from "./admin-user.mapper.js";
import type {
  AuthUserResponse,
  ChangePasswordBody,
  LoginBody,
  MeResponse,
} from "./auth.schemas.js";
import { CLOCK, type Clock } from "./clock.js";
import { LoginThrottle } from "./login-throttle.js";
import { PasswordHasher } from "./password-hasher.js";
import { passwordPolicyErrors } from "./password-policy-errors.js";
import { SessionService } from "./session.service.js";

/** The one answer to every failed login, whatever the reason (ADR 0009: no account enumeration). */
const INVALID_CREDENTIALS = "The email or password is not correct.";
const THROTTLED = "Too many login attempts. Try again later.";

/** Only these codes are ever logged for a failed login: no email, no password, no id of a possibly unknown account. */
type LoginFailureReason =
  "unknown_account" | "wrong_password" | "locked" | "inactive" | "ip_throttled";

export interface LoginResult {
  user: AuthUserResponse;
  token: string;
  maxAgeSeconds: number;
}

/**
 * Login, "who am I" and change-password (ADR 0009). Rules (lockout arithmetic, password policy) are core functions;
 * this class adds the database, the clock, scrypt and the throttles. Secrets never reach a log line.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AdminUserRepository) private readonly users: AdminUserRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(LoginThrottle) private readonly throttle: LoginThrottle,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Every failure ends in the same `401` and does exactly one scrypt verification (a dummy one when there is no
   * hash to check or the account may not sign in), so neither the body nor the response time tells which case it was.
   */
  async login(body: LoginBody, clientId: string): Promise<LoginResult> {
    const decision = this.throttle.attempt(clientId);
    if (!decision.allowed) {
      // Before any lookup or hashing: a throttled client learns nothing about accounts and costs us no scrypt.
      throw this.refused("ip_throttled", tooManyRequests(THROTTLED, decision.retryAfterSeconds));
    }
    const now = this.clock.now();
    const user = await this.users.findByEmail(normalizeEmail(body.email));
    if (user === undefined) {
      await this.hasher.verifyDummy(body.password);
      throw this.refused("unknown_account");
    }
    if (!user.isActive) {
      await this.hasher.verifyDummy(body.password);
      throw this.refused("inactive");
    }
    if (isLocked(user, now)) {
      await this.hasher.verifyDummy(body.password);
      throw this.refused("locked");
    }
    if (!(await this.hasher.verify(body.password, user.passwordHash))) {
      await this.recordFailedAttempt(user.id, now);
      throw this.refused("wrong_password");
    }
    const upgradedHash = this.hasher.needsRehash(user.passwordHash)
      ? await this.hasher.hash(body.password)
      : undefined;
    const signedIn = await this.completeLogin(user, upgradedHash, now);
    const session = await this.sessions.create(signedIn.id, now);
    this.logger.log(`Admin login succeeded for user ${signedIn.id}`);
    return {
      user: toAuthUser(signedIn),
      token: session.token,
      maxAgeSeconds: Math.max(1, Math.floor((session.expiresAt.getTime() - now.getTime()) / 1000)),
    };
  }

  /** The user and permissions as the database holds them for this request. */
  async me(principal: AdminPrincipal): Promise<MeResponse> {
    const row = await this.users.findById(principal.userId);
    if (row === undefined || !row.isActive) {
      throw unauthorized();
    }
    const user = toAuthUser(row);
    return { user, permissions: [...permissionsOf(user.role)] };
  }

  /**
   * The caller proves the current password (one scrypt; a wrong one counts toward the lockout like a failed login,
   * and a locked account cannot be used to guess passwords here either), then every OTHER session of the user ends.
   */
  async changePassword(principal: AdminPrincipal, body: ChangePasswordBody): Promise<void> {
    const now = this.clock.now();
    const user = await this.users.findById(principal.userId);
    if (user === undefined || !user.isActive) {
      throw unauthorized();
    }
    const currentIsCorrect = isLocked(user, now)
      ? await this.hasher.verifyDummy(body.currentPassword)
      : await this.hasher.verify(body.currentPassword, user.passwordHash);
    if (!currentIsCorrect) {
      await this.recordFailedAttempt(user.id, now);
      throw this.wrongCurrentPassword();
    }
    const errors = passwordPolicyErrors("newPassword", body.newPassword, user.email);
    if (body.newPassword === body.currentPassword) {
      errors.push({
        path: "newPassword",
        code: "same_as_current",
        message: "Must differ from the current password.",
      });
    }
    if (errors.length > 0) {
      throw validationFailed(errors);
    }
    const newHash = await this.hasher.hash(body.newPassword);
    await withTransaction(this.db, async (transaction) => {
      const locked = await this.users.findByIdForUpdate(user.id, transaction);
      // Re-checked under the row lock: failures or another password change may have landed during the scrypt work.
      if (
        locked === undefined ||
        !locked.isActive ||
        isLocked(locked, now) ||
        locked.passwordHash !== user.passwordHash
      ) {
        throw this.wrongCurrentPassword();
      }
      await this.users.update(
        user.id,
        { passwordHash: newHash, passwordChangedAt: now, ...registerSuccessfulLogin() },
        transaction,
      );
      await this.sessions.revokeAllForUser(user.id, principal.sessionId, transaction);
    });
  }

  private wrongCurrentPassword(): ProblemException {
    return validationFailed([
      {
        path: "currentPassword",
        code: "incorrect",
        message: "The current password is not correct.",
      },
    ]);
  }

  /** Logs the reason code only and returns the identical 401 (or the given problem, for the throttle). */
  private refused(reason: LoginFailureReason, problem?: ProblemException): ProblemException {
    this.logger.warn(`Admin login refused: ${reason}`);
    return problem ?? unauthorized(INVALID_CREDENTIALS);
  }

  /** Counts one failure under the row lock, so concurrent wrong passwords add up and a lock is never extended. */
  private async recordFailedAttempt(userId: string, now: Date): Promise<void> {
    await withTransaction(this.db, async (transaction) => {
      const row = await this.users.findByIdForUpdate(userId, transaction);
      if (row === undefined) {
        return;
      }
      const next = registerFailedLogin(row, now);
      await this.users.update(userId, next, transaction);
    });
  }

  /**
   * Commits a successful password check: resets the lockout, stamps `last_login_at` and stores a rehash. Under the
   * row lock it first re-checks what could have changed during the scrypt work (a lock set by concurrent failures,
   * a deactivation, a new password); in those cases the login is refused although the password matched.
   */
  private async completeLogin(
    checked: AdminUserRow,
    upgradedHash: string | undefined,
    now: Date,
  ): Promise<AdminUserRow> {
    const outcome = await withTransaction(this.db, async (transaction) => {
      const row = await this.users.findByIdForUpdate(checked.id, transaction);
      if (row === undefined || !row.isActive) {
        return "inactive" as const;
      }
      if (isLocked(row, now)) {
        return "locked" as const;
      }
      if (row.passwordHash !== checked.passwordHash) {
        return "wrong_password" as const;
      }
      const updated = await this.users.update(
        row.id,
        {
          ...registerSuccessfulLogin(),
          lastLoginAt: now,
          ...(upgradedHash === undefined ? {} : { passwordHash: upgradedHash }),
        },
        transaction,
      );
      return updated ?? "inactive";
    });
    if (typeof outcome === "string") {
      throw this.refused(outcome);
    }
    return outcome;
  }
}
