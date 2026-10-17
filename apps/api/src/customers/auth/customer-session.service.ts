import { Inject, Injectable, Logger } from "@nestjs/common";
import { evaluateSession, sessionExpiry, shouldTouchSession } from "@fluxkit/core";
import { CLOCK, type Clock } from "../../auth/clock.js";
import {
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
} from "../../auth/session-token.js";
import type { DbExecutor } from "../../common/transaction.js";
import { CUSTOMER_AUTH_CONFIG, type CustomerAuthConfig } from "./customer-auth-config.js";
import { CustomerSessionRepository } from "./customer-session.repository.js";

export interface CreatedCustomerSession {
  /** The raw token. It exists only here and in the cookie; the database keeps its SHA-256. */
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export interface ResolvedCustomerSession {
  sessionId: string;
  customer: { id: string; email: string };
}

/**
 * Customer sessions (ADR 0016): the admin session rules (`SessionService`, ADR 0009) for a separate principal and
 * table. Rules (expiry, idle timeout, touch interval) come from `@fluxkit/core`; this class adds randomness,
 * hashing, the database and the clock. Raw tokens are never logged.
 */
@Injectable()
export class CustomerSessionService {
  private readonly logger = new Logger(CustomerSessionService.name);

  constructor(
    @Inject(CustomerSessionRepository) private readonly sessions: CustomerSessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CUSTOMER_AUTH_CONFIG) private readonly config: CustomerAuthConfig,
  ) {}

  /**
   * Always a NEW random token (login and registration must never reuse a token a client already holds). Pass the
   * open `executor` to insert the session in the caller's transaction.
   */
  async create(
    customerId: string,
    now: Date = this.clock.now(),
    executor?: DbExecutor,
  ): Promise<CreatedCustomerSession> {
    const token = generateSessionToken();
    const expiresAt = sessionExpiry(now, this.config);
    const sessionId = await this.sessions.insert(
      {
        customerId,
        tokenHash: hashSessionToken(token),
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
      },
      executor,
    );
    return { token, sessionId, expiresAt };
  }

  /**
   * The signed-in customer of a token, or `undefined` (unknown, malformed, expired, customer deactivated). The
   * `is_active` flag and the email are read from the database on every call so a change applies at once. Database
   * failures are not caught: they must end as a server error, never as "not signed in" and never as access.
   */
  async resolve(
    rawToken: string,
    now: Date = this.clock.now(),
  ): Promise<ResolvedCustomerSession | undefined> {
    if (!isWellFormedSessionToken(rawToken)) {
      return undefined;
    }
    const found = await this.sessions.findWithCustomerByTokenHash(hashSessionToken(rawToken));
    if (found === undefined) {
      return undefined;
    }
    const evaluation = evaluateSession(found, now, this.config);
    if (!evaluation.valid) {
      if (evaluation.reason !== "invalid_session") {
        await this.sessions.deleteById(found.sessionId);
      } else {
        this.logger.warn(
          `Rejected session ${found.sessionId}: unreadable or impossible timestamps`,
        );
      }
      return undefined;
    }
    if (!found.customer.isActive) {
      return undefined;
    }
    if (shouldTouchSession(found.lastSeenAt, now)) {
      await this.sessions.touch(found.sessionId, now);
    }
    return {
      sessionId: found.sessionId,
      customer: { id: found.customer.id, email: found.customer.email },
    };
  }

  /** True when a session was deleted. */
  async revoke(rawToken: string): Promise<boolean> {
    if (!isWellFormedSessionToken(rawToken)) {
      return false;
    }
    return (await this.sessions.deleteByTokenHash(hashSessionToken(rawToken))) > 0;
  }

  /** Deletes one session by id (logout of the signed-in caller, whose principal carries the id). */
  async revokeSession(sessionId: string): Promise<void> {
    await this.sessions.deleteById(sessionId);
  }

  /**
   * Returns how many sessions were deleted. `exceptSessionId` keeps the caller's own session (password change);
   * deactivation by an admin passes none. Pass the open `executor` when the revocation must commit or roll back
   * together with the change that caused it.
   */
  revokeAllForCustomer(
    customerId: string,
    exceptSessionId?: string,
    executor?: DbExecutor,
  ): Promise<number> {
    return this.sessions.deleteForCustomer(customerId, exceptSessionId, executor);
  }
}
