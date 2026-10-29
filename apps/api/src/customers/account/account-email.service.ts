import { setTimeout as sleep } from "node:timers/promises";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  normalizeEmail,
  registerSuccessfulLogin,
  validateEmail,
  type AuthTokenRefusal,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../../auth/clock.js";
import { PasswordHasher } from "../../auth/password-hasher.js";
import { passwordPolicyErrors } from "../../auth/password-policy-errors.js";
import { LOCALE_CONFIG, type LocaleConfig } from "../../common/locale.js";
import { isLockNotAvailable } from "../../common/postgres-errors.js";
import {
  ruleViolation,
  tooManyRequests,
  unauthorized,
  validationFailed,
  type FieldError,
  type ProblemException,
} from "../../common/problem.js";
import { withTransaction, type Transaction } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { CustomerAuthTokens, type IssueAuthTokenResult } from "../../email/auth/index.js";
import { EmailOutbox, EmailSender } from "../../email/outbox/index.js";
import { RateLimiter } from "../../rate-limit/rate-limiter.js";
import type { CustomerPrincipal } from "../auth/customer-authenticator.js";
import { CustomerSessionService } from "../auth/customer-session.service.js";
import { CustomerRepository, type CustomerRow } from "../customer.repository.js";
import type {
  PasswordResetConfirmBody,
  PasswordResetRequestBody,
  VerifyEmailBody,
} from "./account-email.schemas.js";

/**
 * The reset request answers no sooner than this after it arrived, whatever happened (ADR 0031 decision 10): the work for
 * an existing account (a locked row, a count, two inserts) and for an unknown address (one indexed select) end at the
 * same time, so the response time does not tell them apart. Measured in the step report.
 */
export const PASSWORD_RESET_ANSWER_FLOOR_MS = 400;

/**
 * Longest the reset request waits for a lock (the customer's row, the token index) before it gives up and mails nothing
 * (`busy`). Well below the floor, so a row another transaction holds cannot stretch the answer for an existing address
 * past the answer for an unknown one (email review F1). The person asks again; the holder is usually a login.
 */
export const PASSWORD_RESET_LOCK_TIMEOUT_MS = 200;

/** At most this many reset tokens per customer per hour, counted in the database (spans instances and addresses). */
export const PASSWORD_RESETS_PER_HOUR = 3;

const HOUR_MS = 60 * 60_000;

/** The one answer to every token failure (ADR 0031 decision 10: no oracle for unknown, used, expired or other). */
const INVALID_TOKEN: FieldError = Object.freeze({
  path: "token",
  code: "invalid_or_expired",
  message: "The link is not valid or has expired. Ask for a new one.",
});

/** Only these codes are logged for a reset request: no email, no id of a possibly unknown account. */
type ResetRequestOutcome =
  "issued" | "no_account" | "inactive" | "hourly_limit" | "undeliverable" | "disabled" | "busy";

/**
 * Customer password reset and email verification by mail (ADR 0031 decisions 9, 10 and 16). Rules come from core (email,
 * password policy, token evaluation, lockout reset); `CustomerAuthTokens` issues and consumes tokens; the outbox writes
 * the mail in the same transaction and the immediate attempt starts only after the commit. Logs carry reason codes only:
 * never an address, a token, a password or a link.
 */
@Injectable()
export class AccountEmailService {
  private readonly logger = new Logger(AccountEmailService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CustomerRepository) private readonly customers: CustomerRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(CustomerSessionService) private readonly sessions: CustomerSessionService,
    @Inject(CustomerAuthTokens) private readonly tokens: CustomerAuthTokens,
    @Inject(EmailOutbox) private readonly outbox: EmailOutbox,
    @Inject(EmailSender) private readonly sender: EmailSender,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(LOCALE_CONFIG) private readonly locales: LocaleConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * `POST /store/account/password-reset`. Answers the same (nothing, then `202 {}`) for an unknown address, an inactive
   * account, a locked account (it gets the mail: a reset clears the lock), an account over the hourly limit, an account
   * whose row another transaction holds longer than `PASSWORD_RESET_LOCK_TIMEOUT_MS` (no mail) and an account that got a mail, no sooner than
   * `PASSWORD_RESET_ANSWER_FLOOR_MS` after `startedAt`. Only the format of the input (400) and the rate limits (429,
   * counted for every address alike) answer otherwise; neither depends on whether an account exists.
   */
  async requestPasswordReset(body: PasswordResetRequestBody, startedAt: number): Promise<void> {
    const errors: FieldError[] = [];
    const email = validateEmail(body.email);
    if (!email.ok) {
      errors.push({ path: "email", code: email.reason, message: "Must be a valid email address." });
    }
    if (!this.locales.locales.includes(body.locale)) {
      errors.push({
        path: "locale",
        code: "invalid_value",
        message: `Must be one of: ${this.locales.locales.join(", ")}.`,
      });
    }
    if (!email.ok || errors.length > 0) {
      throw validationFailed(errors);
    }
    const perEmail = this.limiter.attempt("passwordResetEmail", `email:${email.email}`);
    if (!perEmail.allowed) {
      throw tooManyRequests("Too many requests. Try again later.", perEmail.retryAfterSeconds);
    }
    const outcome = await this.issuePasswordReset(email.email, body.locale);
    this.logger.log(`Password reset request: ${outcome.code}`);
    await waitUntil(startedAt + PASSWORD_RESET_ANSWER_FLOOR_MS);
    if (outcome.messageId !== undefined) {
      // After the commit and after the floor: the attempt never delays or changes the answer.
      this.sender.startSendNow(outcome.messageId);
    }
  }

