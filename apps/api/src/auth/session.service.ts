import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  evaluateSession,
  isAdminRole,
  sessionExpiry,
  shouldTouchSession,
  type AdminRole,
} from "@fluxkit/core";
import type { DbExecutor } from "../common/transaction.js";
import { ADMIN_AUTH_CONFIG, type AdminAuthConfig } from "./auth-config.js";
import { CLOCK, type Clock } from "./clock.js";
import { SessionRepository } from "./session.repository.js";
import {
  generateSessionToken,
  hashSessionToken as hashToken,
  isWellFormedSessionToken as isWellFormedToken,
} from "./session-token.js";

export interface CreatedSession {
  /** The raw token. It exists only here and in the cookie; the database keeps its SHA-256. */
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export interface ResolvedSession {
  sessionId: string;
  user: { id: string; email: string; role: AdminRole };
}

/**
 * Admin sessions (ADR 0009). Rules (expiry, idle timeout, touch interval) come from `@fluxkit/core`; this class
 * adds randomness, hashing, the database and the clock. Raw tokens are never logged.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @Inject(SessionRepository) private readonly sessions: SessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ADMIN_AUTH_CONFIG) private readonly config: AdminAuthConfig,
  ) {}

  /** Pass the open `executor` to insert the session in the caller's transaction (login, under the user row lock). */
  async create(
    userId: string,
    now: Date = this.clock.now(),
    executor?: DbExecutor,
  ): Promise<CreatedSession> {
    const token = generateSessionToken();
    const expiresAt = sessionExpiry(now, this.config);
    const sessionId = await this.sessions.insert(
      { userId, tokenHash: hashToken(token), createdAt: now, lastSeenAt: now, expiresAt },
      executor,
    );
    return { token, sessionId, expiresAt };
  }

  /**
   * The signed-in user of a token, or `undefined` (unknown, malformed, expired, user deactivated). The role and
   * `is_active` are read from the database on every call so a change applies at once. Database failures are not
   * caught: they must end as a server error, never as "not signed in" and never as access.
   */
  async resolve(
    rawToken: string,
    now: Date = this.clock.now(),
  ): Promise<ResolvedSession | undefined> {
    if (!isWellFormedToken(rawToken)) {
      return undefined;
    }
    const found = await this.sessions.findWithUserByTokenHash(hashToken(rawToken));
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
    if (!found.user.isActive) {
      return undefined;
    }
    if (!isAdminRole(found.user.role)) {
      this.logger.error(
        `User ${found.user.id} has an unknown role; session ${found.sessionId} denied`,
      );
      return undefined;
    }
    if (shouldTouchSession(found.lastSeenAt, now)) {
      await this.sessions.touch(found.sessionId, now);
    }
    return {
      sessionId: found.sessionId,
      user: { id: found.user.id, email: found.user.email, role: found.user.role },
    };
  }

  /** True when a session was deleted. */
  async revoke(rawToken: string): Promise<boolean> {
    if (!isWellFormedToken(rawToken)) {
      return false;
    }
    return (await this.sessions.deleteByTokenHash(hashToken(rawToken))) > 0;
  }

  /** Deletes one session by id (logout of the signed-in caller, whose principal carries the id). */
  async revokeSession(sessionId: string): Promise<void> {
    await this.sessions.deleteById(sessionId);
  }

  /**
   * Returns how many sessions were deleted. `exceptSessionId` keeps the caller's own session (password change).
   * Pass the open `executor` when the revocation must commit or roll back together with the change that caused it.
   */
  revokeAllForUser(
    userId: string,
    exceptSessionId?: string,
    executor?: DbExecutor,
  ): Promise<number> {
    return this.sessions.deleteForUser(userId, exceptSessionId, executor);
  }

  /** Deletes the expired sessions (lifetime or idle time reached) of every user. Returns how many. */
  deleteExpired(now: Date = this.clock.now()): Promise<number> {
    return this.sessions.deleteExpired(now, this.config.idleMinutes);
  }

  /** Same for one user; login calls it inside its transaction so the table cannot grow without bound. */
  deleteExpiredForUser(
    userId: string,
    now: Date = this.clock.now(),
    executor?: DbExecutor,
  ): Promise<number> {
    return this.sessions.deleteExpired(now, this.config.idleMinutes, userId, executor);
  }
}
