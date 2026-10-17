import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  isLocked,
  normalizeEmail,
  normalizePhone,
  registerFailedLogin,
  registerSuccessfulLogin,
  validateEmail,
  validatePersonName,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../../auth/clock.js";
import { PasswordHasher } from "../../auth/password-hasher.js";
import { passwordPolicyErrors } from "../../auth/password-policy-errors.js";
import { isUniqueViolation, translatePostgresError } from "../../common/postgres-errors.js";
import {
  unauthorized,
  validationFailed,
  type FieldError,
  type ProblemException,
} from "../../common/problem.js";
import { withTransaction } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import type { CustomerPrincipal } from "../auth/customer-authenticator.js";
import {
  CustomerSessionService,
  type CreatedCustomerSession,
} from "../auth/customer-session.service.js";
import {
  CustomerRepository,
  type CustomerChanges,
  type CustomerRow,
} from "../customer.repository.js";
import type {
  AccountResponse,
  ChangePasswordBody,
  LoginBody,
  RegisterBody,
  UpdateProfileBody,
} from "./account.schemas.js";
import { toCustomerResponse } from "./customer.mapper.js";

/** The one answer to every failed login, whatever the reason (ADR 0016: no account enumeration at login). */
const INVALID_CREDENTIALS = "The email or password is not correct.";

/** Only these codes are ever logged for a failed login: no email, no password, no id of a possibly unknown account. */
type LoginFailureReason = "unknown_account" | "wrong_password" | "locked" | "inactive";

const NAME_MESSAGES = {
  not_a_string: "Must be text.",
  empty: "Must not be empty.",
  too_long: "Must have at most 100 characters.",
  invalid_characters: "Must not contain control characters.",
} as const;

const PHONE_MESSAGES = {
  not_a_string: "Must be text.",
  invalid_format: "Must be a phone number: digits, optionally starting with +.",
  too_short: "Must have at least 7 digits.",
  too_long: "Must have at most 15 digits.",
} as const;

export interface SignInResult extends AccountResponse {
  /** The raw session token. It exists only here and in the cookie; the database keeps its SHA-256. */
  token: string;
  maxAgeSeconds: number;
}

/**
 * Customer registration, login, profile and change-password (ADR 0016). The sign-in flow follows `AuthService`
 * (admin, ADR 0009) step by step on the customer tables: rules (lockout arithmetic, password policy, email, names,
 * phone) are core functions; this class adds the database, the clock and scrypt. Secrets and personal data never
 * reach a log line.
 */
@Injectable()
export class CustomerAccountService {
  private readonly logger = new Logger(CustomerAccountService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CustomerRepository) private readonly customers: CustomerRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(CustomerSessionService) private readonly sessions: CustomerSessionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Creates the account and signs it in with a NEW session. `previousToken` is the session cookie the request
   * carried, if any: it is revoked, so a token planted before registration never survives (no fixation).
   * A taken email is `409 conflict` on `email` (accepted trade-off while no email can be sent, ADR 0016).
   */
  async register(body: RegisterBody, previousToken: string | undefined): Promise<SignInResult> {
    const errors: FieldError[] = [];
    const email = validateEmail(body.email);
    if (!email.ok) {
      errors.push({ path: "email", code: email.reason, message: "Must be a valid email address." });
    }
    errors.push(
      ...passwordPolicyErrors("password", body.password, email.ok ? email.email : body.email),
    );
    const firstName = this.checkName("firstName", body.firstName, errors);
    const lastName = this.checkName("lastName", body.lastName, errors);
    const phone = body.phone === undefined ? null : this.checkPhone(body.phone, errors);
    if (!email.ok || firstName === undefined || lastName === undefined || errors.length > 0) {
      throw validationFailed(errors);
    }
    const passwordHash = await this.hasher.hash(body.password);
    const now = this.clock.now();
    let created: { row: CustomerRow; session: CreatedCustomerSession };
    try {
      created = await withTransaction(this.db, async (transaction) => {
        const row = await this.customers.insert(
          { email: email.email, passwordHash, firstName, lastName, phone },
          transaction,
        );
        await this.afterSignIn();
        const session = await this.sessions.create(row.id, now, transaction);
        return { row, session };
      });
    } catch (error) {
      if (isUniqueViolation(error, "customer_email_key")) {
        throw translatePostgresError(error, { detail: "Another account already uses this email." });
      }
      throw error;
    }
    await this.revokePrevious(previousToken);
    return this.signedIn(created.row, created.session, now);
  }

