import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  evaluateSession,
  isAdminRole,
  sessionExpiry,
  shouldTouchSession,
  type AdminRole,
} from "@fluxkit/core";
import { ADMIN_AUTH_CONFIG, type AdminAuthConfig } from "./auth-config.js";
import { CLOCK, type Clock } from "./clock.js";
import { SessionRepository } from "./session.repository.js";
import { SESSION_TOKEN_PATTERN } from "./session-cookie.js";

const TOKEN_BYTES = 32;

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

/** SHA-256 hex of the token text. A random 256-bit token needs no salt or slow hash; this only makes a database leak useless. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && SESSION_TOKEN_PATTERN.test(token);
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

  async create(userId: string, now: Date = this.clock.now()): Promise<CreatedSession> {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    const expiresAt = sessionExpiry(now, this.config);
    const sessionId = await this.sessions.insert({
      userId,
      tokenHash: hashToken(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    });
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

  /** Returns how many sessions were deleted. `exceptSessionId` keeps the caller's own session (password change). */
  revokeAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    return this.sessions.deleteForUser(userId, exceptSessionId);
  }
}