  /**
   * `POST /store/account/password-reset/confirm`. Every token failure is the one `400 invalid_or_expired`. The new
   * password follows the registration policy. scrypt runs outside the transaction; then, under the customer's row lock,
   * the token is evaluated again and consumed (single use), the password and `password_changed_at` are set, the lockout
   * is cleared, the customer's other reset tokens are invalidated, EVERY session ends and the "password changed" notice
   * is enqueued. No session is created.
   */
  async confirmPasswordReset(body: PasswordResetConfirmBody): Promise<void> {
    const now = this.clock.now();
    const presented = await this.tokens.evaluate(body.token, "password_reset", now);
    if (!presented.decision.ok || presented.found === undefined) {
      throw this.invalidToken(
        "reset",
        presented.decision.ok ? "not_found" : presented.decision.reason,
      );
    }
    const found = presented.found;
    const policy = passwordPolicyErrors("newPassword", body.newPassword, found.customer.email);
    if (policy.length > 0) {
      throw validationFailed(policy);
    }
    const passwordHash = await this.hasher.hash(body.newPassword);
    const noticeId = await withTransaction(this.db, async (tx) => {
      const locked = await this.customers.findByIdForUpdate(found.customerId, tx);
      // Re-evaluated under the lock: a deactivation, another reset or a newer token may have landed meanwhile.
      const again = await this.tokens.evaluate(body.token, "password_reset", now, tx);
      if (locked === undefined || !again.decision.ok || again.found?.id !== found.id) {
        throw this.invalidToken("reset", again.decision.ok ? "not_found" : again.decision.reason);
      }
      if (!(await this.tokens.consume(tx, found.id, presented.tokenHash, now))) {
        throw this.invalidToken("reset", "used");
      }
      await this.customers.update(
        locked.id,
        { passwordHash, passwordChangedAt: now, ...registerSuccessfulLogin() },
        tx,
      );
      await this.tokens.invalidate(tx, locked.id, "password_reset", now);
      await this.sessions.revokeAllForCustomer(locked.id, undefined, tx);
      const notice = await this.outbox.enqueue(tx, {
        templateKey: "customer.password_changed",
        locale: this.locales.defaultLocale,
        to: locked.email,
        recipientKind: "customer",
        customerId: locked.id,
        variables: {},
        now,
      });
      return notice.status === "enqueued" ? notice.id : undefined;
    });
    this.logger.log("Password reset confirmed");
    if (noticeId !== undefined) {
      this.sender.startSendNow(noticeId);
    }
  }

  /**
   * `POST /store/account/verify-email`. Sets `email_verified_at` and consumes the token. Every failure is the one
   * `400 invalid_or_expired`, except a valid token that was already used by a customer who IS verified: `204` again
   * (a second click, or two tabs).
   */
  async verifyEmail(body: VerifyEmailBody): Promise<void> {
    const now = this.clock.now();
    const presented = await this.tokens.evaluate(body.token, "email_verification", now);
    const found = presented.found;
    if (found === undefined) {
      throw this.invalidToken("verification", "not_found");
    }
    if (!presented.decision.ok) {
      if (presented.decision.reason === "used" && found.customer.emailVerifiedAt !== null) {
        return;
      }
      throw this.invalidToken("verification", presented.decision.reason);
    }
    await withTransaction(this.db, async (tx) => {
      const locked = await this.customers.findByIdForUpdate(found.customerId, tx);
      const again = await this.tokens.evaluate(body.token, "email_verification", now, tx);
      if (locked === undefined || again.found?.id !== found.id) {
        throw this.invalidToken("verification", "not_found");
      }
      if (!again.decision.ok) {
        if (again.decision.reason === "used" && locked.emailVerifiedAt !== null) {
          return;
        }
        throw this.invalidToken("verification", again.decision.reason);
      }
      if (!(await this.tokens.consume(tx, found.id, presented.tokenHash, now))) {
        throw this.invalidToken("verification", "used");
      }
      if (locked.emailVerifiedAt === null) {
        await this.customers.update(locked.id, { emailVerifiedAt: now }, tx);
      }
    });
  }