  /**
   * Every failure ends in the same `401` and does exactly one scrypt verification (a dummy one when there is no
   * hash to check or the account may not sign in), so neither the body nor the response time tells which case it
   * was. The per-address limit is `@RateLimit("login")` on the route, which runs before this method.
   * `previousToken` is the session cookie the request carried: revoked on success only.
   */
  async login(body: LoginBody, previousToken: string | undefined): Promise<SignInResult> {
    const now = this.clock.now();
    const row = await this.customers.findByEmail(normalizeEmail(body.email));
    if (row === undefined) {
      await this.hasher.verifyDummy(body.password);
      throw this.refused("unknown_account");
    }
    if (!row.isActive) {
      await this.hasher.verifyDummy(body.password);
      throw this.refused("inactive");
    }
    if (isLocked(row, now)) {
      await this.hasher.verifyDummy(body.password);
      throw this.refused("locked");
    }
    if (!(await this.hasher.verify(body.password, row.passwordHash))) {
      await this.recordFailedAttempt(row.id, now);
      throw this.refused("wrong_password");
    }
    const upgradedHash = this.hasher.needsRehash(row.passwordHash)
      ? await this.hasher.hash(body.password)
      : undefined;
    const { customer, session } = await this.completeLogin(row, upgradedHash, now);
    await this.revokePrevious(previousToken);
    return this.signedIn(customer, session, now);
  }

  /** The caller's own record. The id comes from the principal the guard authenticated, never from the request. */
  async me(principal: CustomerPrincipal): Promise<AccountResponse> {
    const row = await this.customers.findById(principal.customerId);
    if (row === undefined || !row.isActive) {
      throw unauthorized();
    }
    return { customer: toCustomerResponse(row) };
  }

  /** Names and phone of the caller. Nothing else is writable: the body schema is strict. */
  async updateProfile(
    principal: CustomerPrincipal,
    body: UpdateProfileBody,
  ): Promise<AccountResponse> {
    const errors: FieldError[] = [];
    const changes: CustomerChanges = {};
    if (body.firstName !== undefined) {
      const name = this.checkName("firstName", body.firstName, errors);
      if (name !== undefined) changes.firstName = name;
    }
    if (body.lastName !== undefined) {
      const name = this.checkName("lastName", body.lastName, errors);
      if (name !== undefined) changes.lastName = name;
    }
    if (body.phone !== undefined) {
      const phone = body.phone === null ? null : this.checkPhone(body.phone, errors);
      if (phone !== undefined) changes.phone = phone;
    }
    if (errors.length > 0) {
      throw validationFailed(errors);
    }
    if (Object.keys(changes).length === 0) {
      return this.me(principal);
    }
    const row = await this.customers.update(principal.customerId, changes);
    if (row === undefined || !row.isActive) {
      throw unauthorized();
    }
    return { customer: toCustomerResponse(row) };
  }

  /**
   * The caller proves the current password (one scrypt; a wrong one counts toward the lockout like a failed
   * login, and a locked account cannot be used to guess passwords here either: both exactly as the admin
   * `change-password`), then every OTHER session of the customer ends.
   */
  async changePassword(principal: CustomerPrincipal, body: ChangePasswordBody): Promise<void> {
    const now = this.clock.now();
    const row = await this.customers.findById(principal.customerId);
    if (row === undefined || !row.isActive) {
      throw unauthorized();
    }
    const currentIsCorrect = isLocked(row, now)
      ? await this.hasher.verifyDummy(body.currentPassword)
      : await this.hasher.verify(body.currentPassword, row.passwordHash);
    if (!currentIsCorrect) {
      await this.recordFailedAttempt(row.id, now);
      throw this.wrongCurrentPassword();
    }
    const errors = passwordPolicyErrors("newPassword", body.newPassword, row.email);
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
      const locked = await this.customers.findByIdForUpdate(row.id, transaction);
      // Re-checked under the row lock: failures or another password change may have landed during the scrypt work.
      if (
        locked === undefined ||
        !locked.isActive ||
        isLocked(locked, now) ||
        locked.passwordHash !== row.passwordHash
      ) {
        throw this.wrongCurrentPassword();
      }
      await this.customers.update(
        row.id,
        { passwordHash: newHash, passwordChangedAt: now, ...registerSuccessfulLogin() },
        transaction,
      );
      await this.sessions.revokeAllForCustomer(row.id, principal.sessionId, transaction);
    });
  }

  /**
   * Runs inside the register and login transaction, after the customer is known and before the session exists.
   * TODO(fluxkit): step 4 merges the guest cart here (it will take the open transaction and the customer id).
   * Intentionally empty today: no cart code exists yet.
   */
  private afterSignIn(): Promise<void> {
    return Promise.resolve();
  }

  private signedIn(row: CustomerRow, session: CreatedCustomerSession, now: Date): SignInResult {
    return {
      customer: toCustomerResponse(row),
      token: session.token,
      maxAgeSeconds: Math.max(1, Math.floor((session.expiresAt.getTime() - now.getTime()) / 1000)),
    };
  }

  /** Ends the session of the cookie the request carried. Only called after a sign-in succeeded. */
  private async revokePrevious(previousToken: string | undefined): Promise<void> {
    if (previousToken !== undefined) {
      await this.sessions.revoke(previousToken);
    }
  }

  private checkName(path: string, value: string, errors: FieldError[]): string | undefined {
    const result = validatePersonName(value);
    if (result.ok) {
      return result.name;
    }
    errors.push({ path, code: result.reason, message: NAME_MESSAGES[result.reason] });
    return undefined;
  }

  private checkPhone(value: string, errors: FieldError[]): string | undefined {
    const result = normalizePhone(value);
    if (result.ok) {
      return result.phone;
    }
    errors.push({ path: "phone", code: result.reason, message: PHONE_MESSAGES[result.reason] });
    return undefined;
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

  /** Logs the reason code only and returns the identical 401. */
  private refused(reason: LoginFailureReason): ProblemException {
    this.logger.warn(`Customer login refused: ${reason}`);
    return unauthorized(INVALID_CREDENTIALS);
  }

  /** Counts one failure under the row lock, so concurrent wrong passwords add up and a lock is never extended. */
  private async recordFailedAttempt(customerId: string, now: Date): Promise<void> {
    await withTransaction(this.db, async (transaction) => {
      const row = await this.customers.findByIdForUpdate(customerId, transaction);
      if (row === undefined) {
        return;
      }
      await this.customers.update(customerId, registerFailedLogin(row, now), transaction);
    });
  }

  /**
   * Commits a successful password check: resets the lockout, stamps `last_login_at`, stores a rehash and issues the
   * new session, all in one transaction. Under the row lock it first re-checks what could have changed during the
   * scrypt work (a lock set by concurrent failures, a deactivation, a new password); in those cases the login is
   * refused although the password matched. Deactivation takes the same lock before it revokes sessions, so a
   * session created here is either seen and revoked by it or never created.
   */
  private async completeLogin(
    checked: CustomerRow,
    upgradedHash: string | undefined,
    now: Date,
  ): Promise<{ customer: CustomerRow; session: CreatedCustomerSession }> {
    const outcome = await withTransaction(this.db, async (transaction) => {
      const row = await this.customers.findByIdForUpdate(checked.id, transaction);
      if (row === undefined || !row.isActive) {
        return "inactive" as const;
      }
      if (isLocked(row, now)) {
        return "locked" as const;
      }
      if (row.passwordHash !== checked.passwordHash) {
        return "wrong_password" as const;
      }
      const updated = await this.customers.update(
        row.id,
        {
          ...registerSuccessfulLogin(),
          lastLoginAt: now,
          ...(upgradedHash === undefined ? {} : { passwordHash: upgradedHash }),
        },
        transaction,
      );
      if (updated === undefined) {
        return "inactive" as const;
      }
      await this.afterSignIn();
      const session = await this.sessions.create(updated.id, now, transaction);
      return { customer: updated, session };
    });
    if (typeof outcome === "string") {
      throw this.refused(outcome);
    }
    return outcome;
  }
}