  /**
   * `POST /store/account/verify-email/resend` (signed in). `409 rule_violation already_verified` for a verified
   * customer; at most `verificationResend` per customer; the older verification token stops working. The mail is in
   * `DEFAULT_LOCALE` (customers have no locale column; ADR 0031 open question 2, decided in plan step 7).
   */
  async resendVerification(principal: CustomerPrincipal): Promise<void> {
    const row = await this.customers.findById(principal.customerId);
    if (row === undefined || !row.isActive) {
      throw unauthorized();
    }
    if (row.emailVerifiedAt !== null) {
      throw this.alreadyVerified();
    }
    const limit = this.limiter.attempt("verificationResend", `customer:${row.id}`);
    if (!limit.allowed) {
      throw tooManyRequests("Too many requests. Try again later.", limit.retryAfterSeconds);
    }
    const now = this.clock.now();
    const issued = await withTransaction(this.db, async (tx) => {
      const locked = await this.customers.findByIdForUpdate(row.id, tx);
      if (locked === undefined || !locked.isActive) {
        throw unauthorized();
      }
      if (locked.emailVerifiedAt !== null) {
        throw this.alreadyVerified();
      }
      return this.issueVerification(tx, locked, now);
    });
    this.afterIssue("verification resend", issued);
  }

  /**
   * Registration (inside its transaction, the new row is already written): the first verification mail, in
   * `DEFAULT_LOCALE`. Nothing without a provider. The caller starts the immediate attempt after its commit
   * (`afterIssue`).
   */
  issueVerification(
    tx: Transaction,
    customer: CustomerRow,
    now: Date,
  ): Promise<IssueAuthTokenResult> {
    return this.tokens.issue(tx, {
      recipient: { id: customer.id, email: customer.email },
      purpose: "email_verification",
      locale: this.locales.defaultLocale,
      now,
    });
  }

  /** After the commit of an issue: the immediate attempt (fire and forget), or a log code of why nothing was sent. */
  afterIssue(flow: string, issued: IssueAuthTokenResult): void {
    if (issued.status === "issued") {
      this.sender.startSendNow(issued.messageId);
    } else if (issued.status === "undeliverable") {
      this.logger.warn(`Customer ${flow}: no mail, the address is undeliverable`);
    }
  }

  /** Changes of the password other than a reset (change-password) end the reset links that are still out. */
  invalidateResetTokens(tx: Transaction, customerId: string, now: Date): Promise<number> {
    return this.tokens.invalidate(tx, customerId, "password_reset", now);
  }

  private async issuePasswordReset(
    email: string,
    locale: string,
  ): Promise<{ code: ResetRequestOutcome; messageId?: string }> {
    if (!this.tokens.enabled()) {
      // The route is off without a provider (EmailDeliveryGuard); a caller of the service gets nothing written.
      return { code: "disabled" };
    }
    const row = await this.customers.findByEmail(normalizeEmail(email));
    if (row === undefined) {
      return { code: "no_account" };
    }
    if (!row.isActive) {
      return { code: "inactive" };
    }
    const now = this.clock.now();
    try {
      return await this.issueLockedPasswordReset(row.id, locale, now);
    } catch (error) {
      if (isLockNotAvailable(error)) {
        return { code: "busy" };
      }
      throw error;
    }
  }

  private issueLockedPasswordReset(
    customerId: string,
    locale: string,
    now: Date,
  ): Promise<{ code: ResetRequestOutcome; messageId?: string }> {
    return withTransaction(this.db, async (tx) => {
      // Ends with the transaction (is_local); the value is a bound parameter.
      await tx.execute(
        sql`select set_config('lock_timeout', ${String(PASSWORD_RESET_LOCK_TIMEOUT_MS)}, true)`,
      );
      // The row lock serializes concurrent requests of one customer: the count below and the "one unused token per
      // customer and purpose" index then see each other's writes instead of colliding.
      const locked = await this.customers.findByIdForUpdate(customerId, tx);
      if (locked === undefined || !locked.isActive) {
        return { code: "inactive" as const };
      }
      const recent = await this.tokens.countIssuedSince(
        tx,
        locked.id,
        "password_reset",
        new Date(now.getTime() - HOUR_MS),
      );
      if (recent >= PASSWORD_RESETS_PER_HOUR) {
        return { code: "hourly_limit" as const };
      }
      const issued = await this.tokens.issue(tx, {
        recipient: { id: locked.id, email: locked.email },
        purpose: "password_reset",
        locale,
        now,
      });
      if (issued.status === "issued") {
        return { code: "issued" as const, messageId: issued.messageId };
      }
      return { code: issued.status };
    });
  }

  private invalidToken(flow: "reset" | "verification", reason: AuthTokenRefusal): ProblemException {
    this.logger.warn(`Customer ${flow} token refused: ${reason}`);
    return validationFailed([INVALID_TOKEN]);
  }

  private alreadyVerified(): ProblemException {
    return ruleViolation("The email address is already verified.", "already_verified");
  }
}

/** Resolves at `deadline` (a `performance.now()` reading), at once when it has passed. */
async function waitUntil(deadline: number): Promise<void> {
  const remaining = deadline - performance.now();
  if (remaining > 0) {
    await sleep(remaining);
  }
}
